# 摘要回来以后，还能直接替换旧历史吗

压缩正在等待摘要，另一段代码改了历史。摘要使用的还是旧内容，这时应该提交还是放弃？如果只是历史末尾多了一条新消息，答案又是否相同？对应第 17 讲。

本实验运行官方 BasicCompactionEngine，通过预定的模型响应固定摘要内容。它检查压缩的选择、重验、提交与回放，不评测模型概括得好不好。

完成[依赖安装](../README.md)后，在仓库根目录执行：

```sh
node compaction/run.mjs
```

一次运行四个场景，最后应出现：

```text
All 4 compaction experiments passed; no model network call or persistence backend.
```

## 先分清两份历史

Session 中的日志保存发生过的事件；surface 则决定哪些消息按什么顺序进入当前模型历史。压缩会追加记录并改变 surface，已有日志仍保留。

脚本先给真实 Agent 发送一条较长输入，等待完成一个 Turn，由官方运行时产生用户、助手消息及其日志。之后手动调用：

```js
await ctx.compaction.compactNow(agent, new AbortController().signal)
```

引擎选择旧历史片段，发起摘要请求，收到响应后重新检查，再决定是否替换。脚本中的 ScriptedAdapter 负责给出短摘要或指定错误；选区与提交由官方引擎完成。

## 四种输入变化，对应四种结果

| 场景 | 摘要请求期间发生什么 | 预期结果 |
| --- | --- | --- |
| success | 历史不变，摘要成功 | 旧片段离开 surface，摘要替换消息进入模型历史 |
| failure | 摘要请求抛错 | 返回 summary 错误，不提交摘要或替换 |
| changed | 选中的旧消息被替换 | 返回 changed 错误，旧摘要不覆盖新内容 |
| appended | 只在选区外追加新消息 | 手动压缩成功，新消息完整保留在摘要之后 |

`PASS success`、`PASS failure`、`PASS changed`、`PASS appended` 分别对应这四行。打开 [run.mjs](./run.mjs) 的 `run(scenario)`，先读 changed 与 appended 两个分支：它们在同一个等待点改历史，容易直接比较差异。

## 正常提交为什么有 summary 和 user/message 两步

成功场景的新增事件顺序为：

```text
compaction/start → compaction/summary → user/message → compaction/end
```

compaction/summary 记录摘要调用与被替换的节点，不直接进入 surface。后面的 user/message 才带 replace 操作，替换可见片段，并用 sourceEventSeqs 记录摘要等来源。

脚本逐项核对旧日志前缀不变；被替换节点虽已离开 surface，仍能在日志里找到。随后用完整事件序列调用 `Session.create()` 回放，核对可见顺序与派生消息和当前 Session 一致。摘要与修改历史分别记账，才能同时保留来历和新的模型输入。

## 等待点怎样排除时序碰巧

changed 和 appended 都先等到摘要请求已取走旧历史，再通过 Session 的公开追加接口改变历史，最后放行摘要。顺序明确为“先取旧输入 → 修改历史 → 返回旧摘要”，不靠计时延迟。

changed 替换选区中的用户消息。返回 changed 后，surface 仍是竞争修改后的内容，压缩没有追加 summary 或自己的 replace，原日志与回放也保留竞争方的修改。

appended 追加的是 `LATER-EVIDENCE: also inspect src/extra.ts after the current review.`。它不在被选中的节点中，不能倒灌进已经发出的摘要请求。压缩成功后，其消息身份与完整内容不变，仍位于模型历史末尾。

这时“追加新消息”的日志序号小于摘要替换消息，但 surface 将摘要放在原选区，将新消息留在末尾。因此，日志时间顺序与模型阅读顺序不能混为一谈。

这项允许区外追加的结果属于手动入口的 selected-span 检查：只要求所选片段仍可替换。自动入口 compactRegion 使用更严格的 whole-surface 检查，要求整份 surface 符合原快照；手动场景的成功不能直接套到自动入口。

## 摘要失败发生在哪一步

failure 在摘要请求处抛错，检查错误分类为 summary、原因仍能追溯到原错误。此时没有 compaction/summary 或 replace；surface 和模型消息保持原样，start 对应一个带错误的 end。

实验未安装恢复监听器、工具结果裁剪或图片移出等插件，失败发生在任何摘要替换之前。若替换已提交，后续 flush 才失败，情况就不同；这里没有验证那个窗口。

## 装配与运行范围

脚本固定使用 DSH `0.2.1-rc.2`，依赖见 [package.json](./package.json)。`auto: false` 关闭自动压力触发，`compactionRetries: 0` 让摘要失败不进入缩小摘要的重试。手动调用仍经过真实维护窗口、选区、TokenMeter 估算、摘要请求、稳定性检查与提交。

Adapter 还核对摘要请求中确有旧证据和压缩指令，依据 `purpose === 'compaction'` 识别摘要请求。所有 Context 最后释放，15 秒超时只负责发现挂起。

实验不调用远程模型，不改默认 Profile，也不创建持久化 Session 文件。回放输入来自内存事件；虽然引擎请求 flush，没有持久化实现时不能据此证明磁盘保存。自动压力阈值、工具配对边缘及取消时序也需要各自的场景。

如需 npm workspace 入口，可运行 `npm test --workspace deepseek-harness-compaction-lab`，与上面的 Node 命令执行同一实验。

## 可选源码对照

实验运行官方 npm 包，源码链接用于定位相应实现。

- [compactNow：维护窗口与手动选区](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-basic/src/index.ts#L383)。
- [默认摘要器：重放输入，调用真实 LLM seam](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-basic/src/summarizer.ts#L122)。
- [等待摘要、重验稳定性、错误关闭及 flush](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-basic/src/region.ts#L173)。
- [手动选区允许区外新增节点](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-basic/src/region.ts#L442)。
- [summary 日志与 replacement 消息分别提交](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-basic/src/region.ts#L491)。
- [手动失败的分类](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-basic/src/region.ts#L277)。
