# 一份审查组合，怎样让 Agent 只看见 read

审查代码时，需要读文件，但不希望 Agent 使用写入工具。这个实验对应第 22 讲：先把提示词和文件工具组合起来，再给审查 Agent 施加工具过滤，比较过滤前后的实际行为。

Preset 是一份可复用的插件组合；Host 是提供共享服务的运行环境。把 Preset 登记到注册表，还要将它绑定到具体 Agent，Agent 才会继承其中的提示词和工具。

完成[依赖安装](../README.md)后，在仓库根目录运行：

```sh
node review-preset/verify.mjs
```

实验不请求模型。它创建真实 Agent，通过官方工具运行时读取临时文件，并主动尝试一次写入。

## 从声明到 Agent，哪一步负责只读

[preset.yml](./preset.yml) 声明名为 `review-config` 的组合，包含审查提示词和官方文件工具。名称“只读审查”便于在界面识别；实际工具过滤由下列 API 完成：

```js
await ctx.agentPresets.mount(agentCtx, 'review-config')
agentCtx.tools.restrict({ allow: ['read'] })
```

第一行绑定组合，第二行过滤这个 Agent 从上层继承的工具。只复制 YAML，或者只在提示词里写“不要改文件”，都不会执行第二行。

脚本将同一份 Preset 绑定到两个 Agent，只过滤其中一个：

| Agent | 可见工具 | 主动派发 write 的结果 |
| --- | --- | --- |
| 未过滤的基准 Agent | edit、read、write | 本实验不使用它写文件 |
| 审查 Agent | read | 工具不可见，返回 unknown tool；文件内容不变 |

工具注册留在 Preset 的作用域中。作用域（Scope）在这里决定工具归属和继承关系：Host 的全局工具表仍为空，绑定后的 Agent 才能沿继承关系看见相应工具。提示词里的工具说明也使用这份可见集合。

## 再看一个容易遗漏的例外

实验最后在审查 Agent 自己的 Scope 内注册一个名为 write 的工具，只检查可见性，不执行写入。此时它又能看见 read、write；撤销这次注册后，工具表回到只有 read。

`restrict()` 过滤的是继承层，本层注册不受这次过滤影响。因此，它适合控制 Agent 继承哪些工具，不能约束有权在同进程中注册工具的插件。若要拒绝同一 Scope 中已注册的工具调用，继续看[结构化审查与 Guard 实验](../review-plugin/README.md)。

本实验没有安装附件存储，所以 read_image 不会注册。文件服务的 cwd 只用于解析相对路径；它与工具过滤都不构成操作系统文件隔离。

## 输出怎样对应这些判断

```text
PASS preset: Loader -> declaration -> Registry -> Agent; persona and read tool assembled
PASS restriction: baseline=edit,read,write; review=read; write dispatch rejected; file unchanged
PASS boundary: own-scope registration survives restriction; lifting it restores read-only surface
```

第一行检查声明确实被加载并绑定；第二行检查工具表、实际读取、写入拒绝与磁盘内容；第三行检查本层注册的例外。脚本还检查拼错工具名、在无 Scope 的全局上下文中设置过滤等错误。

打开 [verify.mjs](./verify.mjs)，按加载 preset.yml、创建两个 Agent、read/write 调用、本层 write 注册这四段阅读。装配细节集中在 [harness.mjs](../preset-runtime/harness.mjs)。依赖固定为 DSH `0.2.1-rc.2`，临时目录和 DSH_HOME 在退出时清理、恢复。

## 放进完整 Web 时还缺什么

推荐直接跟随 [Web 实验](../web/README.md)。准备器会复制声明，并挂载 [web-readonly.mjs](./web-readonly.mjs)：在创建 Agent 和空白会话切换 Preset 时同步过滤，切走或卸载时撤销过滤。只在创建事件处理一次，会漏掉随后选择模式的情况。

若手工复制声明，先将示例路径替换为自己的独立目录。参数包含目标 YAML 文件名：

```sh
node review-preset/install.mjs /path/to/isolated-home/review-preset.yml
```

安装器拒绝覆盖内容不同的文件。宿主仍需显式加载该 YAML，提供 agentPresets、tools、systemPrompt、fs、workingDirectory 等服务，并在 Agent 设置中绑定组合、施加过滤；复制本身不修改默认 Profile。

## 可选源码对照

- [声明插件的 schema 和 register 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/preset/agent-preset/src/index.ts#L17)。
- [Preset 的真实 EntryTree 装配与激活审计](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/preset/agent-preset-registry/src/mount.ts#L198)。
- [Agent 绑定 Registry 所持组合](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/preset/agent-preset-registry/src/index.ts#L282)。
- [restriction 校验与继承层／本层可见性算法](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/tools/src/index.ts#L1095)。
- [文件工具的 attachment 条件](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/fs/tool-fs/src/index.ts#L62)。
