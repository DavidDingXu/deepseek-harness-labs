# 真实 Compaction：保留日志，替换模型历史

本实验直接挂载官方 `@deepseek-ai/dsh-compaction-basic@0.2.1-alpha.2`。只用 ScriptedAdapter 提供普通回复和摘要；没有继承或覆盖压缩引擎，没有手工写 compaction 事件。四个场景分别检查正常替换、摘要失败、选区内替换拒绝，以及选区外追加后仍成功提交。后两个场景通过 Session 的公开追加接口模拟扩展在摘要等待期间改变历史。

## 运行

在仓库根目录，使用 Node.js `^22.19.0 || >=24.0.0`：

```sh
npm ci --ignore-scripts
node compaction/run.mjs
```

或运行 workspace 命令：

```sh
npm test --workspace deepseek-harness-compaction-lab
```

[package.json](./package.json) 精确固定 Cordis `4.0.5-alpha.1` 和 DSH `0.2.1-alpha.2`，依赖纳入统一 lockfile。脚本开始时检查每个直接依赖版本。下载依赖需要 npm registry；运行不调用外部模型，不需要凭据，不读写默认 Profile，也不创建持久化 Session 文件。

## 先产生真实历史，再交给官方引擎

每个场景各创建一套 Context，装配 LLM、Session、SessionProjection、SystemPrompt、Tools、AgentRegistry、AgentLoop、TokenMeter 和 BasicCompactionEngine。

脚本向真实 Agent 发送一条较长输入，等待它完成一个 Turn。ScriptedAdapter 返回普通文本，因此 user/message、assistant/message、请求边界和 surface 都由官方 AgentLoop 与 Session 产生。

随后调用：

```js
await ctx.compaction.compactNow(agent, new AbortController().signal)
```

`auto: false` 关闭自动压力触发；`compactionRetries: 0` 让实验的失败输入不进入缩小摘要的重试。手动入口仍使用真实 `agent.runMaintenance`、选区选择、TokenMeter 定价、摘要请求、选区重验和提交逻辑。

Adapter 根据 `purpose === 'compaction'` 识别摘要请求，并先断言真实请求里有旧证据和引擎追加的压缩指令。成功场景返回一段短摘要，失败场景抛出指定错误，两种并发变化场景则先等待受控信号再返回摘要。选区、重验和压缩提交均运行官方包导出的实现。

## 成功验证的不只是“摘要变短”

实验检查新增事件恰好沿下列主链出现：

```text
compaction/start → compaction/summary → user/message → compaction/end
```

`compaction/summary` 没有 surfaceOp，也没有进入 surface；它记录真实 LLM seam 调用和被遮蔽节点。随后的 user/message 带 replace 操作，sourceEventSeqs 指向 summary 等来源；只有这个新消息改变可见历史。

被遮蔽节点不再进入下一次派生消息，但旧事件全部仍在日志中，原日志前缀逐项完全相同。脚本还把完整事件序列交给官方 `Session.create` 回放，核对回放后的 surface 和派生消息与运行中的 Session 一致。

这些检查能区分“替换模型历史”与“删除原始事实”。它们不能证明脚本摘要保留了全部语义；摘要内容由实验预先指定，没有测试模型的概括能力。

## 失败验证的是哪个窗口

第二套 Context 中，摘要 Adapter 抛错。实验核对 `ManualCompactionError.code === 'summary'` 与原始 cause，并确认：

- 没有 compaction/summary，也没有 replace 事件。
- surface 和派生消息与压缩前相同，原日志前缀仍完整。
- compaction/start 对应一个带 error 的 compaction/end，手动维护的 turn 为 null。

本实验没有挂载 recovery listener、ToolResultPruner 或 ImageOffload 插件，因此失败发生在任何摘要替换之前。不能把结果扩大为“所有压缩失败都会恢复原 surface”：已提交替换后的 flush 失败，以及恢复策略先产生进展再失败，是另外的窗口。

## 摘要等待期间，选区被另一方改掉

第三套 Context 先让真实摘要请求读取旧历史，再由 Adapter 的等待点暂停返回。脚本通过 `session.append` 的 replace 操作替换选区中的用户消息，记录修改后的 surface 和派生消息，然后放行旧摘要。

实验断言：

- 手动压缩以 `ManualCompactionError.code === 'changed'` 拒绝。
- 没有 compaction/summary，唯一的 replace 来自竞争方，旧摘要没有覆盖新内容。
- 原日志前缀保持不变，compaction/end 记录失败并关闭本次尝试。
- 当前模型历史与竞争方改完时一致；用完整日志回放后，surface 和派生消息仍一致。

这个等待点保证“先取旧历史，再改选区，最后返回摘要”的顺序，不依靠计时延迟。它模拟扩展直接修改 Session，不表示普通 followup 会绕过 Agent 的维护队列。

## 摘要等待期间，选区外新增内容仍被保留

第四套 Context 沿用相同等待点，但只在当前 surface 末尾追加一条 `user/message`，不替换已选中的节点。新增内容是 `LATER-EVIDENCE: also inspect src/extra.ts after the current review.`，它在摘要请求取得输入之后才出现。

放行摘要后，实验断言：

- `compactNow` 成功提交，新增节点不在 `shadowedSeqs` 中。
- 原日志前缀保持不变，已选中的旧节点离开 surface，摘要替换节点进入原选区。
- 新增节点的日志序号小于摘要替换节点，却仍位于 surface 的末尾；模型阅读顺序是摘要在前、新增内容在后。
- 新增消息的身份与完整内容保持不变，也没有倒灌进已经取走输入的摘要请求。
- 完整日志回放后的 surface、派生消息与运行中的结果一致，新增消息仍保留。

这项正向对照验证了手动入口的 `selected-span` 规则：它要求选中的片段仍可替换，允许区外追加与压缩共存。自动入口 `compactRegion` 使用更严格的 `whole-surface` 检查，这里的成功结果不适用于那个入口。

## 实际结果

2026-10-13，macOS / Node.js v24.14.1，运行退出码 0：

```text
PASS success: real BasicCompactionEngine + scripted LLM; summary=log-only; user/message=replace
PASS history: original log prefix unchanged; shadowed nodes leave surface; replay derives the same messages
  appended: compaction/start -> compaction/summary -> user/message -> compaction/end
PASS failure: summary request rejected; surface unchanged; no summary or replacement; start/end closed
PASS changed: selected history replaced while summary waits; stale summary rejected; competing edit survives replay
PASS appended: outside node retained after summary; log order=append,summary; surface order=summary,append; content and replay unchanged
All 4 compaction experiments passed; no model network call or persistence backend.
```

所有 Context 在 finally 中等待退出。15 秒 watchdog 只用于发现挂起，不参与正常时序。实验不依赖 shell 环境变量语法。上述输出来自 macOS 本地运行；Ubuntu、macOS、Windows 的自动检查结果见 [GitHub Actions](https://github.com/DavidDingXu/deepseek-harness-labs/actions/workflows/check.yml)，查看与所用代码版本对应的运行即可。

这里的回放来自内存事件快照。`compactNow` 会请求 Session flush，但没有安装持久化 backend，因此没有验证磁盘 fsync、断电恢复或 flush 失败。也没有验证操作系统沙箱、自动入口的整份历史检查、自动压力阈值、工具配对边缘及取消时序；这些属于不同断言。

## 沿源码核对

实验运行官方 npm 包，源码链接用于定位相应实现。

- [compactNow：维护窗口与手动选区](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/compaction/compaction-basic/src/index.ts#L383)。
- [默认摘要器：重放输入，调用真实 LLM seam](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/compaction/compaction-basic/src/summarizer.ts#L122)。
- [等待摘要、重验稳定性、错误关闭及 flush](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/compaction/compaction-basic/src/region.ts#L173)。
- [手动选区允许区外新增节点](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/compaction/compaction-basic/src/region.ts#L442)。
- [summary 日志与 replacement 消息分别提交](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/compaction/compaction-basic/src/region.ts#L491)。
- [手动失败的分类](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/compaction/compaction-basic/src/region.ts#L277)。
