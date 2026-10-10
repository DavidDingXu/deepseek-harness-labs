# 完整 Web：从选择 Preset 到核对执行轨迹

本实验把第 22—24 讲的扩展装进官方 `@deepseek-ai/dsh@0.2.1-alpha.2` Web 产品。浏览器实际提交消息，`gpt-6-luna` 经官方 llm-pi-ai 的 Responses 路由生成工具调用，文件与命令由官方 tool-fs、tool-bash 执行。它会使用模型额度；默认 `npm test` 不启动它。

## 准备独立安装

需要符合上游要求的 Node.js、npm、Git 和一个支持该模型 Responses 协议的网关。在仓库根目录操作，先按[凭据输入方式](../real-model/README.md#接入配置)设置 `OPENAI_API_KEY` 与 `OPENAI_BASE_URL`，再执行：

macOS / zsh：

```sh
acceptance_root="$(node -e 'const fs=require("node:fs"),os=require("node:os"),p=require("node:path");console.log(fs.mkdtempSync(p.join(os.tmpdir(),"dsh-web-")))')"
npm install --prefix "$acceptance_root" --ignore-scripts --save-exact @deepseek-ai/dsh@0.2.1-alpha.2
node web/prepare.mjs "$acceptance_root"
node web/start.mjs "$acceptance_root" 3187
unset OPENAI_API_KEY
```

Windows PowerShell 7：

```powershell
$acceptanceRoot = node -e 'const fs=require("node:fs"),os=require("node:os"),p=require("node:path");console.log(fs.mkdtempSync(p.join(os.tmpdir(),"dsh-web-")))'
npm install --prefix $acceptanceRoot --ignore-scripts --save-exact @deepseek-ai/dsh@0.2.1-alpha.2
node web/prepare.mjs $acceptanceRoot
try { node web/start.mjs $acceptanceRoot 3187 } finally { Remove-Item Env:OPENAI_API_KEY }
```

准备器拒绝覆盖已有的 `home` 或 `workspace`。它只复制三个扩展、生成 patch 和一个故意写错加法的 Git 样例。凭据引用为环境变量名，配置不保存凭据值。默认模型设为 gpt-6-luna；32768/4096 是本实验的上下文与输出限制，不是模型容量声明。产品会持续提供服务，完成后在启动终端按 Ctrl+C。

从终端打开带访问授权的本地地址。完成欢迎页后，点击“添加工作区”，在浏览器目录选择器中选中刚生成的 `workspace`。**不要把 CLI 的启动目录当成 Web 已选择的目录**：Web 工作区由自己的 controller 管理。准备器另将默认 Documents 位置指向实验目录，避免第一次初始化落在个人文档目录。

目录选择器用官方 browse Host 与 Client 成对替换原自动选择器；必须禁用原来的 `directory-picker`，只改 Entry 的 `name` 不等于替换模块。模型按钮应显示 gpt-6-luna，新会话模式菜单应出现三个实验 Preset。

## 按可观察结果验收

每项使用新会话，先选择对应 Preset，再发送提示。等待运行结束，打开“轨迹”逐项核对工具名称、参数和结果，同时检查实验目录的文件。不能仅凭最终回答声称通过。

| 场景 | 操作与预期 | 反证检查 |
| --- | --- | --- |
| 只读配置 | 选“代码审查配置实验”，让模型读取 evidence.txt；返回 `HARNESS_WEB_EVIDENCE_72941` | 检查请求工具表只有 read；检查文件内容没有改变 |
| 审查插件 | 选“代码审查插件实验”，要求先尝试 write 创建 guard-probe.txt，再读 sum.mjs，最后调用 review_report | write 返回 Guard 拒绝；探针文件不存在；报告为 needs_changes，指出第 2 行减法 |
| 交付正常路径 | 选“交付守门员实验”，先 finish_delivery，再 node --test，修复 sum.mjs，运行 node --test 与 git diff --check，最后 finish_delivery | 第一次 missing 拒绝；首次测试退出 1；修复后退出 0，交付允许 |
| 交付过期路径 | 在已修复样例上开新的门禁会话，使用下面的负向提示 | 最后一次 write 后不能插入新检查；finish_delivery 返回 tests=stale、diff-check=stale |
| 停止与恢复 | 有可见回答时点击“停止生成”，刷新；退出并重启服务，再打开历史会话 | 已停止内容仍存在，不能悄悄变成已完成；Session 的 interrupted 与 turn/end 对应 |
| 窄屏操作 | 390px 打开会话、切换对话/轨迹、展开侧边栏、重开历史 | 输入区与按钮可见，没有整页横向溢出；这不是移动设备全兼容测试 |

审查提示可直接使用：

```text
这是一次已授权的临时项目插件验收。先调用 write，尝试把 guard-probe.txt 写成 probe，预期由 Guard 拒绝，不要重试也不要绕过。再读取 sum.mjs，检查加法实现，最后调用 review_report 提交审查结论。请实际调用工具，不要只口头描述。
```

过期路径必须与自动修复区分：

```text
这是明确的负向验收，最后的拒绝是预期结果。严格依次调用：
1. bash 执行 node --test；
2. bash 执行 git diff --check；
3. finish_delivery，预期通过；
4. 读取 sum.mjs，用 write 只在末尾追加 // stale acceptance；
5. 立即调用 finish_delivery，预期 stale 拒绝。
写文件时提供非空 justification。写入后绝不重跑检查，也不修复预期拒绝。
```

## 从执行记录解释结果

只读配置要检查实际请求中的工具表；审查要同时检查 Guard 错误结果与磁盘文件；交付要检查每条命令的退出码和后续 finish_delivery 的结果。页面最终回答用于展示，不能代替这些事实。结构化报告沿用产品已有对话与轨迹显示。

停止后的可见内容保存在带 `interrupted=true` 的 assistant/message 中，当前 Step 闭合，Turn 以用户取消的 aborted 原因结束。刷新重建展示和强杀进程后的恢复是不同测试；模型可能很快答完，单次点击也不能用于评价长输出的取消延迟。

## 为什么挂载时间会影响插件行为

Web 可以先创建空白 Agent，再选择 Preset。[只读钩子](../review-preset/web-readonly.mjs)同时处理创建和选择事件，切走或卸载时撤销过滤。只在创建时处理，会出现界面已切换、请求工具表却未收窄的问题。

[交付插件](../delivery-gate/delivery-gate.mjs)也可能晚于 Agent 创建才挂载。它在第一次使用时核对 Agent 仍是 Registry 的活跃实例，然后初始化 missing 状态；不能把没赶上事件误当成没有合法 owner。

负向测试需要让模型停在拒绝点。若 persona 一律要求修改后重跑检查，模型可能更新证据，使最后一次交付再次通过。这里为明确要求的负向验收保留停止修复的分支；真正拒绝执行的仍是 Guard，而不是 persona。

已验证环境为 macOS、Node.js 24.14.1、Chrome 154、gpt-6-luna；桌面与 390px 视口均检查了上述交互。这里不覆盖全部产品设置、附件、自动化任务、多浏览器、OS 沙箱绕过、崩溃恢复或 SDK 入口。
