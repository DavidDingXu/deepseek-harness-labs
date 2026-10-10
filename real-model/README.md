# 真实模型：从网关请求到工具结果回传

这个实验把第 20 讲的脚本响应换成官方 `@deepseek-ai/dsh-llm-pi-ai`，仍由真实 AgentLoop、Tool Runtime、Session 和 Preset Registry 执行。默认离线测试不运行本目录；本实验会调用你指定的模型服务并产生用量。

## 接入配置

在仓库根目录安装统一依赖：`npm ci --ignore-scripts`。向启动进程提供以下环境变量，凭据值不要写进源码、YAML 或运行记录：

| 变量 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | 当前进程使用的模型凭据 |
| `OPENAI_BASE_URL` | 自己授权使用的 HTTPS 网关地址，包含所需 `/v1` 路径 |
| `DSH_LIVE_MODEL` | 明确指定模型；本次实测为 `gpt-6-luna` |
| `DSH_LIVE_API` | 默认 `openai-responses`；也接受 `openai-completions`，但必须由服务端实际支持 |

macOS 的 zsh 可以隐式读取输入，避免把凭据值放进命令历史：

```sh
read -rs 'OPENAI_API_KEY?模型凭据：'
export OPENAI_API_KEY
export OPENAI_BASE_URL='https://你的兼容网关/v1'
export DSH_LIVE_MODEL='gpt-6-luna'
node real-model/run.mjs all
unset OPENAI_API_KEY
```

Windows PowerShell 7：

```powershell
$env:OPENAI_API_KEY = Read-Host '模型凭据' -MaskInput
$env:OPENAI_BASE_URL = 'https://你的兼容网关/v1'
$env:DSH_LIVE_MODEL = 'gpt-6-luna'
try { node real-model/run.mjs all } finally { Remove-Item Env:OPENAI_API_KEY }
```

也可用 `npm run test:live` 运行全部，或 `node real-model/run.mjs tool` / `preset` / `review` / `delivery` 运行一项。已实测 macOS；提供 PowerShell 用法不等于完成 Windows 实测。

## 为什么协议必须明确

`baseURL` 只指定网络地址，`api` 才指定线上消息协议。当前 `dsh-llm-deepseek` 使用 DeepSeek Messages；把兼容网关地址填到它上面，并不会自动变成 OpenAI Responses。这里挂载官方 `llm-pi-ai`，创建独立的 `course-live` 路由，指定协议与模型列表，再把 Agent 的 provider/model 指向它。

本实验将 contextWindow=32768 和 maxTokens=2048 作为保守的运行限制，不将它们当成网关或模型的真实容量声明。配置只保存环境变量名；凭据由官方适配器在请求时解析。工具启动的子进程不继承模型凭据。

## 四项验证

| 场景 | 保留的真实实现 | 检查结果 |
| --- | --- | --- |
| tool | 官方适配器、Loop、工具管线、Session | 模型调用 sum(19,23)，工具返回 42，后续线上请求包含工具输出，最终回答含 42 |
| preset | 官方 Loader → 声明式 Preset → Agent → tool-fs | 模型只看见 read；真实读取临时文件中的标记，文件保持不变 |
| review | 第 23 讲插件、官方工具管线与模型 Turn | 模型发出的 write 被 Guard 拒绝，body 次数为 0；读取有缺陷的 fixture 后提交合法结构化报告 |
| delivery | 第 24 讲插件、官方工具管线与模型 Turn | 模型按提示发起缺证据交付、失败检查、修复、成功检查、交付、再次修改、再次交付；检查拒绝/允许/拒绝 |

review 的 write 只计数；delivery 的 bash 是仅接受 `node --test`、`git diff --check` 的教学执行器，实际启动这两个子进程，write 只写临时 sum.mjs。它们不是完整 Shell 插件或操作系统沙箱。Preset 场景使用的是官方 tool-fs。

## 已实测结果

2026-10-10，DSH `0.2.1-alpha.2`、Cordis `4.0.5-alpha.1`、`gpt-6-luna`、Responses 协议。四个独立 Turn 共 17 次 HTTP 请求；每次响应为 200，失败 attempt 为 0。

```text
PASS tool: HTTP=2, steps=2, tools=sum:ok
PASS preset: HTTP=2, steps=2, tools=read:ok
PASS review: HTTP=4, steps=4, tools=write:denied,read_fixture:ok,review_report:ok
PASS delivery: HTTP=9, steps=9, tools=finish_delivery:denied,bash:ok,write:ok,bash:ok,bash:ok,finish_delivery:ok,write:ok,finish_delivery:denied
```

delivery 中第一条 bash 的工具调用成功交回结果，但进程退出码为 1；后两条退出码为 0。`bash:ok` 不能解释为测试通过。插件同时检查 exitCode、timedOut、aborted，最后一个写入使通过证据失效。

模型响应不是确定性协议脚本；未来可能少调一次工具、重试或改变步骤，脚本会据断言报错。这里刻意给出了操作顺序，验证的是模型与运行时集成，不是自主编程能力基准。review 提示还明确给出预期缺陷，不能据它证明模型独立发现问题。

HTTP 观察器只保留内存中的教学请求体，用来检查真正发出的请求包含工具结果；日志不保存认证头、完整响应或思考内容。每项最多 12 次请求，每次有 90 秒网络超时，180 秒后请求取消 Agent；默认不自动重试。网关的 429、模型不支持或断言失败都不能写成通过。

## 本实验不能证明什么

Session 使用内存事件，没有在这里证明磁盘持久化、崩溃恢复或完整 Web 页面。已确认官方插件装配与真实模型请求可以相接；完整产品入口、浏览器显示、停止按钮与刷新恢复已在[独立 Web 实验](../web/README.md)中另外验收。DeepSeek Harness 是运行时名称，这次所用 GPT 模型不属于 DeepSeek 模型评测。
