# DeepSeek Harness 配套实验

[![Learning experiments](https://github.com/DavidDingXu/deepseek-harness-labs/actions/workflows/check.yml/badge.svg)](https://github.com/DavidDingXu/deepseek-harness-labs/actions/workflows/check.yml)

这个仓库配合《DeepSeek Harness 架构设计与源码解析》使用。你可以先跑一条工具调用，再逐步改变依赖、执行顺序和检查条件，观察运行时怎样响应。

建议使用 Node.js 24，并安装 Git。支持的 Node.js 范围是 `^22.19.0 || >=24.0.0`。实验固定使用 DSH `0.2.1-alpha.2`、Cordis `4.0.5-alpha.1`，由统一锁文件管理依赖。

## 第一次运行：看见工具结果进入下一次请求

在 macOS、Linux 终端或 Windows PowerShell 中执行：

```sh
git clone https://github.com/DavidDingXu/deepseek-harness-labs.git
cd deepseek-harness-labs
npm ci --ignore-scripts
node runtime/run.mjs --scenario basic
```

关键输出应包含：

```text
PASS normal: tool=42, turns=1, steps=2, requests=2, assistant/message=2, assistant/attempt=0
```

这里发生了一个完整往返：脚本模型提出 `sum(19, 23)` → 官方运行时执行工具 → 工具返回 `42` → 下一次模型请求收到同一调用的结果。第二次请求会核对调用编号和结果内容，交接不对就报错。

这个入口不连接模型服务，也不需要 API Key。模型响应由 `ScriptedAdapter` 固定提供；工具派发、循环推进、消息记录和结果提交运行官方包。先把机制看清，再接真实模型。

想改一个条件，打开 [runtime/run.mjs](runtime/run.mjs) 的 `normalTurn()`：将 `b: 23` 改为 `b: 24`，先保留两处结果断言的 `42`。实验应该失败；再把两处预期改为 `43`，应重新通过。具体步骤见 [工具往返实验](runtime/README.md)。

## 按你的学习进度选择入口

| 现在想做什么 | 入口 | 需要什么 |
| --- | --- | --- |
| 跟着文章验证某个机制 | 下表中的单项命令 | 安装依赖即可；运行时不调用模型 |
| 检查全部离线实验 | `npm test` | Node.js 与 Git |
| 换成真实模型请求 | [真实模型实验](real-model/README.md) | 自己的模型配置与凭据，会产生用量 |
| 在真实界面中操作三种扩展 | [Web 实验](web/README.md) | 独立的官方 DSH 安装与模型配置 |

以下命令都在 **`deepseek-harness-labs` 仓库根目录**执行，依赖只需安装一次。

## 按学习顺序运行

| 讲次 | 实验 | 从仓库根目录运行 | 观察什么 |
| --- | --- | --- | --- |
| 01、20 | [工具往返](runtime/README.md) | `node runtime/run.mjs --scenario basic` | 工具结果进入真实下一次请求；再核对调用身份与会话记录 |
| 03 | [Effect](cordis-lifecycle/README.md) | `node cordis-lifecycle/run.mjs` | 回滚、逆序发起、独立 Effect 并发与内部串行 |
| 04 | [依赖重激活](dependency-restart/README.md) | `node dependency-restart/run.mjs` | 等待、撤销、局部闭包重建 |
| 06 | [事件分发](event-modes/README.md) | `node event-modes/run.mjs` | 0/空串短路、异步等待和错误聚合 |
| 07 | [Waterfall](waterfall/README.md) | `node waterfall/run.mjs` | 调用栈、返回包裹与短路 |
| 08 | [Profile/Patch](profile-patch/README.md) | `node profile-patch/run.mjs` | 合成配置与真实服务行为同时变化 |
| 11 | [能力替换](capability-swap/README.md) | `node capability-swap/run.mjs` | 官方文件工具不改，Provider 替换、依赖撤销与拒绝无副作用 |
| 15、20 | [重试](runtime/README.md) | `node runtime/run.mjs --scenario retry` | 同一 Step 再请求一次，用户输入仍只有一份 |
| 16、20 | [取消](runtime/README.md) | `node runtime/run.mjs --scenario cancel` | 已展示的前缀以 interrupted 状态保留，Step 和 Turn 闭合 |
| 16 | [恢复算法](runtime/README.md) | `node runtime/run.mjs --scenario recovery` | 未启动与结果未知，补齐后不重复修复 |
| 17 | [上下文压缩](compaction/README.md) | `node compaction/run.mjs` | summary 与 replace 分离、摘要失败、回放一致 |
| 18 | [运行代继承](subagent/README.md) | `node subagent/run.mjs` | 子 Scope 精确继承父代，最后一个使用者退出后回收 |
| 21 | [并发顺序](runtime/README.md) | `node runtime/run.mjs --scenario order` | body 按 B/A 完成，结果按 A/B 提交 |
| 22 | [审查 Preset](review-preset/README.md) | `node review-preset/verify.mjs` | 真正挂载、绑定、限制与自有注册例外 |
| 23 | [审查工具](review-plugin/README.md) | `node review-plugin/run.mjs` | schema、Guard、Agent 隔离与卸载 |
| 24 | [交付证据](delivery-gate/README.md) | `node delivery-gate/run.mjs` | 真实失败检查、修复通过、再次修改失效 |

没有单独列出实验的讲次侧重设计推演，可以直接阅读文章，无须为了继续学习再搭一个工程。

## 打开代码后，先看哪里

不必从文件第一行一路追到底。先找到场景的输入和关键断言，再按需要回看装配过程。

| 想看清的动作 | 代码入口 |
| --- | --- |
| 发起一次工具调用、检查下一次模型请求 | [runtime/run.mjs](runtime/run.mjs) 的 `normalTurn()` |
| 让 B 先完成，但停在提交 A 之前 | 同文件的 `parallelOrder()`，关注 `gateB.resolve()` 前后的断言 |
| 把声明装配成真实插件树 | [preset-runtime/harness.mjs](preset-runtime/harness.mjs) 的 `createHost()`、`mountFile()` |
| 给审查 Agent 绑定组合、过滤继承工具 | [review-preset/verify.mjs](review-preset/verify.mjs)；界面切换时的过滤在 [web-readonly.mjs](review-preset/web-readonly.mjs) |
| 注册结构化报告，并在执行前拒绝写操作 | [review-plugin/review-plugin.mjs](review-plugin/review-plugin.mjs) 的 `apply()` |
| 记录检查结果、使旧证据失效、拒绝过早交付 | [delivery-gate/delivery-gate.mjs](delivery-gate/delivery-gate.mjs) 的 `observeToolResult()`、`deliveryStatus()`、`apply()` |

`runtime` 提供工具调用场景，`preset-runtime` 提供多个组合实验共用的官方服务装配。各目录的 README 解释输入、输出和限制；源码对照放在需要进一步核对的地方。

## 三个扩展，分别增加了什么

| 界面名称 | 对应代码 | 关键区别 |
| --- | --- | --- |
| 只读审查 | [review-preset](review-preset/README.md) | 过滤 Agent 继承的工具，只开放 read；完整 Web 还需挂载过滤插件 |
| 结构化审查 | [review-plugin](review-plugin/README.md) | 增加报告协议；write/edit 仍可见，Guard 在主体执行前拒绝它们 |
| 交付检查 | [delivery-gate](delivery-gate/README.md) | 接受检查结果；后续修改使旧证据过期，重新检查后才能交付 |

先运行这三个目录的离线实验，再去 Web 中操作，容易分清工具可见性、执行限制和交付条件。安装器只复制到显式指定的位置，不修改默认 Profile；复制 YAML 后仍须由宿主显式加载。

## 运行范围与检查

`npm test` 运行表中的全部离线实验、Web 只读过滤检查和交付状态机单元测试。断言失败会非零退出。需要文件的场景创建独立临时目录并自行清理；Session 恢复场景使用内存日志。

离线实验由 [GitHub Actions](https://github.com/DavidDingXu/deepseek-harness-labs/actions/workflows/check.yml) 在 macOS、Ubuntu、Windows / Node.js 24 上检查。真实模型与完整 Web 的实测环境是 macOS，二者不纳入 CI。离线通过只说明受控输入下的机制符合断言；模型行为、完整产品、磁盘恢复与操作系统沙箱分别需要对应的验证。

若安装失败，先核对 Node.js 版本，并在仓库根目录重新运行 `npm ci --ignore-scripts`。若某项断言失败，单独运行该目录的命令，根据错误中的预期值与实际值定位；不要删掉断言来让脚本通过。重新安装依赖不会撤销你对实验源码的修改。

本项目是独立学习实验，不是 DeepSeek 官方产品。官方实现通过锁定的 npm 依赖使用，各实验说明链接到对应源码。
