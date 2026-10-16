# 依赖恢复为什么不是状态恢复

在仓库根目录运行 `npm ci --ignore-scripts`，然后执行：

```bash
node dependency-restart/run.mjs
```

实验固定使用 `@deepseek-ai/cordis@4.0.5-alpha.1`，不需要 API Key、模型或默认用户配置。macOS、Linux、Windows 均使用相同 Node 命令，离线实验由仓库 CI 检查。

先预测三件事：Consumer 先安装、Provider 尚未出现时，apply 会不会执行？卸载 A 之后，旧 ping 监听器会不会留下？B 上线后，计数会从 3 还是 1 开始？

实际输出：

```text
before provider: activations=0, ping has no listener
provider A disposed: consumer cleaned up, ping has no listener
reactivated: activations=2, A:1 -> A:2 -> cleanup:A -> B:1
```

脚本用断言检查全过程，并等待生命周期转换，不用定时 sleep 猜测启动完成。`localCount` 在每次 apply 内创建，因此第二次从 1 开始；`activations` 在外部，仍然累加到 2。框架重跑插件入口，不替业务恢复旧闭包，也不会清空所有 JavaScript 内存。

可以改一个变量再运行：把 localCount 移到函数外，并把脚本中两处断言的 `B:1` 改成 `B:3`，再观察它跨激活保留。只移动变量而不更新断言，会按预期触发失败：断言正好指出状态不再重置。这是状态所有权变化，不是依赖机制失效。不要删掉 inject 后仍保留服务属性访问；依赖声明也参与访问校验。

源码对照：[Fiber 的依赖与重激活](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/vendor/cordis/src/fiber.ts#L588)、[Provider 清理](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/vendor/cordis/src/reflect.ts#L297)。

实验选题参考 [DeepSeek Harness Cookbook 的依赖启停示例](https://github.com/zhangjessey/deepseek-harness-cookbook/blob/2b9d4d97f947017433bfd11dbc0ea601de7f28ca/src/ch02/hello-inject.ts)，脚本独立编写，额外用监听器消失和闭包计数区分“重新激活”与“恢复业务状态”。
