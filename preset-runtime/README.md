# 组合实验的共享运行环境

本 workspace 精确锁定 Cordis `4.0.5-alpha.1` 与 DSH `0.2.1-alpha.2`。`harness.mjs` 只装配官方服务，并检查 Include 子树的真实激活状态；它没有重新实现 PresetRegistry、ToolRuntime、Patch 算法或 SessionTitle。

从仓库根目录运行：

```sh
npm ci --ignore-scripts
npm test --workspace deepseek-harness-preset-lab
```

具体输入、断言、实际输出和证据边界见 [Preset 实验](../review-preset/README.md) 与 [Profile/Patch 实验](../profile-patch/README.md)。依赖下载需要 npm registry；两项实验运行时不连接模型，不读取默认 Profile，不需要凭据。文件操作限于各自创建并清理的临时目录，但这不是 OS 沙箱测试。
