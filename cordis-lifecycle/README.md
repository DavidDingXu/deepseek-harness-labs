# 插件退出时，资源按什么顺序清理

插件先申请资源 A，再申请资源 B。正常退出时该先释放哪一个？如果 B 刚建立好，插件安装就抛错，A、B 又由谁收尾？

Cordis 用 Effect 记录一次资源操作及其清理函数。这个实验用数组记录清理过程，观察正常卸载、失败回滚，以及异步清理的等待顺序。对应第 03 讲。

在仓库根目录执行；首次运行先完成[依赖安装](../README.md)：

```sh
node cordis-lifecycle/run.mjs
```

## 先看正常退出和安装失败

第一行输出串起两次独立安装，关键顺序是：

```text
正常退出：install:A → install:B → dispose:B → dispose:A
安装失败：fail:A → fail:B → rollback:B → rollback:A
```

B 后登记，先撤销。安装失败后也会撤销已建立的资源，使用的仍是 Effect 登记的清理函数。`dispose`、`rollback` 是脚本给日志起的名字，便于区分场景。

## 异步清理中，“先开始”不等于“先完成”

后面两行实际输出为：

```text
separate effects: B:start -> A:start -> A:end -> B:end
one effect: B:start -> B:end -> A:start -> A:end
```

第一组把 A、B 登记为两个独立 Effect。框架先发起 B 的清理，B 还在等待时，A 已经开始并结束，因此不能据“逆序”推导出“B 完成后才轮到 A”。

第二组把两个清理函数放进同一个生成器 Effect。代码中的 function* 创建生成器，每个 yield 交出一个清理函数；框架先等 B 完成，再清理 A。若 A 的清理必须等待 B，这种组织方式才表达了所需的依赖顺序。

打开 [run.mjs](./run.mjs)，按 `active`、`failed`、`concurrentFiber`、`groupedFiber` 四段阅读。`releaseB()` 和 `releaseInner()` 是脚本控制的放行点，用来检查等待中的状态；实验不靠固定延时制造顺序。

本实验使用 Cordis `4.0.5-alpha.1`，不请求模型，也不操作真实连接或外部业务数据。它说明资源清理的调用和等待规则；业务写入是否可撤销，还取决于资源自身的实现。
