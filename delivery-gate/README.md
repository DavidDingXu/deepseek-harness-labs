# 测试通过后又改了文件，旧结果还能用于交付吗

测试刚通过，模型随后又改了代码。交付插件要判断的，除了“是否通过过”，还有“通过之后是否再次修改”。第 24 讲用 `finish_delivery` 把这项检查接入工具执行流程。

完成[依赖安装](../README.md)后，在仓库根目录执行。需要本机有 Git：

```sh
node delivery-gate/run.mjs
node --test delivery-gate/delivery-gate.test.mjs
```

第一条命令创建临时 Git 项目，真实执行 Node 测试与差异检查；第二条检查状态判断的细节。它们不请求模型，不修改默认 Profile，临时项目在退出时删除。

## 跟着一次修复看证据怎样变化

样例里的 sum 故意写成减法。脚本先提交交付请求，再运行测试、修复文件、重新检查，最后追加一行注释：

| 进度 | tests 状态 | diff-check 状态 | 此时的交付条件 |
| --- | --- | --- | --- |
| 尚未检查 | missing，缺少结果 | missing | 不满足 |
| 第一次测试失败 | failed，检查失败 | missing | 不满足 |
| 修复 sum | stale，旧结果过期 | missing | 不满足 |
| 测试和差异检查都通过 | passed | passed | 满足 |
| 又写入一行注释 | stale | stale | 再次不满足 |

输出中的主线与表格一致：

```text
PASS delivery: missing -> failed -> stale -> passed -> stale; finish denied/allowed/denied
```

`finish_delivery` 不替你执行测试，只检查之前的工具结果。模型说“测试通过”不会进入证据表；脚本必须观察到对应的命令结果。

## 插件怎样判断“通过之后又改过”

每个 Agent 各有一份状态：`generation` 是已观察变更的计数，`evidence` 保存各项检查结果及其所属计数。观察到写工具或未匹配检查的 Shell 调用结果后，计数增加；计数不同的旧结果就变成 stale。

打开 [delivery-gate.mjs](./delivery-gate.mjs)，先看三个入口：

- `observeToolResult()` 记录检查结果，或增加变更计数。
- `deliveryStatus()` 把记录转换成 missing、failed、passed、stale。
- `apply()` 监听工具结果，并给 finish_delivery 安装 Guard。

随后读 [run.mjs](./run.mjs)，对照表格中的实际调用。移除 `state.generation += 1` 再运行，第一次修复文件后，预期 generation 为 1 的断言就应失败。恢复这行后重新运行。

## 工具返回结果，为什么还要检查退出码

Shell 工具可能成功交回一个“进程退出 1”的结果，因此不能仅凭 `isError=false` 认为测试通过。插件还要求结果是已结束的前台进程、exitCode 为 0、没有超时、没有取消。

检查命令与工具名须匹配配置。默认检查为 node --test、git diff --check，允许通过 bash 或 pwsh 执行。命令只去首尾空白，保留内部空白，避免改变引号内字符串的语义。未识别的 Shell 命令可能改文件，会保守地使旧证据过期；失败的变更调用也如此。

状态属于 Registry 当前持有的同一个 Agent 实例，不能靠相同 id 借用。插件晚于 Agent 创建才挂载时，第一次使用会初始化缺少证据的状态。卸载后重新挂载也不会恢复旧记录，需要重新检查。Guard 只返回拒绝原因或 undefined，不会替其他 Guard 强行放行。

## 计数覆盖到哪里

generation 由本 Agent 的工具结果驱动，不是文件内容版本。它能观察 write、edit、str_replace_editor 及未匹配检查的 bash/pwsh；外部改文件、别的 Agent 写同一目录、其他自定义写工具或直接文件操作，可能不在记录中。

实验按顺序等待每次调用，没有建立检查与修改并发时的工作区快照。它不能替代并发 CI 或操作系统隔离，也只能拒绝 finish_delivery 工具，不能阻止模型用普通文字声称完成。

离线运行器中的 bash 是小型测试执行器，只接受上述两条命令并启动真实子进程，不解释任意 Shell 语法；write 也只改临时 sum.mjs。完整产品中的官方 Shell 与文件工具接入见 [Web 实验](../web/README.md)。

## 可选的手工安装

通常可直接使用 Web 准备器。若需手工复制，将示例路径替换为自己的独立目录；参数是目录，不含文件名：

```sh
node delivery-gate/install.mjs /absolute/path/to/isolated-home
```

输出的 column-plugins/delivery-gate/preset.yml 仍需宿主显式加载，Shell、工作目录和文件能力也由宿主提供。安装器不修改默认 Profile。

[prepare-fixture.mjs](./prepare-fixture.mjs) 可单独生成并保留一个演示用 Git 项目，便于手工操作，用完后自行清理；run.mjs 的临时项目则自动清理。实验使用 DSH `0.2.1-alpha.2`、Cordis `4.0.5-alpha.1`，源码入口为[对应版本源码](https://github.com/deepseek-ai/deepseek-harness/tree/d743267388641bc76f17c45ce8b4c231aed1d32c)。
