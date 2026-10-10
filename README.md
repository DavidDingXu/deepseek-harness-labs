# DeepSeek Harness 配套实验

所有实验使用当前课程基线：DSH `0.2.1-alpha.2`、Cordis `4.0.5-alpha.1`。依赖由仓库的统一锁文件管理。Node.js 使用 `^22.19.0 || >=24.0.0`。

先克隆独立仓库，在 macOS、Linux 终端或 Windows PowerShell 中执行：

```sh
git clone https://github.com/DavidDingXu/deepseek-harness-labs.git
cd deepseek-harness-labs
npm ci --ignore-scripts
npm test
```

`npm test` 不连接模型，不需要凭据；配置和文件实验使用独立临时目录并自行清理。已实测环境是 macOS、Node.js v24.14.1、npm 11.11.0；跨平台命令不等于已在三种系统全部验收。

## 按学习顺序运行

| 讲次 | 实验 | 从仓库根目录运行 | 观察什么 |
| --- | --- | --- | --- |
| 03 | [Effect](cordis-lifecycle/README.md) | `node cordis-lifecycle/run.mjs` | 回滚、逆序发起、独立 Effect 并发与内部串行 |
| 04 | [依赖重激活](dependency-restart/README.md) | `node dependency-restart/run.mjs` | 等待、撤销、局部闭包重建 |
| 06 | [事件分发](event-modes/README.md) | `node event-modes/run.mjs` | 0/空串短路、异步等待和错误聚合 |
| 07 | [Waterfall](waterfall/README.md) | `node waterfall/run.mjs` | 调用栈、返回包裹与短路 |
| 08 | [Profile/Patch](profile-patch/README.md) | `node profile-patch/run.mjs` | 合成配置与真实服务行为同时变化 |
| 16 | [恢复算法](runtime/README.md) | `node runtime/run.mjs --scenario recovery` | 未启动与结果未知，补齐后不重复修复 |
| 17 | [上下文压缩](compaction/README.md) | `node compaction/run.mjs` | summary 与 replace 分离、摘要失败、回放一致 |
| 18 | [运行代继承](subagent/README.md) | `node subagent/run.mjs` | 子 Scope 精确继承父代，最后一个使用者退出后回收 |
| 20 | [工具往返](runtime/README.md) | `node runtime/run.mjs --scenario basic` | 工具结果进入真实下一次请求 |
| 20 | [重试与取消](runtime/README.md) | `node runtime/run.mjs --scenario retry` / `cancel` | Turn、Step、Attempt 与中断前缀 |
| 21 | [并发顺序](runtime/README.md) | `node runtime/run.mjs --scenario order` | body 按 B/A 完成，结果按 A/B 提交 |
| 22 | [审查 Preset](review-preset/README.md) | `node review-preset/verify.mjs` | 真正挂载、绑定、限制与自有注册例外 |
| 23 | [审查工具](review-plugin/README.md) | `node review-plugin/run.mjs` | schema、Guard、Agent 隔离与卸载 |
| 24 | [交付证据](delivery-gate/README.md) | `node delivery-gate/run.mjs` | 真实失败检查、修复通过、再次修改失效 |

`npm test` 运行上述正式实验以及交付状态机单元测试。单项失败会非零退出，不用人工判断“看起来成功”。完整上游测试、线上模型、Web/SDK 产品以及各操作系统沙箱不在该命令的证明范围内。

## 代码组织

`runtime` 与 `preset-runtime` 是两组共享官方服务装配；其余目录保存具体实验。工具调用实验里的模型响应和少量工具 body 是教学输入，循环、Session、Registry、Loader、政策和调度使用官方实现。各 README 说明哪些路径实际经过、哪些没有。

扩展案例的安装器只复制到显式指定的位置，不修改默认 Profile，不依赖旧版隐藏目录扫描。复现优先使用各目录的验证脚本，再根据项目需要接入完整产品。

## 接入真实模型

[真实模型实验](real-model/README.md)使用官方 llm-pi-ai，验证工具往返、只读 Preset、审查 Guard 与交付证据过期。2026-10-10 已用 gpt-6-luna 和 Responses 跑通四项。它是需要显式提供凭据的独立入口，不纳入默认离线测试。

## 从完整 Web 运行三个扩展

[Web 实验](web/README.md)提供独立安装、Preset 接入、真实模型操作和逐项验收。已实际验证只读读取、官方写工具的 Guard 拒绝、官方 Shell 的交付检查与过期拒绝、停止和历史恢复。产品界面与离线断言分别保留证据。

本项目是独立学习实验，不是 DeepSeek 官方产品。官方实现通过锁定的 npm 依赖使用，各实验说明链接到对应源码。
