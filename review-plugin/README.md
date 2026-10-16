# 结构化审查与执行拒绝实验

固定使用官方 npm 包 `0.2.1-alpha.2` 与 Cordis `4.0.5-alpha.1`。源码入口为[对应版本源码](https://github.com/deepseek-ai/deepseek-harness/tree/d743267388641bc76f17c45ce8b4c231aed1d32c)。

在仓库根目录运行：

```sh
npm ci --ignore-scripts
node review-plugin/run.mjs
```

不需要模型凭据。运行器组装官方 LLM、Session、Projection、SystemPrompt、Tools、Agent 与 AgentLoop，创建两个真实 Agent，直接调用官方 `ctx.tools.execute()`；不发模型请求，也不启动 Turn。`runtime-fixture.mjs` 只负责装配与调用，不实现替代 Harness。

实际输出（macOS，Node v24.14.1）：

```text
PASS review: schema validated; local write/edit denied before body; other Agent allowed; disposal restores write
Official runtime 0.2.1-alpha.2; no model, Web, filesystem or persistence experiment.
```

实验用计数工具模拟 `write`/`edit` body，确认同一个 Agent scope 内的写工具仍在 schema 中，但 guard 在 body 前拒绝调用；另一个 Agent 不受影响。它还检查 `review_report` 的规范返回值、渲染文本、非法 verdict 拒绝，以及插件卸载后报告工具撤销、写工具恢复。所有 Context 最后释放。

`review-plugin.mjs` 使用 `defineTool` 的属性 DSL 定义必填值，编译后交给真实 ToolRuntime。`ctx.tools.register()` 本身仍接受底层 JSON Schema，不能把两层声明形式混为一谈。报告的 schema 约束数据形状，不证明审查结论正确；“只调用一次”仍是提示约定，并没有计数门禁。

执行政策使用 scoped `tools.guard()`：它能拒绝同 scope 的工具，也不能被 `tools/pre-execute` 的 allow 覆盖。它不会隐藏模型看到的工具。`tools.restrict()` 仍可限制继承工具，但不能屏蔽同 scope 的工具注册；具体选择取决于挂载层级。

当前 guard 仅匹配 `write`、`edit`。它不拦截 Shell、PTC 直接文件操作、外部进程或其他自定义写工具，不能充当文件系统只读沙箱。

## 顺着一次调用看代码

先看 [review-plugin.mjs](./review-plugin.mjs) 的 `apply()`：`register` 添加报告工具，`guard` 限制执行。再看 [run.mjs](./run.mjs) 如何派发调用并统计 body 次数。`runtime-fixture.mjs` 是装配代码，可以等看懂实验后再读。

一个有用的改动是暂时把 Guard 匹配列表中的 `write` 去掉。重新运行时，拒绝写入的断言应失败，因为同 Scope 的 write 仍然存在，并且会执行。恢复后再运行通过。这个对照能看清：让模型看见工具和允许它执行，是两个独立决定。

## 可选的声明文件

`preset.yml` 使用 `@deepseek-ai/dsh-agent-preset` 声明，persona 使用 `prefix`。声明必须被宿主显式 Include 才会加载。

如需把文件复制到一个明确指定的独立目录：

```sh
node review-plugin/install.mjs /absolute/path/to/isolated-home
```

安装器仅复制到该目录的 `column-plugins/review-plugin`，拒绝覆盖不同内容，不修改默认 profile。随后需在完整发行版组合中显式包含打印出的 `preset.yml`，并满足文件工具的能力依赖；完整接入见 [Web 实验](../web/README.md)。`read_image` 是否注册还取决于 attachments 服务，不能给出无条件固定工具列表。
