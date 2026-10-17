# 从一次工具往返，看清循环、重试、取消和提交

第一次响应要求调用 sum，工具算出 42，下一次请求应收到这个结果。先沿这条小路径跑通，再看响应失败、取消和两个工具并发时，运行时如何处理。

模型响应由 `ScriptedAdapter` 预先设定；AgentLoop、工具管线、会话和调度使用官方实现。这样可以把每个条件固定下来，检查请求之间真正传了什么。对应第 01、15、16、20、21 讲。

## 先运行 basic

完成[根目录依赖安装](../README.md)后，在仓库根目录执行：

```sh
node runtime/run.mjs --scenario basic
```

输出应包含：

```text
PASS normal: tool=42, turns=1, steps=2, requests=2, assistant/message=2, assistant/attempt=0
```

这行有三层计数：Turn 是这次输入驱动的工作轮次；Step 是循环中的一个推进步骤；Attempt 是一次具体的模型请求尝试。本场景第一步取得并执行工具调用，第二步生成答案，因此一次 Turn 包含两个 Step。每一步都一次请求成功；重试场景则会让同一个 Step 出现多次 Attempt。

## basic：结果有没有真正进入下一次请求

打开 [run.mjs](./run.mjs) 的 `normalTurn()`。预定响应分两次提供：

1. 第一次提出 `sum(19, 23)`。运行时派发工具，执行主体返回数值 42，render 将它转换成模型可见的文本。
2. 第二次先查看运行时构造的请求，确认其中有对应 `sum-1` 的工具结果、内容为 42，再生成最终回答。

脚本还检查工具只执行一次、Session 记录的结果也是 42。请求交接和会话记录分别检查，因此最终答案中出现 42 还不够。

这里 Session 是保存运行事件的会话对象。工具调用记录为 tool/call，结果记录为 tool/result。模型响应结束时，成功内容形成 assistant/message；失败尝试会在后面的 retry 场景中另作记录。

可以按以下步骤改一次输入：

1. 将 `b: 23` 改成 `b: 24`，不改预期。第二次请求的结果检查应失败：实际是 43，预期还是 42。
2. 只将第二次响应函数内的结果预期改成 `'43'`。这次会通过请求检查，再在 Session 结果仍预期 `'42'` 的地方失败。
3. 将 Session 的预期也改成 `'43'`，应重新通过。工具仍只执行一次，请求仍只有两次。

练习后恢复这些改动，再继续其他场景。

## order：B 已完成，为什么还没有结果提交

```sh
node runtime/run.mjs --scenario order
```

`parallelOrder()` 让模型按 A、B 的顺序提出两个并发安全工具调用。两者各自等待脚本放行。先确认都已启动，再只放行 B，让 A 继续等待。

B 的主体返回后，脚本让一次事件循环中的后续处理运行，然后检查两个位置：`tools/result` 结果事件尚未出现，Session 中也没有 tool/result。之后才放行 A，最终应得到：

```text
body completion:     B, A
tools/result:        A, B
Session tool/result: A, B
```

执行先后和结果提交先后是分开的。上述中间检查能排除“最后才把结果数组排了一遍序”的误解：B 在 A 未完成时就已经返回，但结果仍等在原来的提交位置。

`setImmediate` 提供观察后续处理的机会，不决定谁先完成。15 秒超时仅用于让挂起的实验报错。如果把 `mount()` 中 `maxParallelToolCalls: 2` 改为 1，A 会占住唯一执行位置，B 无法启动；实验停在 bothStarted，直到超时失败。恢复为 2 后再运行。

## retry：同一步可以请求两次，输入仍只有一份

```sh
node runtime/run.mjs --scenario retry
```

第一次响应返回 SERVER_ERROR，实验通过 `agent/request-error` 给出一次重试决定，第二次成功。

检查结果是 1 个 Turn、1 个 Step、2 次请求；两次请求中的用户输入相同，Session 中也只有一份 user/message。失败尝试记为 assistant/attempt，成功结果记为 assistant/message；下一次给模型使用的历史只包含成功的 assistant 消息。

先读 `retryAttempt()` 中给出重试决定的监听器，再看请求输入与事件计数的断言。这项重试由实验明确配置，不能推广为运行时默认重试所有错误。

## cancel：已显示的前缀怎样留下来

```sh
node runtime/run.mjs --scenario cancel
```

`cancelledStream()` 先发出 `Visible prefix`，然后等待取消信号。取消前，这段实时内容已经发出，Session 尚无最终的 assistant/message。

调用真实的 `agent.cancel({ kind: 'user' })`、等待运行空闲后，前缀成为带 `interrupted: true` 的 assistant/message，Step 关闭，Turn 以 aborted 结束。未写完的内容保留下来，并带着中断状态。

`observe()` 同时记录实时流结束和 Session 接纳事件；`assertSettlements()` 检查每个实时结束帧指向已接纳的结算事件。这些接纳发生在内存中，落盘是另外的步骤。

## recovery：未启动与结果未知怎样区分

```sh
node runtime/run.mjs --scenario recovery
```

这个场景使用官方 Session 接口构造两份未结束的内存日志，再交给 `ToolCallRecovery` 和 `interruptedTurnClosers`。两份输入只差一个 tool/call：

| 日志里有什么 | 恢复结果 | 可以据此判断什么 |
| --- | --- | --- |
| assistant 已提出 tool-call，但没有 tool/call | TOOL_NOT_STARTED | 没有工具启动记录 |
| 已有 tool/call，但没有 tool/result | TOOL_OUTCOME_UNKNOWN | 已记录启动，缺少结果，不能确认外部动作是否完成 |

两条路径都补上 tool/result、step/end、turn/end，原日志前缀保持不变。计算修复候选时不改 Session；通过 append 接纳后，再次计算返回空，避免重复修复。

打开 `recoveryAlgorithm()` 看两组输入。它没有真正执行 demo_write，也没有终止或重启进程，所以 UNKNOWN 不能作为放心重试写入的依据。

## 一次运行全部场景

```sh
node runtime/run.mjs
```

无参数等同 `--scenario all`，依次运行上述五项。`PASS normal` 对应 basic，`PASS parallel` 对应 order。若要使用 npm workspace 别名，可查看 [package.json](./package.json) 的 scripts。

每项都在 finally 中释放 Context。它们不请求远程模型、不读取默认 Profile，使用内存 Session；没有安装持久化、文件、进程或沙箱实现。想接真实模型，继续看[真实模型实验](../real-model/README.md)。

## 需要修改装配时再看这里

`mount()` 装配 LlmRuntime、SessionStore、SessionProjectionRegistry、SystemPrompt、ToolRuntime、AgentRegistry 和 AgentLoop，最后注册脚本响应适配器。AgentLoop 使用 native 工具模式，并发上限为 2，不自动创建 Agent；每个场景自己 await 创建完成后再发送输入。

SessionProjectionRegistry 根据会话事件更新已注册的投影状态，供其他组件读取。它与 Session、工具运行时一样使用官方包。

[package.json](./package.json) 固定 DSH `0.2.1-rc.2`、Cordis `4.0.5`，完整依赖由根目录 lockfile 管理，脚本启动时逐项检查直接依赖版本。支持的 Node.js 版本见[仓库首页](../README.md)。npm 执行的是发布的 JavaScript，下面的 TypeScript 链接便于核对实现。

本实验中的 Session 接纳不等于磁盘 fsync，取消也不等于进程崩溃；JSONL 保存、损坏文件修复、跨进程恢复和完整产品应分别验证。

## 可选源码对照

| 实验观察 | 当前官方实现 |
| --- | --- |
| followup 进入 next-turn，Turn/Step 驱动 | [agent.ts:154](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/agent.ts#L154)、[Turn loop:299](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/agent.ts#L299) |
| live stream、message/attempt 结算 | [AssistantStreamAttempt:60](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/assistant-stream.ts#L60)、[settle:78](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/assistant-stream.ts#L78) |
| 同 Step 内重试与取消前缀 | [agent.ts:465](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/agent.ts#L465)、[request-error:505](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/agent.ts#L505) |
| 工具准备、派发、最终结果 | [tools/index.ts:1375](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/tools/src/index.ts#L1375) |
| B先完成，A先提交 | [tool-calls.ts:147 的 commitReady](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/tool-calls.ts#L147)、[并发调度测试:230](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/tests/tool-calls.spec.ts#L230) |
| 失败 attempt 不成为 surface 消息 | [SessionEventMap:341](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/types.ts#L341)、[deriveMessages:984](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/index.ts#L984) |
| 恢复候选与开放尾部闭合 | [ToolCallRecovery:118](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/repair.ts#L118)、[openTurnClosers:53](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/repair.ts#L53) |

脚本响应的组织形式参考 [Cookbook 第13章](https://github.com/zhangjessey/deepseek-harness-cookbook/blob/2b9d4d97f947017433bfd11dbc0ea601de7f28ca/src/ch13/agent-loop-demo.ts) 的脚本 adapter，以及官方 MockAdapter/调度测试的可控输入思路。本实验依照上述固定版本独立编写。
