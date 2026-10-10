# 真实 Preset 挂载与审查工具边界

本实验使用 `0.2.1-alpha.2` 的官方 Loader、AgentPresetRegistry、AgentRegistry、Tools 与文件工具。它验证一份组合怎样成为 Agent 的继承能力，以及创建时的工具过滤怎样改变实际请求表面与派发结果。不连接模型，不启动 Web。

## 运行

在仓库根目录，使用 Node.js `^22.19.0 || >=24.0.0`：

```sh
npm ci --ignore-scripts
node review-preset/verify.mjs
```

也可以运行两个组合实验：

```sh
npm test --workspace deepseek-harness-preset-lab
```

依赖由统一 workspace 和 lockfile 锁定；脚本首先检查直接依赖精确版本。实际执行 npm 发布包，源码阅读固定在 [对应版本源码](https://github.com/deepseek-ai/deepseek-harness/tree/d743267388641bc76f17c45ce8b4c231aed1d32c)。

## 一份声明，两种 Agent

[preset.yml](./preset.yml) 是普通 Cordis Entry 列表，其中 `@deepseek-ai/dsh-agent-preset` 向 Registry 提交：

```yaml
config:
  id: review-config
  plugins:
    - id: persona
      name: '@deepseek-ai/dsh-persona'
      config:
        prefix: You review code. Inspect evidence and report findings in severity order.
        includeRuntimeContext: false
    - id: tool-fs
      name: '@deepseek-ai/dsh-tool-fs'
```

这里节选了声明的核心字段，完整说明与提示词见文件。新版 Persona 使用 `prefix`，不是旧 `text` 字段。组合贡献提示词和工具；Host 提供共享 Registry、文件 Provider、工作目录和运行服务。

脚本通过 Include 加载文件，让真正的声明插件注册和激活 Preset，再在 Agent 的 setup 中绑定：

```js
await ctx.agentPresets.mount(agentCtx, 'review-config')
agentCtx.tools.restrict({ allow: ['read'] })
```

第二行是创建 Agent 时的 API 操作，不是 YAML 自带的安全保证。测试同时创建未过滤的基准 Agent，两者继承同一个 Preset：基准可见 `edit/read/write`，审查 Agent 只可见 `read`。没有安装 attachment store，因此 `read_image` 不注册；不能把当前工具包固定描述为“四个工具必定同时出现”。

工具还没有进入全局表。`ctx.tools.schemas()` 是空列表，说明贡献留在 Preset Scope；绑定后的 Agent 沿父 Scope 继承这些工具。系统提示词装配也读取同一可见集合，审查 Agent 的工具卡片和文件操作指导不再包含写入工具。

## 真正执行了哪些操作

脚本创建自己的临时目录和 `DSH_HOME`，写入测试证据文件，再通过官方 `read` 工具读取它。随后通过真正的 ToolRuntime 派发一次 `write`：由于目标 Agent 看不见该名称，结果是 unknown tool；脚本断言磁盘内容未变。

最后故意在审查 Agent **自己的 Scope** 注册同名 `write` 定义，只检查可见性，不执行写入。此时 `read/write` 都可见，解除注册又回到 `read`。这是当前实现的明确例外：restriction 过滤继承层，不过滤本层贡献。它不能用于约束同进程中有权注册工具的插件。

名称拼错与无 Scope 的全局过滤也会报错，实验都有断言。LocalFileSystem 的 cwd 只决定相对路径解析；临时目录、Persona 中的“不要改文件”和工具不可见性，都不是操作系统沙箱。这里没有安装或验证系统级文件隔离，也没有验证恶意插件、外部进程或其他可写工具受到限制。

## 实际结果

2026-10-10，macOS / Node.js v24.14.1：

```text
PASS preset: Loader -> declaration -> Registry -> Agent; persona and read tool assembled
PASS restriction: baseline=edit,read,write; review=read; write dispatch rejected; file unchanged
PASS boundary: own-scope registration survives restriction; lifting it restores read-only surface
```

所有 Context 在 finally 中退出，临时文件随后清理，原有 `DSH_HOME` 恢复。命令不依赖 shell 环境变量语法；离线实验已通过 macOS、Ubuntu、Windows 的仓库 CI。

## 把声明带到自己的组合

`install.mjs` 只复制到显式目标 YAML 路径，拒绝覆盖内容不同的文件：

```sh
node review-preset/install.mjs /path/to/isolated-home/review-preset.yml
```

复制文件不修改任何默认 Profile，也不会让 Preset 自动出现在产品中。Host 必须提供 `agentPresets/tools/systemPrompt/fs/workingDirectory`，并显式 Include 该文件；产品的 Agent 创建路径还必须绑定它并执行所需 restriction。本目录的离线实验不验证 Web 下拉框；[完整 Web 实验](../web/README.md)另外提供了已实测接入。它还挂载 web-readonly.mjs，在 Agent 创建及空白会话切换 Preset 时同步过滤，切走或卸载时撤销；不能只复制 YAML 后假定权限已生效。

## 源码依据

- [声明插件的 schema 和 register 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/preset/agent-preset/src/index.ts#L17)。
- [Preset 的真实 EntryTree 装配与激活审计](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/preset/agent-preset-registry/src/mount.ts#L198)。
- [Agent 绑定 Registry 所持组合](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/preset/agent-preset-registry/src/index.ts#L282)。
- [restriction 校验与继承层／本层可见性算法](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/tools/src/index.ts#L1095)。
- [文件工具的 attachment 条件](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/tool-fs/src/index.ts#L62)。
