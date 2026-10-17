# 几个组合实验共用的服务装配

读配置覆盖、只读审查或组合版本继承的代码时，会遇到这里的 `harness.mjs`。它负责先把官方服务装好，让各个实验专注于自己的输入与断言。第一次学习可以从具体实验开始，需要核对装配时再回到这里。

| 入口 | 提供什么 |
| --- | --- |
| `checkVersions()` | 检查直接依赖是否与锁定版本一致 |
| `createHost()` | 创建 Context，并挂载加载器、模型调用接口、会话和工具等共享服务 |
| `createHost(..., { preset: true })` | 继续装配 Agent、文件能力、工作目录和 Preset 注册表，供需要绑定组合的实验使用 |
| `mountFile()` | 通过 Include 加载配置文件，等待并检查每个启用条目是否处于 ACTIVE 状态 |

Context 是插件注册和访问服务所用的上下文；这里的 Host 指这套共享装配环境。Include 负责把配置文件中的条目装入插件树。检查 ACTIVE 很重要：加载器没有待处理任务，也可能是某个条目已经失败。

[review-preset](../review-preset/README.md)、[profile-patch](../profile-patch/README.md)、[capability-swap](../capability-swap/README.md)、[subagent](../subagent/README.md) 和 [real-model](../real-model/README.md) 会复用这里的部分能力。模型凭据只在真实模型入口需要。

若要一起运行只读审查和配置覆盖两个离线实验，完成[根目录依赖安装](../README.md)后执行：

```sh
npm test --workspace deepseek-harness-preset-lab
```

`workspace` 是 npm 对本仓库子包的管理方式；这条命令会执行该子包 package.json 中的 test 脚本，不需要进入子目录重新安装依赖。其他实验仍使用各自 README 中的命令。

依赖固定为 DSH `0.2.1-rc.2`、Cordis `4.0.5`。共享代码负责装配和生命周期检查；Preset 注册、工具派发、配置覆盖等机制运行官方实现。各调用方负责创建和清理自己的实验目录。
