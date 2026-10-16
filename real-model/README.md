# 换成真实模型以后，工具往返还能接上吗

[离线工具实验](../runtime/README.md)已经固定了输入和预期。这里把预定响应换成真实模型，通过官方 llm-pi-ai 适配器请求服务，再由官方 AgentLoop、工具运行时与会话完成后续流程。

这个入口会使用你配置的模型额度。建议先运行 tool 场景，再选择其他项；根目录的 npm test 不会触发本实验。

## 接入配置

先完成[仓库依赖安装](../README.md)。接下来只设置当前终端的连接参数，尚不发起请求：

| 环境变量 | 填什么 |
| --- | --- |
| OPENAI_API_KEY | 模型服务的凭据 |
| OPENAI_BASE_URL | 该服务的 HTTPS 接口地址，包含它要求的 /v1 路径 |
| DSH_LIVE_MODEL | 服务实际支持的模型名；已有实测使用 gpt-6-luna |
| DSH_LIVE_API | 请求协议；下例明确使用 openai-responses |

将示例中的网关地址换成自己的地址，再选择与你的终端对应的一段。凭据通过隐藏输入读取，不写进代码或配置文件。

macOS / zsh：

```sh
read -rs 'OPENAI_API_KEY?模型凭据：'
export OPENAI_API_KEY
export OPENAI_BASE_URL='https://你的兼容网关/v1'
export DSH_LIVE_MODEL='gpt-6-luna'
export DSH_LIVE_API='openai-responses'
```

Windows PowerShell 7：

```powershell
$env:OPENAI_API_KEY = Read-Host '模型凭据' -MaskInput
$env:OPENAI_BASE_URL = 'https://你的兼容网关/v1'
$env:DSH_LIVE_MODEL = 'gpt-6-luna'
$env:DSH_LIVE_API = 'openai-responses'
```

这组环境变量只对当前终端及其启动的进程有效。若另开终端，需要重新提供。Windows 的用法不代表真实模型场景已在 Windows 实测；已有集成记录来自 macOS。

## 先运行一次工具往返

在同一个终端、仓库根目录运行：

```sh
node real-model/run.mjs tool
```

脚本要求模型调用 sum(19, 23)，检查工具返回 42，并核对后续实际发出的 HTTP 请求包含工具结果。它还检查最终回答含 42。只有这些条件都满足，才会出现 PASS tool。

若想继续，替换命令最后的场景名即可：

| 场景名 | 操作 | 重点观察 |
| --- | --- | --- |
| tool | 一次求和往返 | 工具输出确实进入下一次线上请求 |
| preset | 模型读取临时文件 | 请求中只开放 read，返回文件中的标记，内容不变 |
| review | 尝试写入，再提交结构化审查 | write 被 Guard 拒绝、主体执行 0 次，报告字段合法 |
| delivery | 缺证据交付、失败检查、修复、通过、再次修改 | finish_delivery 依次被拒绝、允许、再次拒绝 |

运行全部使用 `node real-model/run.mjs all` 或 `npm run test:live`。每项在自己的临时目录中运行，结束后清理并恢复 DSH_HOME。

## 地址和协议为什么要分别配置

baseURL 决定请求发到哪里，api 决定消息按什么协议发送。地址兼容不代表所有消息协议都兼容。

本实验通过官方 llm-pi-ai 配置独立路由 course-live，再把 Agent 的 provider/model 指向它。默认协议为 openai-responses，也可显式选择 openai-completions，但须由服务端支持。固定版 dsh-llm-deepseek 使用 DeepSeek Messages，换一个网关地址不会自动把它改成 Responses。

contextWindow=32768、maxTokens=2048 是脚本设置的运行限制，不代表模型的真实容量。配置只保存凭据的环境变量名；适配器在请求时读取值，测试工具启动的子进程不继承模型凭据。

## 已有记录怎样读

2026-10-10 使用 DSH `0.2.1-alpha.2`、Cordis `4.0.5-alpha.1`、gpt-6-luna 与 Responses 协议，四项共 17 次 HTTP 请求，均为 200：

```text
PASS tool: HTTP=2, steps=2, tools=sum:ok
PASS preset: HTTP=2, steps=2, tools=read:ok
PASS review: HTTP=4, steps=4, tools=write:denied,read_fixture:ok,review_report:ok
PASS delivery: HTTP=9, steps=9, tools=finish_delivery:denied,bash:ok,write:ok,bash:ok,bash:ok,finish_delivery:ok,write:ok,finish_delivery:denied
```

delivery 中第一次 bash:ok 表示工具成功交回进程结果，但该进程退出码为 1，测试实际失败。后面两条检查命令退出码才是 0。插件同时检查退出码、超时和取消，最后一次写入又让通过记录过期。

真实模型可能改变调用次数或操作顺序，所以未来输出未必仍是 17 次。脚本会按实际请求与结果检查，条件不符就失败。这里明确提示了操作顺序，review 还给出了预期缺陷，因此它检验集成流程，不能据此评价模型独立发现问题或自主编程的能力。

## 哪些部分由实验固定

preset 使用官方文件工具。review 的 write 只增加计数，read_fixture 读取故意放入缺陷的样例；delivery 的 bash 只接受 node --test、git diff --check 两条命令并真实启动程序，write 只改临时 sum.mjs。完整 Shell、Web 界面和操作系统沙箱另见 [Web 实验](../web/README.md)。

[run.mjs](./run.mjs) 的 `runScenario()` 根据场景装配插件和工具；`globalThis.fetch` 观察器检查实际请求。请求体只保留在内存中，不保存认证头、完整响应或思考内容。每项最多 12 次请求，每次网络超时 90 秒，180 秒后取消 Agent，默认不自动重试。

若失败，先读 HTTP 状态或断言位置。鉴权、模型名、协议不匹配时应核对连接配置；模型没有按预定步骤调用工具时，应检查已发生的调用记录。不要把 HTTP 成功当成整个实验成功。

实验使用内存 Session，未在这里验证磁盘保存或崩溃恢复。DSH 是运行时名称，所用 GPT 模型也不属于 DeepSeek 模型评测。

## 用完后清除当前终端中的凭据

macOS / zsh 执行 `unset OPENAI_API_KEY`；PowerShell 执行 `Remove-Item Env:OPENAI_API_KEY`。其他连接参数可保留，下一次运行时仍需提供凭据。
