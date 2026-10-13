# 文件工具不改，只换文件能力的实现

同一条 `write` 请求，在本地文件实现下成功，换成只读文件实现后被拒绝，再换回本地实现又成功。实验使用官方 `dsh-tool-fs` 工具，调用者没有为两个 Provider 分别写一套工具。

在仓库根目录执行：

```sh
npm ci --ignore-scripts
node capability-swap/run.mjs
```

依赖沿用 `preset-runtime` workspace，固定 DSH `0.2.1-alpha.2`、Cordis `4.0.5-alpha.1`，运行前逐项核对版本。Node.js 要求 `^22.19.0 || >=24.0.0`。

## 看哪三个角色

| 角色 | 本实验中的真实实现 |
| --- | --- |
| Definition：文件操作的共同约定 | `dsh-fs` 的 `FileSystem`，以 `ctx.fs` 提供服务 |
| Consumer：处理模型参数与结果 | `dsh-tool-fs` 的官方 `write` 工具 |
| Provider：完成文件操作 | 先用 `dsh-fs-local`，再用 `dsh-fs-sandbox`，最后换回本地实现 |

三次装配都在同一个 Host 中完成，文件工具只挂载一次。两个 Provider 都注册同名服务，所以必须先卸载旧实现，再挂新实现。工具依赖 `fs`：服务撤销时，Cordis 撤销它注册的工具；新实现就绪后，Cordis 重新激活同一个消费者插件。

每次调用保持工具名和参数不变，仅为新的调用生成不同的追踪编号：

```json
{
  "name": "write",
  "arguments": {
    "file_path": "report.txt",
    "content": "review complete\n"
  }
}
```

## 政策不变，为什么结果会变

Host 从开始就挂载 `sandboxPolicy`，配置始终是 `read-only`。本地 Provider 不执行这项写入约束，因此第一次写入成功。受限 Provider 会读取本次调用的政策并拒绝写入。政策表达要求，Provider 负责兑现；仅安装政策服务，不会自动限制所有文件操作。

| 阶段 | 工具层观察 | 磁盘断言 |
| --- | --- | --- |
| 本地 Provider | write 成功 | 文件内容等于请求内容 |
| 卸载本地 Provider | write 从注册表消失，直接调用返回 `UNKNOWN_TOOL` | 已有内容不变 |
| 挂载只读 Provider | 同一 write 返回 `FS_SANDBOX_DENIED` | 新文件未创建，已有文件未覆盖 |
| 换回本地 Provider | 同一 write 再次成功 | 已有文件更新成请求内容 |

拒绝阶段做两次检查。脚本先删除上一阶段的测试文件，验证同一请求不能创建文件；再由测试代码放入一份不同的既有内容，验证同一请求不能覆盖它。这样即便错误处理出现“返回拒绝、实际上已经写入”的问题，磁盘断言也会失败。

消费者的实现与基础写入参数保持不变，但重新激活时可以根据 Provider 的能力调整描述：例如受限实现下，官方工具会额外公布提权参数。本实验不传这些参数，不发起审批。

2026-10-13，在 macOS / Node.js v24.14.1 上执行通过：

```text
PASS local: official write creates report.txt; fs-local does not enforce the read-only policy
PASS dependency: removing fs-local revokes write; a direct call returns UNKNOWN_TOOL
PASS replacement: the same write returns FS_SANDBOX_DENIED; creation and overwrite leave disk unchanged
PASS restoration: fs-local reactivates the same consumer; the same write succeeds again
PASS cleanup: official runtime disposed; temporary files removed; no model or OS sandbox used
```

脚本使用 Node.js 的临时目录与路径 API，没有平台专用命令；上述记录仅代表本轮 macOS 实测，Windows 与 Linux 结果需由对应平台运行确认。

## 这次替换说明了什么

可替换性既包括方法约定，也包括服务的寿命与错误传播。消费者不必识别具体实现名称，却仍然需要把实现返回的拒绝交给调用方。依赖暂时不存在时，工具撤销；依赖回来后，工具重新可用。

这里调用真实 ToolRegistry 和真实文件工具，但不启动 Agent Loop 或请求模型。`fs-sandbox` 在文件能力入口执行可信代码中的政策检查，没有创建进程或操作系统沙箱；它也不能约束绕过该服务的任意 Node 文件操作。实验验证的是两种本地文件 Provider 的替换，不是远程工作区迁移。

所有文件写入独立临时目录，`DSH_HOME` 也只在本次进程中指向该目录。结束时卸载 Host、恢复环境变量并删除临时文件，不修改默认 Profile。

对应源码（可选，链接指向实验使用的固定版本）：

- [文件能力约定](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/fs/src/index.ts)：消费者共同依赖的 `FileSystem` 服务。
- [受限文件 Provider](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/fs-sandbox/src/index.ts)：替代本地实现注册 `ctx.fs`，在变更前执行政策检查。
- [官方文件工具依赖](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/tool-fs/src/index.ts)：消费者声明 `fs` 等服务依赖。
- [write 的执行路径](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/tool-fs/src/write.ts)：解析目标后调用当前 Provider。
- [工具层的政策解析与错误映射](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/tool-fs/src/sandbox.ts)：保留 `FS_SANDBOX_DENIED`，同时提供面向模型的拒绝说明。
