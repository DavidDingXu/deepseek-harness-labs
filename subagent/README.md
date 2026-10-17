# 父方还在用旧组合，子方应该继承哪一版

审查组合从 G1 更新到 G2，但已经开始的任务仍持有 G1。它现在创建子组合：孩子应该重新按名字取得 G2，还是继承父方实际使用的 G1？第 18 讲用运行代区分这些情况。

“运行代”指同一 Preset 声明在运行时装配出的某一版插件组合。实验用 G1、G2 作标记，不是模型版本。目录中有两个入口：run.mjs 用几个作用域（Scope）核对组合引用和回收；manager.mjs 创建真实父子 Agent，比较默认继承与独立选择后实际发给模型的工具表。

完成[依赖安装](../README.md)后，在仓库根目录执行：

```sh
node subagent/run.mjs
```

这个 Scope 实验不请求模型，使用官方 PresetRegistry、Loader、Scope 和工具运行时。关键输出包括：

```text
PASS replacement: parent=G1; fresh=G2; retained generations=2
PASS composeFrom: child=G1; exact generation identity matched; duplicate/unscoped joins rejected
```

parent 和 child 仍使用同一份 G1，新加入的 fresh 使用 G2。

## 按名字加入，与从父方继承有什么不同

实验给同一个 Preset ID `review-config` 先登记 G1，再撤下旧声明、登记 G2。G1、G2 都加载 [revision-plugin.mjs](./revision-plugin.mjs)，分别贡献 revision_G1、revision_G2 两个观察用工具。

| 操作 | 使用的组合 | 可见工具 |
| --- | --- | --- |
| parent 在更新前 mount review-config | G1 | revision_G1 |
| fresh 在更新后 mount 同一个名字 | G2 | revision_G2 |
| child 从 parent 继承 | G1 | revision_G1 |

child 使用的调用是：

```js
registry.composeFrom(child.ctx, parent.ctx)
```

它查父方实际绑定的运行代，并加入同一代。脚本通过 `scopeOf()`、`scopeParentOf()` 比较父子的实际绑定对象，确保是同一个 G1，而非只比较工具名称。生命周期日志里也只有一次 mount:G1：孩子加入已有组合，没有重装一份 G1。

打开 [run.mjs](./run.mjs)，按 declare、parent/fresh 挂载、composeFrom、依次释放 Scope 阅读。重复加入和在无 Scope 的 Context 上加入，都会被检查为错误。

## 什么时候才可以清理旧组合

G1 被新声明替代，表示它已经退休；但 parent、child 还在使用它。回收必须同时满足“已经退休”和“没有使用者”。

| 操作 | 仍保留几代 | 实际清理 |
| --- | --- | --- |
| 登记 G2，父子仍用 G1 | 2 | G1 未清理 |
| 释放 parent，child 还在 | 2 | G1 未清理 |
| 释放最后一个 G1 使用者 child | 1 | 执行 G1 清理函数 |
| 释放 G2 的使用者，当前声明仍在 | 1 | G2 未清理 |
| 撤下 G2 声明 | 0 | 执行 G2 清理函数 |

脚本观察 `inspectCompositions()` 返回的保留数量和标记插件的清理日志，不读写注册表的私有引用计数。G2 没有使用者时仍保留，是因为它还是当前可供新任务加入的组合。

## 为什么不能据此判断真实子任务会不会被取消

run.mjs 的几个 Scope 都由同一个 Host 创建，脚本分别持有它们的清理权。“父子”在这里只表示组合继承关系，未挂载 SubagentManager。

所以 parent 释放后 G1 仍存在，说明 child 仍持有组合引用。真实父 Agent 退出时，Manager 是否取消孩子、怎样等待孩子结束，是另外的任务管理规则。组合寿命与活跃任务寿命需要分别判断。

run.mjs 不包含子结果投递、模型请求、冷恢复或文件监听。G1→G2 通过真实声明撤销和登记完成，未运行完整代码热更新流程。依赖固定为 DSH `0.2.1-rc.2`，使用 [Preset 共享环境](../preset-runtime/README.md)，退出时清理临时目录并恢复 DSH_HOME。

## 真实孩子的请求里究竟有哪些工具

运行第二个入口：

```sh
node subagent/manager.mjs
```

它装配官方 AgentLoop、SubagentRuntime（包含 Manager）和进程内 spawn/fork Provider。模型适配器只返回固定的 done，记录的工具定义则来自 Loop 构造的真实子请求，没有调用模型网络。

父 Agent 先挂载 review-config 的 G1，再把同名声明换为 G2。随后依次检查：

| 调用 | 子请求工具表 | 其他断言 |
| --- | --- | --- |
| spawn 显式选 review-config | revision_G2 | 自有日志中选择事件只有一条，且先于子任务描述 |
| spawn 不指定 Preset | revision_G1 | 没有独立选择事件；父工具仍为 revision_G1 |
| fork 显式选相同名字 | 不产生请求 | 返回 UNSUPPORTED_CAPABILITY；没有新 Session/Agent 发布 |

选择和描述都在创建窗口写入，早于孩子第一次 Turn。它们不会补发到 session/event 的实时追加通知，因此实验在 agent/created 时取得真实 Session 的自有日志，保留先后顺序断言，并对照实时通知确实不包含这些创建记录。不能只订阅实时事件就认定日志里没有选择。

关键输出为：

```text
PASS independent: explicit same preset id uses G2; selection precedes the child descriptor
PASS inherited: omitted preset uses parent G1; parent tools remain unchanged
PASS admission: fork rejects independent preset before creating a child or requesting the model
```

这个入口验证真实管理器的在线创建与装配；没有挂载磁盘持久化或会话查询，未验证冷恢复、完整后代取消、模型自主选择或代码热更新。脚本等待每个子结果并释放句柄，退出时释放整个 Context、清理临时目录并恢复 DSH_HOME。

`npm test --workspace deepseek-harness-subagent-lab` 会依次执行这两个入口。

## 可选源码对照

- [composeFrom](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/preset/agent-preset-registry/src/index.ts#L292)：从父方实际绑定的代加入组合。
- [join](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/preset/agent-preset-registry/src/index.ts#L265)：增加该代的使用者。
- [collect](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/preset/agent-preset-registry/src/index.ts#L148)：检查退休状态与剩余使用者。
- [applyChildComposition](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/subagent/subagent/src/child-agent.ts#L186)：真实子 Agent 默认继承与独立挂载的分支。
- [官方代际保留测试](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/preset/agent-preset-registry/tests/registry.spec.ts#L40)：同一机制的上游对照。

- [默认继承与显式同名选择对照测试](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/subagent/subagent/tests/activation-presets.spec.ts#L144)。
- [创建窗口先写日志再发布 Agent](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/index.ts#L810)。
