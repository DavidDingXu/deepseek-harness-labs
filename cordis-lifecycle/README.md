# Effect 生命周期实验

这个实验只观察一件事：插件安装成功后怎样逆序清理，安装中途失败时是否走同一条回滚链。

在仓库根目录执行：

```sh
npm ci --ignore-scripts
node cordis-lifecycle/run.mjs
```

输出中的 `dispose:B -> dispose:A` 和 `rollback:B -> rollback:A` 说明后注册的 Effect 先撤销。失败回滚与正常卸载共用同一种 disposer，不需要每个插件再维护一套异常清理分支。

另有两个异步对照，由脚本显式控制清理动作何时完成：独立 Effect 逆序启动而并发完成；一个生成器 Effect 收集的多个 disposer 则按逆序串行等待。对照的是“先发起”与“先完成”的区别。固定依赖为 `@deepseek-ai/cordis@4.0.5-alpha.1`。
