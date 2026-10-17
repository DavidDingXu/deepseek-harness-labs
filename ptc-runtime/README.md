# PTC：代码在哪里执行，变量能活多久

PTC 把工具编排交给一段代码，但“能写代码”还没有回答两个问题：它在哪个进程里运行，下一次调用还能不能看见上一次的变量。

这个实验直接挂载官方 Node PTC Provider，真实启动子进程。没有调用模型，也没有重写解释器。

## 先观察两种执行方式

完成仓库根目录的依赖安装后，在根目录执行：

```sh
node ptc-runtime/run.mjs
```

脚本依次检查以下变化，每项通过后打印一行 `PASS`：

| 条件 | 观察与断言 |
| --- | --- |
| 默认 per-call，连续两次运行 | PID 都不同于宿主，第二次也不同于第一次；旧变量不存在 |
| persistent-in-memory，同一个 owner | PID 不变，变量从 17 增加到 18 |
| 换一个 owner | 启动另一个进程，看不见前一个 owner 的变量 |
| 先修改变量，再抛异常 | 返回 exception；前面已发生的内存修改仍在 |
| 执行死循环，设置超时 | 返回 timeout；下一次调用看不见旧变量 |
| 等待 release(owner) 完成 | 下一次调用使用新的环境，旧变量不存在 |

两种模式都在子进程里执行。persistent-in-memory 的“内存”说的是保留环境的寿命，不表示把用户程序移进了 Harness 主进程。

普通表达式抛错没有回滚之前的修改；超时则要终止执行环境。不能把这两类失败都解释成“失败后状态不变”。

## 再检查真实只读限制

在具备官方 OS 沙箱后端的环境中，可以显式执行：

```sh
node ptc-runtime/run.mjs --sandbox
```

它保留 `count` 并跨调用递增，然后在只读策略下实际调用 `node:fs/promises.writeFile`。脚本同时断言返回 `sandbox.denied=true`、磁盘没有生成文件，而且原来的变量仍可读取。

这条检查于 macOS 实测通过。普通 `npm test` 运行上面的六项进程与状态检查，不运行这项依赖本机 OS 沙箱的检查。不支持受限运行的环境应报告失败，不能退回不受限执行后仍把它算作通过。

## 这个结果能说明什么

PID 证明这里确实启动并复用了进程；变量和文件结果证明状态寿命及本次写入限制。实验没有接入 `run_code` 的完整模型工具桥，也没有测试所有取消、提权或沙箱绕过路径。

对应实现和官方用例：

- [Node PTC Provider](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/ptc-runtime/ptc-runtime-node/src/index.ts)
- [状态、超时与释放用例](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/ptc-runtime/ptc-runtime-node/tests/persistent.spec.ts)
- [持久环境与沙箱用例](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/ptc-runtime/ptc-runtime-node/tests/persistent-sandbox.spec.ts)

实验固定使用 DSH `0.2.1-rc.2`、Cordis `4.0.5`。
