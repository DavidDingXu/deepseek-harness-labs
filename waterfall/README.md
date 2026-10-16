# Waterfall 实验

同一个事件先跑一条完整链，再注册一个不调用 `next()` 的监听器。前者显示监听器怎样包裹下游，后者证明短路会连默认行为一起截断。

在仓库根目录执行：

```sh
npm ci --ignore-scripts
node waterfall/run.mjs
```

先看 trace 的进入与退出顺序，再看返回值。Waterfall 的合同不是“监听器依次执行”，而是每个监听器决定是否把控制权交给下一层。
