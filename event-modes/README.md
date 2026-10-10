# 事件分发实验

在仓库根目录运行 `npm ci`，然后运行 `node event-modes/run.mjs`。

直接调用真实 Cordis，验证三个容易看错的边界：`serial` / `bail` 遇到 `0` 或空字符串仍会短路；`emit` 不等待异步监听器；`parallel` 等待所有监听器落定后聚合错误。异步实验用显式 Promise 闸门推进，不依赖机器快慢或定时器碰巧按顺序结束。

依赖固定为 `@deepseek-ai/cordis@4.0.5-alpha.1`，与课程使用的 Cordis 版本一致。无需模型密钥，不创建产品会话。
