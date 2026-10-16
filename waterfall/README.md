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

进入顺序是 outer → inner → default，返回顺序则相反。`trace` 由断言检查，终端只打印最终的 completed 和 blocked 两行。

## 第二条链为什么没有默认结果

第二次调用前，脚本卸载前面的两个插件，注册一个直接返回 denied 的监听器。它没有调用 `next()`，默认函数也就没有执行。`trace` 中只应有 `blocked:R2`，没有 `default:R2`。

打开 [run.mjs](./run.mjs) 对照这两次调用。可以给最后那个直接返回 denied 的监听器加上 next 参数，并把 `return 'denied'` 改为 `return next()`：原本预期 denied 的断言应失败，实际结果变成默认函数返回的 `should-not-run`。练习后恢复改动。

实验使用 Cordis `4.0.5-alpha.1`，不请求模型，观察的是这两条同步调用链。
