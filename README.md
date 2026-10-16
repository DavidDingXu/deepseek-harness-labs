# DeepSeek Harness 架构与设计实验

[![Learning experiments](https://github.com/DavidDingXu/deepseek-harness-labs/actions/workflows/check.yml/badge.svg)](https://github.com/DavidDingXu/deepseek-harness-labs/actions/workflows/check.yml)

这里用可运行的小实验解释 DeepSeek Harness（DSH）的架构设计：工具怎样执行、结果按什么顺序提交、插件退出时怎样清理资源。改变输入后，断言会检查结果是否符合预期。

本仓库配套《DeepSeek Harness 架构设计与源码解析》，各实验文档可独立阅读。核心运行机制来自官方实现，模型响应等可控输入由脚本提供。

## 第一次运行：看见工具结果进入下一次请求

准备好 Node.js 24 和 Git，在终端执行。macOS、Linux 与 Windows PowerShell 使用相同命令：

```sh
git clone https://github.com/DavidDingXu/deepseek-harness-labs.git
cd deepseek-harness-labs
npm ci --ignore-scripts
node runtime/run.mjs --scenario basic
```

安装依赖需要联网；这个实验运行时不请求模型，也不需要 API Key。输出应包含：

```text
PASS normal: tool=42, turns=1, steps=2, requests=2, assistant/message=2, assistant/attempt=0
```

可以先看懂其中三个数：工具算出 `42`，一次输入驱动了 `1` 个 Turn，期间发起 `2` 次模型请求。过程是：

```text
预定响应提出 sum(19, 23)
    ↓
官方运行时执行 sum，得到 42
    ↓
第二次请求收到这个工具调用的结果
```

脚本会核对第二次请求中的调用编号和结果内容。循环推进、工具派发和消息记录都经过官方实现；`ScriptedAdapter` 只负责按顺序提供预定的模型响应。

接下来打开 [runtime/run.mjs](runtime/run.mjs) 的 `normalTurn()`，把 `b: 23` 改成 `b: 24`，先保留结果断言中的 `42`。实验应失败；把两处结果预期都改为 `43` 后应通过。[工具往返实验](runtime/README.md)解释了这两处检查分别观察什么。练习后恢复改动，再运行完整检查。

## 接下来走哪条路

| 你想做什么 | 入口 |
| --- | --- |
| 跟着某一讲验证机制 | 下方的实验目录，单独运行对应脚本 |
| 一次检查全部离线实验 | 在仓库根目录运行 `npm test` |
| 把预定响应换成真实模型 | [真实模型实验](real-model/README.md)，需要自己的模型配置与凭据，会产生用量 |
| 在官方 Web 中使用三个扩展 | [Web 实验](web/README.md)，需要另外安装官方 DSH 产品 |

下文的“仓库根目录”就是包含本 README、`package.json` 和 `package-lock.json` 的 `deepseek-harness-labs` 目录。所有运行命令均以这里为起点；依赖安装一次即可。

## 跑通以后，按这条顺序深入

前面的 basic 对应第 01、20 讲：先建立一次工具往返的全貌，再逐步拆开它依赖的机制。

### 先看插件怎样可靠地协作

- 第 03 讲 · [Effect 清理](cordis-lifecycle/README.md)：正常退出与安装失败，资源怎样撤销。
- 第 04 讲 · [依赖重新就绪](dependency-restart/README.md)：插件重新激活后，计数为何从 1 开始。
- 第 06 讲 · [事件分发](event-modes/README.md)：返回 0 会不会继续，异步监听器要不要等。
- 第 07 讲 · [Waterfall](waterfall/README.md)：next() 怎样控制下游调用和返回值。

### 再看配置怎样生效，能力怎样替换

- 第 08 讲 · [配置覆盖](profile-patch/README.md)：配置里的 5 改成 9，实际标题是否跟着变。
- 第 11 讲 · [文件能力替换](capability-swap/README.md)：同一 write 请求，为何随文件实现改变结果。

### 接着改变任务运行中的条件

- 第 15、20 讲 · [重试](runtime/README.md)：同一 Step 再次请求时，用户输入是否重复。
- 第 16、20 讲 · [取消](runtime/README.md)：已展示的回答前缀怎样保留在历史里。
- 第 16 讲 · [恢复算法](runtime/README.md)：怎样区分尚未启动与结果未知。
- 第 17 讲 · [上下文压缩](compaction/README.md)：摘要等待期间，历史变化怎样影响提交。
- 第 18 讲 · [组合版本继承](subagent/README.md)：父方仍用旧版，子方应继承哪一版。
- 第 21 讲 · [并发提交](runtime/README.md)：B 先执行完，为什么结果仍按 A、B 提交。

### 最后把机制组合成可使用的扩展

- 第 22 讲 · [只读审查组合](review-preset/README.md)：组合声明、Agent 绑定与工具过滤怎样配合。
- 第 23 讲 · [结构化审查插件](review-plugin/README.md)：程序怎样接收报告，Guard 怎样拒绝写操作。
- 第 24 讲 · [交付检查插件](delivery-gate/README.md)：文件再次修改后，旧的通过记录怎样失效。

未单列实验的讲次侧重设计推演，可直接跟随文章阅读。`preset-runtime` 是几个实验共用的[服务装配代码](preset-runtime/README.md)，需要理解装配过程时再看。

## 三个扩展在 Web 中有什么区别

| 模式名称 | 行为 |
| --- | --- |
| 只读审查 | 配套过滤插件把 Agent 继承的工具限制为 read |
| 结构化审查 | 增加结构化报告工具；write/edit 仍可见，但 Guard 在执行前拒绝调用 |
| 交付检查 | 记录测试与差异检查的结果；后续修改使旧证据过期，重新检查后才能交付 |

先跑离线实验，再去 Web 中操作，容易把工具可见性、执行限制和交付条件分清。手工安装器只复制文件；由宿主显式加载后，组合和插件才会生效。Web 准备脚本会完成这部分接入。

## 版本、检查和常见问题

Cordis 是 DSH 管理插件、服务和生命周期的底层框架。实验固定使用 DSH `0.2.1-alpha.2`、Cordis `4.0.5-alpha.1`。它们是预览版本；升级依赖可能改变接口或行为。支持的 Node.js 范围为 `^22.19.0 || >=24.0.0`，推荐直接使用 24。

`npm test` 不调用模型，覆盖全部离线场景、Web 只读过滤钩子及交付状态测试。有文件操作的实验使用自己的临时目录，退出时清理。会话实验主要使用内存日志，磁盘恢复须另外验证。三平台自动检查见 [GitHub Actions](https://github.com/DavidDingXu/deepseek-harness-labs/actions/workflows/check.yml)；真实模型和完整 Web 的实测环境为 macOS，二者不纳入 CI。

| 遇到的问题 | 先检查什么 |
| --- | --- |
| 找不到 package.json 或脚本 | 当前目录是否是上述仓库根目录 |
| 缺少依赖、依赖版本不符 | 核对 Node.js 版本，重新运行 `npm ci --ignore-scripts` |
| 出现 AssertionError | 单独运行该实验，比较错误中的 actual 与 expected；刚改过源码时，核对是否同步调整了实验预期 |
| Web 中没有三个模式 | 按 Web 文档使用独立安装，检查准备脚本是否完成、启动时是否带上生成的 patch |

本项目是独立学习实验，不是 DeepSeek 官方产品。官方实现通过锁定的 npm 依赖使用，各实验末尾提供需要进一步核对的源码入口。
