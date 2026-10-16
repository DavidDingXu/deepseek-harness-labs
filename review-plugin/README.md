# 审查报告怎样交给程序，写操作怎样被拒绝

模型给出“需要修改”的结论后，后续程序还需要严重程度、文件和行号。这个插件增加 `review_report` 工具来接收固定字段，同时用 Guard 在执行前拒绝 write/edit。对应第 23 讲。

完成[依赖安装](../README.md)后，在仓库根目录运行：

```sh
node review-plugin/run.mjs
```

这个入口不请求模型。脚本创建两个真实 Agent，直接向官方工具运行时提交报告和写入调用，观察字段校验、执行限制及作用域隔离。

## 报告有数据值，也有给模型看的文本

实验提交的报告如下。它是测试输入，并未声称模型实际发现了这个问题：

```json
{
  "verdict": "needs_changes",
  "summary": "Missing validation",
  "findings": [
    {
      "severity": "high",
      "file": "sum.mjs",
      "line": 1,
      "problem": "Input is not checked"
    }
  ]
}
```

工具运行时校验字段，程序从结果的 value 读取这份对象；`output.render()` 再生成给模型看的简短文本。脚本分别检查两种结果，并提交非法 verdict，确认错误值被拒绝。字段合法仍不代表问题判断正确。

## Guard 拦住的是哪个阶段

write/edit 仍在这个 Agent 的可见工具表中。调用进入运行时后，Guard 在主体函数执行前拒绝它们。因此脚本同时检查：工具可见、调用被拒绝、主体执行次数为 0。

写工具在这个离线实验里只增加计数，不写真实文件。另一个 Agent 的 write 可以执行；卸载插件后，审查 Agent 的 write 也恢复可执行，报告工具则被撤销。对应的关键输出是：

```text
PASS review: schema validated; local write/edit denied before body; other Agent allowed; disposal restores write
```

即使 `tools/pre-execute` 监听器返回 allow，也不能越过 Guard 的拒绝。与上一讲的 restrict 相比，Guard 还能限制同一个作用域（Scope）中注册的工具；restrict 负责过滤继承工具的可见性。

当前 Guard 只匹配 write、edit 两个名字。Shell、直接文件操作和其他自定义写工具不在其范围内；需要文件系统隔离时，仍须合适的执行环境与政策。

## 先读哪段代码，改什么可以看到差异

先打开 [review-plugin.mjs](./review-plugin.mjs) 的 `apply()`：`register` 添加报告工具，`guard` 添加执行限制。再看 [run.mjs](./run.mjs) 中的工具调用和 writes 计数。[runtime-fixture.mjs](./runtime-fixture.mjs) 负责公共服务装配，需要时再读。

暂时把 Guard 匹配列表中的 write 去掉，重新运行。写入拒绝的断言应失败，因为这个名称仍然可见，计数工具会执行。恢复后重新运行通过。

如果准备修改报告字段，要区分两种声明：这里的 `defineTool` 使用属性 DSL，将 required 写在属性上；底层 `ctx.tools.register()` 接受 JSON Schema。复制字段定义时需遵循所在层的形式。提示词中的“只调用一次”也只是使用约定，插件没有给报告调用次数加锁。

## 在 Web 中使用

跟随 [Web 实验](../web/README.md)可将它装进完整产品；本目录离线场景只检查工具管线，不启动模型 Turn、Web 或持久化。

也可以手工复制。将示例路径替换为自己的独立目录，参数是目标目录，不含 YAML 文件名：

```sh
node review-plugin/install.mjs /absolute/path/to/isolated-home
```

文件会复制到该目录下的 column-plugins/review-plugin，安装器拒绝覆盖不同内容。宿主须显式加载输出的 preset.yml，并提供文件工具需要的服务。是否出现 read_image 还取决于附件存储是否存在。

实验固定使用 DSH `0.2.1-alpha.2`、Cordis `4.0.5-alpha.1`，源码入口为[对应版本源码](https://github.com/deepseek-ai/deepseek-harness/tree/d743267388641bc76f17c45ce8b4c231aed1d32c)。
