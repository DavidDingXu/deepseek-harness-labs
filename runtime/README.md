# 真实 AgentLoop：从工具调用到有序提交

本实验使用官方 npm 发布的 Harness Runtime。脚本只替换 LLM adapter 的响应与演示工具，不实现另一套 AgentLoop、Session、Tool Registry 或并行调度器。

对应主线第 20 讲的 `basic`，以及第 21 讲的 `order`。`retry`、`cancel` 用来对照同一 Step 内的多次模型尝试，以及取消后的流结算。`recovery` 是第 16 讲可选的内存恢复算法对照。

## 运行

进入上一级 `labs` 目录，使用 Node.js `^22.19.0 || >=24.0.0`：

```sh
npm ci --ignore-scripts
npm test
```

只运行一项：

```sh
npm run basic --workspace deepseek-harness-runtime-lab
npm run order --workspace deepseek-harness-runtime-lab
npm run retry --workspace deepseek-harness-runtime-lab
npm run cancel --workspace deepseek-harness-runtime-lab
npm run recovery --workspace deepseek-harness-runtime-lab
```

也可以使用统一入口：

```sh
node runtime/run.mjs --scenario basic
node runtime/run.mjs --scenario order
node runtime/run.mjs --scenario cancel
node runtime/run.mjs --scenario recovery
node runtime/run.mjs --scenario all
```

无参数等同 `all`。命令不依赖 Bash、Unix 路径或环境变量赋值，适用于 macOS、Windows 与 Linux 的 Node 环境。实际执行验证是在 macOS、Node v24.14.1、npm 11.11.0 完成；没有将此结果称为 Windows 或 Linux 实测。

下载依赖时需要访问 npm registry；运行实验不连接模型，不需要模型凭据，也不读取或修改默认 profile。实验只使用内存 Session，不安装文件、进程或沙箱 Provider，不写持久化文件，也不创建临时目录。每项实验都在 `finally` 中等待 Context 退出。

## 运行的是哪个实现

[package.json](./package.json) 精确声明 Cordis `4.0.5-alpha.1` 与 DSH `0.2.1-alpha.2`，统一的 [package-lock.json](../package-lock.json) 锁定完整依赖图和 npm tarball integrity。四个 Cordis 机制实验与本实验共享同一版本的 Cordis，依赖由 npm workspace 管理；没有使用 `--legacy-peer-deps` 忽略冲突。

`run.mjs` 启动时读取已安装包的 package.json，逐项检查直接依赖版本；偏离固定版本即失败。`dsh-session-persistence` 等包满足官方 peer 合同，但本实验没有挂载持久化 backend。

源码入口为[对应版本源码](https://github.com/deepseek-ai/deepseek-harness/tree/d743267388641bc76f17c45ce8b4c231aed1d32c)。该源码的根包版本为 `0.2.1-alpha.2`，vendor/cordis 为 `4.0.5-alpha.1`。实验执行官方 npm 发布的 JavaScript 产物，链接中的 TypeScript 用于阅读实现。

服务装配与官方 [agent-loop tests](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/tests/agent.spec.ts#L24) 对应：

```text
LlmRuntime
SessionStore
SessionProjectionRegistry
SystemPrompt
ToolRuntime（native）
AgentRegistry
AgentLoop（不自动创建 Agent，并发上限 2）
```

最后注册自定义 `ScriptedAdapter`，再 await `ctx.agentLoop.create()`。这里特别包含新版所需的 SessionProjectionRegistry，也没有沿用旧示例中同步创建 Agent 的写法。

## 第 20 讲：basic 验证一次真实工具往返

脚本 adapter 的第一次响应包含 `sum(19, 23)` 工具调用。真正执行的 `sum` body 通过 `defineTool` 注册，规范输出为 number，render 将其变成模型可见的文本 `42`。

AgentLoop 派发这个工具，再构造第二次请求。第二次 adapter 不直接返回预先写好的“成功”：它先断言真实请求的 tool 消息存在且内容为 `42`，再把这份结果写进答案。这个检查证明工具结果已经进入下一次请求，不证明脚本 adapter 拥有语言理解能力。

断言覆盖：

- body 只调用一次，结果确实为 42。
- 一次 Turn 包含两次 Step，两次模型请求各产生一条 assistant/message。
- tool/result 进入 Session，并出现在下一次请求中。
- 没有 assistant/attempt，也没有逐条 assistant/chunk Session 事件。
- 每次 live end frame 都指向已有的结算事件；Session commit 在 live end 之前。
- 每个结算事件内嵌非空 compact stream。

## 第 21 讲：order 验证 B 先完成，A 先提交

adapter 一次请求两个并发安全工具，模型顺序是 A、B。每个工具由独立 Promise 门闩控制，不以“睡眠 100ms”猜测调度顺序。

实验等到 A、B 都启动，先释放 B。B 的 body 完成后，让当前 Promise continuation 收敛一轮，A 仍然阻塞。此时断言 `tools/result` 与 Session `tool/result` 都还没有出现，再释放 A。

最终断言三条序列：

```text
body completion:     B, A
tools/result:        A, B
Session tool/result: A, B
```

这验证真实 body 并发及提交顺序的差异。实验不通过伪造日志或手动排序结果实现 A、B；顺序来自官方 AgentLoop 调度器。

`setImmediate` 只提供一次事件循环检查点，让 B 的 Promise 后续处理运行；它没有时间阈值，也不决定谁先完成。15 秒 watchdog 仅用于发现挂起的实验并以非零退出，不参与正常顺序。

## retry 与 cancel 验证什么

`retry` 第一次返回受控的 `SERVER_ERROR` finish。实验注册一个 `agent/request-error` middleware，仅允许一次重试。第二次成功后，断言同一 Turn、同一 Step 中有两次请求，一条 assistant/attempt、一条 assistant/message；派生 surface 只有成功的 assistant 消息。另断言 user/message 只接纳一次，两次请求中的用户消息完全相同，防止把请求重试误写成重新投递输入。重试政策是实验插件给出的，不应称为 AgentLoop 默认自动重试所有失败。

`cancel` 先发出可见前缀 `Visible prefix`，然后等待 abort。取消之前断言 Session 尚无 assistant/message；调用真实 `agent.cancel({ kind: 'user' })` 并等待 idle 后，断言前缀被保存为 `interrupted: true` 的 assistant/message，Turn 为 aborted，Step 正常闭合。它没有假装未完成文本是完整成功答案。

两个实验分别说明：失败尝试不一定进入模型 surface；取消已经展示的内容，也不等于将这段事实从历史中抹掉。

## recovery 验证两类缺失结果

这项不运行 adapter，也不伪造 Harness：使用官方 `Session.create` 和 `Session.append` 分别构造两个有效的开放尾部，区别只有是否存在 `tool/call`。然后把真实日志交给官方导出的 `ToolCallRecovery` 与 `interruptedTurnClosers`。

- assistant/message 已含 tool-call，但无 tool/call：错误码为 `TOOL_NOT_STARTED`。
- 已有 tool/call，但无 tool/result：错误码为 `TOOL_OUTCOME_UNKNOWN`，结果来源引用已有的 call seq。

断言两条路径都产生 `tool/result → step/end → turn/end`，序号连续，结束原因为 interrupted。计算修复候选不会改变 Session；将候选通过 Session.append 接纳后，原始前缀保持不变，派生消息含错误结果，再次修复返回空。

这里没有调用 `demo_write` 的 body，也没有写入真实文件。它证明算法如何解释记录缺口，不证明外部操作究竟有没有执行；尤其不能从 UNKNOWN 推导出“可以放心重试写入”。没有创建、终止或重启子进程。

## 实际输出

2026-10-11 在上述环境由根目录实验检查器运行本脚本，退出码 0。下面是实际程序输出，不含 npm 自己打印的脚本标题：

```text
Runtime: dsh 0.2.1-alpha.2; Cordis 4.0.5-alpha.1; official npm packages
PASS normal: tool=42, turns=1, steps=2, requests=2, assistant/message=2, assistant/attempt=0
  log: agent/inbox/spliced -> turn/start -> agent/inbox/spliced -> step/start -> system/message -> user/message -> request/header -> request/context -> assistant/message -> tool/call -> tool/result -> step/end -> step/start -> assistant/message -> step/end -> turn/end
  live: start/chunk/end; each end follows its Session commit; Session assistant/chunk=0
PASS retry: turns=1, steps=1, requests=2, accepted inputs=1, identical retry input, assistant/attempt=1, surface assistant messages=1
PASS parallel: body completion=B,A; tools/result=A,B; Session tool/result=A,B
PASS cancel: interrupted=true, text="Visible prefix", turn=aborted, step closed
PASS recovery: no call=TOOL_NOT_STARTED; call without result=TOOL_OUTCOME_UNKNOWN
  closers: tool/result -> step/end -> turn/end; second repair=0; in-memory algorithm only
All 5 experiments passed; every Context disposed; no profile or persistence files written.
```

`PASS normal` 对应 `basic`；`PASS parallel` 对应 `order`。日志里的额外 inbox、request/header、request/context 事件是真实 Runtime 输出；实验没有把旧版本的固定事件数量当作新版本合同。

## 沿源码核对

| 实验观察 | 当前官方实现 |
| --- | --- |
| followup 进入 next-turn，Turn/Step 驱动 | [agent.ts:154](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/agent.ts#L154)、[Turn loop:299](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/agent.ts#L299) |
| live stream、message/attempt 结算 | [AssistantStreamAttempt:60](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/assistant-stream.ts#L60)、[settle:78](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/assistant-stream.ts#L78) |
| 同 Step 内重试与取消前缀 | [agent.ts:465](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/agent.ts#L465)、[request-error:505](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/agent.ts#L505) |
| 工具准备、派发、最终结果 | [tools/index.ts:1375](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/tools/src/index.ts#L1375) |
| B先完成，A先提交 | [tool-calls.ts:147 的 commitReady](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/tool-calls.ts#L147)、[并发调度测试:230](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/tests/tool-calls.spec.ts#L230) |
| 失败 attempt 不成为 surface 消息 | [SessionEventMap:341](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/types.ts#L341)、[deriveMessages:984](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/index.ts#L984) |
| 恢复候选与开放尾部闭合 | [ToolCallRecovery:118](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/repair.ts#L118)、[openTurnClosers:53](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/repair.ts#L53) |

教学形式参考 [Cookbook 第13章](https://github.com/zhangjessey/deepseek-harness-cookbook/blob/2b9d4d97f947017433bfd11dbc0ea601de7f28ca/src/ch13/agent-loop-demo.ts) 的脚本 adapter，以及官方 MockAdapter/调度测试的可控输入思路。本实验针对当前版本另写，未直接运行 Cookbook 的旧版代码，也未复制它的旧事件计数。

## 证据边界

这里的 commit 是内存 Session 接纳事件，不是磁盘 fsync。没有挂载 JSONL backend，因此本实验不验证断电恢复、损坏文件修复或跨进程持久化；取消对照也不是杀死进程的崩溃实验。

它验证的是真实运行时在受控输入下的协议、调度与投影。它不验证模型智能、线上 Provider、PTC、文件沙箱或产品 UI。运行依赖可由锁文件重新安装，`node_modules/` 不属于需要打包的实验源码。
