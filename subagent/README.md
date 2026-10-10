# 子组合为什么继承父亲持有的旧代

本实验对应第 18 讲的组合继承机制，使用官方 npm `0.2.1-alpha.2`，源码入口为[对应版本源码](https://github.com/deepseek-ai/deepseek-harness/tree/d743267388641bc76f17c45ce8b4c231aed1d32c)。它实际运行 PresetRegistry、Loader、Scope 和 ToolRuntime，不重写代际管理或引用计数。

在仓库根目录执行：

```sh
npm ci --ignore-scripts
node subagent/run.mjs
```

也可运行 workspace 的检查：

```sh
npm test --workspace deepseek-harness-subagent-lab
```

要求 Node `^22.19.0 || >=24.0.0`。运行时不连接模型，不需要凭据；复用 [Preset 运行环境](../preset-runtime/README.md)，只创建并清理自己的临时目录，不读取或改动默认 Profile。以下输出已在 macOS、Node v24.14.1 实际得到：

```text
PASS replacement: parent=G1; fresh=G2; retained generations=2
PASS composeFrom: child=G1; exact generation identity matched; duplicate/unscoped joins rejected
PASS parent scope released: child still retains G1; G1 disposer has not run
PASS last G1 scope released: G1 collected; G2 tool remains visible
PASS collection: current G2 survives zero users; retiring it runs its disposer; retained=0
All generation checks passed; no model or SubagentManager run; temporary directory removed.
```

## 先预测子作用域应该看见哪一个工具

实验用同一个 Preset ID `review-config` 依次登记 G1 和 G2。两个代都由 Loader 挂载同一份小插件，只是配置不同：G1 注册 `revision_G1`，G2 注册 `revision_G2`。这些是观察用的标记工具，不是产品内置工具。

父作用域先加入 G1。随后撤下旧声明、登记同 ID 的 G2。新作用域按名字 mount 时取得 G2，父作用域仍看见 G1。此时再执行：

```js
registry.composeFrom(child.ctx, parent.ctx)
```

子作用域看见的是 `revision_G1`。脚本不只比较名字，还通过官方 `scopeOf`、`scopeParentOf` 比较父子实际绑定的 generation key，确认它们是同一个对象，并且与新作用域的 key 不同。重复加入和用无 Scope 的 Context 加入都会被实际拒绝。

Registry 的 [composeFrom](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/preset/agent-preset-registry/src/index.ts#L292) 从父的实际绑定找到 generation，调用 [join](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/preset/agent-preset-registry/src/index.ts#L265) 增加使用者，而不是按 Preset 名字重新选择最新版。插件的 mount 记录也只有 G1、G2 各一次：子作用域没有额外重装一份 G1。

## “没有使用者”和“已经退休”要同时成立

我们依次释放父、子、新作用域，观察官方 `inspectCompositions()` 的保留数量与标记插件真实 disposer 的执行。

| 操作 | 保留数量 | 被观测到的清理 |
| --- | --- | --- |
| G1 被新声明 G2 替代，父与子继续用 G1 | 2 | G1 未清理 |
| 释放父作用域，子仍持有 G1 | 2 | G1 未清理 |
| 释放最后一个使用 G1 的子作用域 | 1 | G1 disposer 执行 |
| 释放 G2 的使用者，但保留当前声明 | 1 | G2 未清理 |
| 撤下 G2 声明 | 0 | G2 disposer 执行 |

这里没有读取或改写 Registry 的私有 users 计数。两项条件通过外部可见行为交叉核对，对应官方 [collect](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/preset/agent-preset-registry/src/index.ts#L148)：只有 retired 且 users 为零时才释放组合 Scope。旧代有使用者时不能回收，当前代没有使用者时也不能提前销毁。

观察插件的 lifecycle 数组只记录自身挂载与撤销。保留代、继承关系、工具可见性和撤销时机，全由安装的官方运行时决定。

## 这个实验没有证明父退出后子 Agent 会继续运行

三个 Scope 都由同一个 Host 创建，实验程序分别持有它们的清理权。所谓父、子，是 `composeFrom` 的组合继承关系；这里没有启动真实子任务，也没有挂载 SubagentManager。因此，父 Scope 释放后 G1 仍保留，只证明组合引用尚未归零，不能推出真实父 Agent 退出时 Manager 不会取消孩子。

实际子 Agent 的组合入口在 [setupChildComposition](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/subagent/subagent/src/child-agent.ts#L198)。它调用本实验验证的 composeFrom；活跃任务的停止与等待则由 Manager 另行管理。这正是第 18 讲要区分的两种寿命。

本实验还没有覆盖模型请求、工具 body 执行、子结果投递、冷恢复或在线文件监听。G1→G2 使用 Registry 的真实声明撤销／登记接口，不把它宣称成完整 HMR 测试。官方 [代际保留测试](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/preset/agent-preset-registry/tests/registry.spec.ts#L40) 提供相同机制的上游对照。
