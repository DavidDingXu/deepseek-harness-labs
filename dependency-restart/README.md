# 依赖回来以后，插件会从哪里重新开始

一个插件依赖 `labValue` 服务。服务还没出现时，它会不会先执行？服务 A 被卸载、服务 B 接替后，插件之前的计数还在不在？对应第 04 讲。

实验中有两个角色：提供服务的插件叫 Provider，读取服务并监听 `lab/ping` 的插件叫 Consumer。`consumer.inject = ['labValue']` 告诉框架：只有这个服务就绪，才运行 consumer 入口。

首次使用先完成[依赖安装](../README.md)，然后在仓库根目录执行：

```sh
node dependency-restart/run.mjs
```

输出如下：

```text
before provider: activations=0, ping has no listener
provider A disposed: consumer cleaned up, ping has no listener
reactivated: activations=2, A:1 -> A:2 -> cleanup:A -> B:1
```

第一行说明依赖未就绪时，consumer 尚未运行。第二行说明 A 消失后，consumer 的旧监听器已撤销。最后一行中，A 收到两次 ping，B 上线后收到一次；新计数从 1 开始。

## 为什么 activations 是 2，B 的计数却是 1

打开 [run.mjs](./run.mjs) 的 `consumer()`，比较两个变量的位置：

- `activations` 在函数外，记录入口总共运行过几次，因此累加到 2。
- `localCount` 在函数内，每次激活时重新创建，因此换成 B 后从 1 开始。

框架重新运行插件入口。入口外的 JavaScript 状态仍可能保留，入口内的旧闭包不会自动恢复。依赖恢复与业务状态恢复是两件事。

可以把 `let localCount = 0` 移到函数外再运行：脚本应在预期 `B:1` 的断言处失败。将两处预期中的 `B:1` 改成 `B:3` 后应通过。这个改动改变了计数的寿命，依赖的等待、撤销和重激活过程仍然存在。练习后恢复改动。

实验使用 Cordis `4.0.5-alpha.1`，不请求模型。脚本等待真实生命周期转换后再检查结果，不用固定 sleep 猜测何时就绪。

## 可选源码与示例来源

[Fiber 的依赖与重激活](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/vendor/cordis/src/fiber.ts#L588)、[Provider 清理](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/vendor/cordis/src/reflect.ts#L297)。依赖声明也参与服务访问校验，删掉 inject 后仍访问服务会产生不同错误。

选题参考 [DeepSeek Harness Cookbook 的依赖启停示例](https://github.com/zhangjessey/deepseek-harness-cookbook/blob/2b9d4d97f947017433bfd11dbc0ea601de7f28ca/src/ch02/hello-inject.ts)。本脚本独立编写，用监听器撤销与闭包计数观察重新激活的结果。
