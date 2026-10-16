# 同一个 write，换了文件实现为什么结果不同

写入 `report.txt` 的工具调用保持不变：本地文件实现下成功，换成受限文件实现后被拒绝，再换回本地实现又成功。第 11 讲讨论的“能力可替换”，在这里可以直接看到结果。

完成[依赖安装](../README.md)后，在仓库根目录执行：

```sh
node capability-swap/run.mjs
```

这个实验不请求模型，文件只写入脚本创建的临时目录。

## 先分清工具与文件实现

模型调用的是 `write` 工具，真正操作文件的是工具背后的文件服务。实验把两者分开装配：

| 角色 | 做什么 | 本实验中的实现 |
| --- | --- | --- |
| Definition，共同约定 | 规定文件服务能做哪些操作 | dsh-fs 的 FileSystem 服务，通过 ctx.fs 访问 |
| Consumer，能力使用方 | 解析工具参数，再调用文件服务 | 官方 dsh-tool-fs 的 write 工具 |
| Provider，能力提供方 | 实际完成或拒绝文件操作 | 先 fs-local，再 fs-sandbox，最后换回 fs-local |

文件工具只挂载一次。每次更换 Provider，先卸载旧服务，再挂载新服务，避免同名服务冲突。Cordis 根据工具声明的 fs 依赖撤销或重新激活工具。

每次请求的核心参数相同，只更换追踪调用用的编号：

```json
{
  "name": "write",
  "arguments": {
    "file_path": "report.txt",
    "content": "review complete\n"
  }
}
```

## 跟着四个阶段看结果

| 阶段 | 工具结果 | 脚本检查的磁盘状态 |
| --- | --- | --- |
| fs-local 在场 | write 成功 | 内容等于请求内容 |
| 卸载 fs-local，fs 尚未恢复 | UNKNOWN_TOOL | 工具已撤销，原内容不变 |
| fs-sandbox 在场 | FS_SANDBOX_DENIED | 既不能新建，也不能覆盖已有文件 |
| 换回 fs-local | write 再次成功 | 内容更新成请求内容 |

输出依次出现 `PASS local`、`PASS dependency`、`PASS replacement`、`PASS restoration`。打开 [run.mjs](./run.mjs)，沿这四处输出向上找对应的挂载、卸载和断言即可。

拒绝阶段检查了两种情况：先删除文件，确认写调用不能重新创建它；再由实验代码放入另一份内容，确认写调用不能覆盖它。除了错误码，磁盘也要符合拒绝结果。

## 为什么 read-only 政策一开始就在，第一次仍能写入

运行环境从开始就提供 `sandboxPolicy`，值始终是 read-only。fs-local 不执行这项政策检查，所以第一次写入成功；fs-sandbox 在文件操作入口读取并执行政策，所以相同调用被拒绝。

政策表达要求，具体 Provider 负责兑现。要限制某条文件路径，必须检查调用实际经过哪一个实现。仅挂载政策服务不能自动限制任意代码。

工具重新激活时，可以根据当前实现的能力调整说明。例如受限实现下会出现提权参数，但本实验不传这些参数，也不发起审批。

这里的 fs-sandbox 在文件服务入口做检查，没有建立操作系统沙箱；绕开服务的 Node 文件操作仍不受它控制。实验也没有迁移到远程工作区。它使用官方工具注册表和文件工具，验证服务替换、依赖撤销与错误传播。

脚本使用锁定的 DSH `0.2.1-alpha.2`，复用 [Preset 共享环境](../preset-runtime/README.md)。退出时卸载运行环境、恢复原 DSH_HOME 并删除临时文件。三平台运行结果见[自动检查](https://github.com/DavidDingXu/deepseek-harness-labs/actions/workflows/check.yml)。

## 可选源码对照

- [文件能力约定](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/fs/src/index.ts)：消费者共同依赖的 `FileSystem` 服务。
- [受限文件 Provider](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/fs-sandbox/src/index.ts)：替代本地实现注册 `ctx.fs`，在变更前执行政策检查。
- [官方文件工具依赖](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/tool-fs/src/index.ts)：消费者声明 `fs` 等服务依赖。
- [write 的执行路径](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/tool-fs/src/write.ts)：解析目标后调用当前 Provider。
- [工具层的政策解析与错误映射](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/tool-fs/src/sandbox.ts)：保留 `FS_SANDBOX_DENIED`，同时提供面向模型的拒绝说明。
