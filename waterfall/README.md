# next() 怎样决定下游是否执行

一个请求依次经过 outer、inner 和默认处理函数。outer 想在下游执行前后做事，inner 也一样；Waterfall 让它们通过 `next()` 交出控制权，再逐层接回返回值。对应第 07 讲。

完成[依赖安装](../README.md)后，在仓库根目录执行：

```sh
node waterfall/run.mjs
```

程序输出：

```text
completed=outer(inner(done))
blocked=denied
return next(): body:start -> finally -> body:end
return await next(): body:start -> body:end -> finally
repeated next: inner=1; default=2; result=[1,2]
```

## 第一条链怎样得到嵌套的返回值

默认函数返回 done，inner 包裹一次，outer 再包裹一次。脚本中的 `trace` 数组检查了完整顺序：

```text
outer:before:R1
  inner:before:R1
    default:R1
  inner:after:done
outer:after:inner(done)
```

进入顺序是 outer → inner → default，返回顺序则相反。这条同步链的 `trace` 由断言检查，终端前两行打印 completed 和 blocked；后面三行对应异步等待与重复委托。

## 第二条链为什么没有默认结果

第二次调用前，脚本卸载前面的两个插件，注册一个直接返回 denied 的监听器。它没有调用 `next()`，默认函数也就没有执行。`trace` 中只应有 `blocked:R2`，没有 `default:R2`。

打开 [run.mjs](./run.mjs) 对照这两次调用。可以给最后那个直接返回 denied 的监听器加上 next 参数，并把 `return 'denied'` 改为 `return next()`：原本预期 denied 的断言应失败，实际结果变成默认函数返回的 `should-not-run`。练习后恢复改动。

## 调用了 next，finally 为什么仍然可能提前运行

后两组分别在 `try` 中写 `return next()` 和 `return await next()`。默认函数先记录 `body:start`，停在受控 Promise 上。闸门未放行时，第一组已经记录 finally；第二组还没有。放行以后，两组都返回 done，但 finally 的时间不同。

`return next()` 会把下游 Promise 交给调用方，仍能取得最终结果；它没有把当前 finally 延后到下游结束。若 finally 释放了下游仍在使用的资源，就可能出错。需要等下游结束后再收尾时，使用 `return await next()`。

## 同一个 next 再调一次，并不是取上一次结果

最后一组中，outer 连续调用两次 next，inner 只委托一次。真实 Cordis 的调用轨迹是：

```text
outer:before -> inner -> default:1 -> default:2 -> outer:after
```

回调队列取走的 inner 不会重新进入，默认动作却执行了两次，最终得到 `[1,2]`。next 没有重复调用保护，也没有缓存上次结果。计数器在这里代表默认动作的副作用；换成写文件或发送请求，就需要由调用者处理重复执行，不能把 next 当成天然安全的重试接口。

实验使用 Cordis `4.0.5`，不请求模型。同步链检查委托与短路，受控 Promise 检查完成时序，计数和轨迹检查重复副作用；没有用延时猜测调度顺序。
