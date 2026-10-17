# 在 Web 中使用只读审查、结构化报告与交付检查

前面的离线实验解释了三个扩展各自负责什么。这里把它们装进官方 DSH Web，实际选择模式、发出工具调用，再从界面轨迹与项目文件核对结果。

本实验固定安装 `@deepseek-ai/dsh@0.2.1-rc.2`，模型使用 gpt-6-luna，经官方 llm-pi-ai 的 Responses 路由请求服务。会产生模型用量；npm test 不会启动 Web。

## 先准备独立的产品目录

需要 Node.js 24、npm、Git，以及支持上述模型和 Responses 协议的服务。已经克隆本仓库后，以下脚本都从仓库根目录运行。

先按[接入配置](../real-model/README.md#接入配置)提供 OPENAI_API_KEY 和 OPENAI_BASE_URL。该小节只设置环境变量；本页使用自己的 Web 入口，模型固定为 gpt-6-luna。

然后按系统执行下面一组命令。第一行创建临时目录，第二行打印路径，请记下这个路径；官方产品和演示文件都放在里面。

macOS / zsh：

```sh
acceptance_root="$(node -e 'const fs=require("node:fs"),os=require("node:os"),p=require("node:path");console.log(fs.mkdtempSync(p.join(os.tmpdir(),"dsh-web-")))')"
echo "$acceptance_root"
npm install --prefix "$acceptance_root" --ignore-scripts --save-exact @deepseek-ai/dsh@0.2.1-rc.2
node web/prepare.mjs "$acceptance_root"
node web/start.mjs "$acceptance_root" 3187
```

Windows PowerShell 7：

```powershell
$acceptanceRoot = node -e 'const fs=require("node:fs"),os=require("node:os"),p=require("node:path");console.log(fs.mkdtempSync(p.join(os.tmpdir(),"dsh-web-")))'
$acceptanceRoot
npm install --prefix $acceptanceRoot --ignore-scripts --save-exact @deepseek-ai/dsh@0.2.1-rc.2
node web/prepare.mjs $acceptanceRoot
node web/start.mjs $acceptanceRoot 3187
```

prepare 复制扩展、生成 patch 和故意把加法写错的样例；start 启动 Web，并持续占用这个终端。生成的主要内容是：

```text
临时目录/
  node_modules/       官方 DSH 安装
  home/               独立 DSH_HOME，含三个扩展
  workspace/          演示项目：sum.mjs、测试与 evidence.txt
  web.patch.yml       模型配置与扩展接入
```

准备器拒绝覆盖已经存在的 home 或 workspace。已成功准备过的目录，重启时只需运行 start；若准备中途失败，则另建新临时目录重新准备。模型凭据只引用环境变量名，不写入 patch。32768/4096 是实验设置的上下文与输出限制，不代表模型容量。

## 打开界面后，先选对工作区

打开启动终端打印的完整本地地址，保留其中的授权参数。完成欢迎页后：

1. 点击“添加工作区”，在目录选择器中选中刚生成的 workspace。
2. 新建会话，检查模型按钮显示 gpt-6-luna。
3. 打开模式菜单，应出现“只读审查”“结构化审查”“交付检查”。

Web 有自己的工作区选择。即使终端已经在某个目录启动，页面也仍需选中 workspace。默认 Documents 位置另指向实验目录，避免首次初始化使用个人文档位置。

下面按顺序使用同一个演示项目，每项新建会话并选择对应模式。

## 只读审查：文件标记能否真正读回来

选择“只读审查”，发送：

```text
读取 evidence.txt，只返回文件中的标记。
```

应得到 `HARNESS_WEB_EVIDENCE_72941`。打开“轨迹”核对实际 read 调用、参数与返回内容；请求工具表应只开放 read，文件内容保持不变。

这个模式依靠过滤插件限制继承工具。模式名和“不要改文件”的提示词都不能替代过滤操作，机制见[只读组合实验](../review-preset/README.md)。

## 结构化审查：看见写工具，也可以被执行前拒绝

新建会话，选择“结构化审查”。这次故意尝试一个应被拒绝的动作：

```text
在这个临时演示项目中，先调用 write，尝试把 guard-probe.txt 写成 probe，预期由 Guard 拒绝。不要重试或绕过。再读取 sum.mjs，检查加法实现，最后调用 review_report 提交审查结论。summary 和 problem 用中文。请实际调用工具。
```

轨迹里应出现 write 的 Guard 拒绝，磁盘上没有 guard-probe.txt；随后 read 读取 sum.mjs，review_report 返回 needs_changes，问题指向第 2 行的减法。报告沿用产品已有的对话与轨迹显示。

如果模型没有发出 write，仅口头表示不会写入，这次就没有经过要观察的拒绝路径。可先运行 `node review-plugin/run.mjs`，在固定调用顺序下检查 Guard，再回来看真实模型的行为。

## 交付检查：先失败，修复后再交付

新建会话，选择“交付检查”。下面示例中的 Shell 工具为 bash；Windows 使用 pwsh，将提示中的 bash 换成 pwsh。

```text
依次执行并等待每次结果：先调用 finish_delivery，查看缺少证据的拒绝；用 bash 执行 node --test，查看失败；修复 sum.mjs 的加法；再用 bash 执行 node --test 和 git diff --check；两项通过后调用 finish_delivery。请实际运行工具，写文件时提供非空 justification。
```

核对三处：第一次交付因 missing 被拒绝；第一次测试退出码为 1；修复后的两项检查退出码为 0，最后交付获准。测试通过以命令结果为准。

### 通过后再改一次，旧检查还算数吗

先完成上面的修复，再开新的“交付检查”会话，发送下面提示；Windows 同样将 bash 换成 pwsh：

```text
这次要观察修改后旧证据过期。严格依次调用：
1. bash 执行 node --test；
2. bash 执行 git diff --check；
3. finish_delivery，预期通过；
4. 读取 sum.mjs，用 write 只在末尾追加 // stale acceptance；
5. 立即调用 finish_delivery，预期 stale 拒绝。
写文件时提供非空 justification。最后一次写入后不重跑检查，也不修复预期拒绝。
```

最后一次调用应返回 tests=stale、diff-check=stale。若模型在写入后自行重跑了检查，再交付成功，证据已经更新，这次就没有停在预定条件；不能据此判断 Guard 失效。需要稳定复现过期拒绝时，运行 `node delivery-gate/run.mjs`。

## 停止后刷新，未写完的内容还在吗

另开会话，让模型生成较长回答，在仍输出时点击“停止生成”。刷新页面，再退出并重启服务，打开原历史会话，核对已停止的内容仍存在，并带着中断状态。

实现上，已显示前缀进入 interrupted=true 的 assistant/message，Step 关闭，Turn 以用户取消的 aborted 原因结束。如果回答已经完成，就没有取消到正在执行的尝试。正常停止、刷新、重启也不同于强杀进程，后者需要另行验证。

## 用完后怎样退出

在启动终端按 Ctrl+C。macOS / zsh 再执行 `unset OPENAI_API_KEY`，PowerShell 执行 `Remove-Item Env:OPENAI_API_KEY`。临时目录会保留本次样例和结果；不再需要时，按先前打印的路径删除。

如果端口被占用，可把 start 命令最后的 3187 换成另一个空闲端口，并打开新打印的地址。要重新启动，仍使用同一临时目录，先重新提供模型凭据，再运行 start；无需再次执行 prepare。

## 需要理解接入代码时再看这里

[prepare.mjs](./prepare.mjs) 复制三个扩展，生成显式 Include 条目，并将默认 Profile 与工作区初始化位置隔离在临时目录。它成对挂载官方 browse Host、Client 目录选择器，并禁用原 directory-picker；只改条目 name 不会替换原模块。

[web-readonly.mjs](../review-preset/web-readonly.mjs) 同时处理创建 Agent 和空白会话选择 Preset：过滤随模式切换添加或撤销。[交付插件](../delivery-gate/delivery-gate.mjs)首次使用时确认 Agent 仍是 Registry 的活跃实例，再初始化 missing 状态。两者都要处理“Agent 已创建，随后才选择模式”的顺序。

已有集成记录来自 macOS、Node.js 24.14.1、Chrome 154、gpt-6-luna。离线三平台 CI 不代表完整 Web 已在三平台验收；本页也不覆盖全部设置、附件、操作系统沙箱绕过或 SDK 入口。核心机制可先用各目录的离线脚本逐项核对。
