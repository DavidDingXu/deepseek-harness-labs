# 同一个事件，什么时候继续、等待或停止

监听器返回 `0`，后面的监听器还会不会执行？监听器是 async，触发事件的函数就一定会等待吗？这个实验对应第 06 讲，检查 Cordis 四种分发方法的具体行为。

完成[依赖安装](../README.md)后，在仓库根目录运行：

```sh
node event-modes/run.mjs
```

## serial 和 bail 在什么值上停止

`serial` 依次调用并等待监听器；`bail` 用于同步监听器。本实验用同步返回值比较它们的停止规则。先注册返回测试值的 A，再注册返回 `fallback` 的 B。

| A 返回什么 | 结果 | B 是否执行 |
| --- | --- | --- |
| undefined、null、false | fallback | 执行，继续采用 B 的结果 |
| 0 | 0 | 不执行 |
| 空字符串 | 空字符串 | 不执行 |

对应输出里的 `serial/bail zero: 0` 与 `serial/bail empty: ""`。这里不能用 `if (result)` 判断是否继续，因为 0 和空字符串虽然是假值，仍会让分发停止。脚本既检查返回值，也检查 A、B 实际被调用的顺序。

## emit 返回后，异步监听器可以仍未结束

脚本让监听器先记下 start，然后等待放行。`emit()` 返回时，数组里只有 start；放行后才出现 end。输出为：

```text
emit: caller continues before async listener finishes
```

这说明 emit 适合发送通知；触发方不能把它的返回当作异步工作已经办完。

## parallel 会等到哪些结果

A、B 两个监听器都会失败，但 B 先停在等待点。A 已失败时，`parallel()` 仍未结束；放行 B 后，它返回包含两项错误的 `AggregateError`：

```text
parallel: waits for both listeners; AggregateError has 2 errors
```

打开 [run.mjs](./run.mjs)，分别看返回值循环、`lab/emit` 和 `lab/parallel` 三段。异步等待由 Promise 的显式放行控制，不依赖机器快慢。第五种方式 Waterfall 处理调用链与返回包裹，见[下一个实验](../waterfall/README.md)。

本实验使用 Cordis `4.0.5`，不请求模型，也不创建产品会话。
