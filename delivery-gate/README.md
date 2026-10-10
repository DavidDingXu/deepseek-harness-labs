# 交付证据门禁实验

固定使用官方 npm 包 `0.2.1-alpha.2` 与 Cordis `4.0.5-alpha.1`，源码入口为[对应版本源码](https://github.com/deepseek-ai/deepseek-harness/tree/d743267388641bc76f17c45ce8b4c231aed1d32c)。

在仓库根目录运行，需 Node `^22.19.0 || >=24.0.0` 与 Git：

```sh
npm ci
node delivery-gate/run.mjs
node --test delivery-gate/delivery-gate.test.mjs
```

运行器创建临时 Git 仓库，真实启动 Node 测试与 Git 检查。它通过官方 `ctx.tools.execute()` 调用插件与测试工具，使用真实 Agent 所有权；不会连接模型、修改默认 profile 或提交 Git commit。无论断言成功与否，临时仓库都会在 finally 删除。

macOS、Node v24.14.1 的实际输出：

```text
PASS delivery: missing -> failed -> stale -> passed -> stale; finish denied/allowed/denied
  real child processes: failing Node test, passing Node test, git diff --check; independent Agent and missing owner denied
  registered plugin disposed; official ToolRuntime 0.2.1-alpha.2
Temporary repository removed.
```

独立状态测试还通过了 4 项检查：缺项拒绝、失败与过期区分、未知 Shell 命令令证据过期、命令内部空白不归一化。

## 插件承诺了什么

每个新 Agent 有一个 generation 与 evidence Map。`tools/result` 中观察到 `write`、`edit`、`str_replace_editor` 或未匹配检查的 Shell 调用后，generation 增加。失败的变更调用也保守地让旧证据过期。

只有精确匹配配置的命令、工具名，以及 `isError=false`、`kind=foreground`、`exitCode=0`、`timedOut=false`、`aborted=false` 的结果才记为通过。命令仅 trim 首尾，不压缩内部空白，避免改变引号内字符串的语义。

`finish_delivery` 的 guard 必须看到所有检查在当前 generation 通过。guard 只返回拒绝原因或 undefined，不强行 allow，因此不会覆盖其他 guard 的拒绝。状态属于 Agent；另一个 Agent 或没有 Agent 的调用不能借用这些证据。插件可在 Agent 创建后挂载：第一次使用时核对 Registry 中的活跃实例，初始化缺失证据。重新挂载不会恢复旧内存证据，必须重新运行检查。

工具声明使用 `defineTool` DSL，规范数据再由 output.render 变成模型文本。`delivery_status` 只查询当前状态；`finish_delivery` 不执行测试，它验收之前的工具结果。

## 这次运行的范围

`run.mjs` 中名为 `bash` 的工具是明确的 fixture：只接受两条固定命令，用 Node spawnSync 启动真实程序，不解析 Shell 语法。`write` 也只改临时仓库中的 sum.mjs。它们没有声明并发安全，测试按顺序 await；这证明实际工具管线、guard、结果观察与状态迁移接通，不证明官方 Bash/PowerShell、沙箱或 Web 集成已经验证。

generation 是本 Agent 的已观察结果计数，不是文件快照、内容哈希或工作区事务。外部改文件、其他 Agent 修改同一目录、自定义写工具、未被观察的 PTC 副作用都可能漏掉；并发调用中检查和写操作交错也没有建立可靠快照。不要把它当作并发 CI 或操作系统边界。它只能拒绝协议工具 `finish_delivery`，无法禁止模型用普通文字宣称完成。

## 可选的完整产品装配

`preset.yml` 使用 `@deepseek-ai/dsh-agent-preset` 声明与 persona.prefix。以下命令只把声明和插件复制到指定目录，不更改默认 profile，也不触发自动发现：

```sh
node delivery-gate/install.mjs /absolute/path/to/isolated-home
```

输出的 `column-plugins/delivery-gate/preset.yml` 需要由完整发行版组合显式包含；Shell、工作目录、文件能力等依赖由宿主满足。[Web 实验](../web/README.md)提供已验证的完整产品接入。`prepare-fixture.mjs` 仍可用于手工演示，它输出一份保留的临时仓库，使用完需自行删除；一键 run.mjs 则自动清理。
