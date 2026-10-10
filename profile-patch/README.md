# 从配置输出到真实服务：Patch 的两次核对

本实验在固定版 `0.2.1-alpha.2` 上使用官方 `renderConfigDump`、Include、Loader 与 SessionTitle。它既检查合成配置，也检查真正激活的服务如何使用这份配置；不依赖本机另外安装的 `dsh`，不调用模型。

在仓库根目录运行：

```sh
npm ci --ignore-scripts
node profile-patch/run.mjs
```

Node.js 要求 `^22.19.0 || >=24.0.0`；依赖复用 `preset-runtime` workspace 的精确版本和统一 lockfile。运行时逐项核对版本。

## 两份输入

[base.cordis.yml](./base.cordis.yml) 摘出固定版 base Bundle 中真实的 `session-title` 行，保留三个必填字段 `fallbackMaxWords: 5`、`fallbackMaxBytes: 40`、`maxTitleBytes: 80`。它是最小输入，不是完整 Web Profile，也不声称复现了所有 Bundle 和用户层。

[session-title.patch.yml](./session-title.patch.yml) 将整份 config 替换为 9/40/80。上层只写 `fallbackMaxWords` 不会保留下层其他字段。脚本额外调用官方 `applyEntryPatches`，断言这种稀疏 Patch 的结果只有该字段；这里不拿 schema 默认值掩盖替换语义。

先调用与 CLI dump 共用的 `renderConfigDump`，比较 5→9；再创建两套独立 Host，使用真实 Include 分别加载基础配置和带 Patch 的配置。每行都必须导入成功、等待生命周期完成并处于 ACTIVE，不能把 Loader 没有未完成任务当作成功。

临时目录位于 npm workspace 之外，无法直接解析 workspace 内的包名。因此运行副本仅将模块名解析为已安装官方包的绝对 URL，Entry id 和 config 不变。实际 Patch 仍交给 Include 应用，随后核对运行树 Entry 的配置与 dump 结果一致。

## 不只是打印 5→9

在两套运行时各创建一个 Session，追加同一条用户消息：

```text
a b c d e f g h i j
```

调用官方 `sessionTitle.refresh`。未安装标题模型 Provider，服务走确定性的 fallback，并真实追加和投影标题事件。前者得到 `a b c d e`，后者得到 `a b c d e f g h i`。这把配置值、实例激活与可观察行为连在一起；不是脚本自行截词后宣布服务已生效。

2026-10-10，macOS / Node.js v24.14.1 的实际输出：

```text
PASS patch: official renderConfigDump fallbackMaxWords=5 -> 9; whole config replacement asserted
PASS activation: real sessionTitle fallback="a b c d e" -> "a b c d e f g h i"; no model provider
PASS isolation: temporary DSH_HOME; source and copied base unchanged; runtime disposed
```

脚本将自己的 `DSH_HOME` 设为临时目录，断言源文件和临时基础文件内容未变；所有 Context 退出后清理临时目录并恢复环境变量。不修改默认 Profile，不安装 JSONL 持久化，不测试配置 HMR 或文件写回；这是冷启动组合实验。跨平台离线检查见[仓库 CI](https://github.com/DavidDingXu/deepseek-harness-labs/actions)。

源码对应 [base Bundle 的原始行](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/bundle/base/cordis.patch.yml#L55)、[官方 dump 合成入口](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/boot/app-boot/src/index.ts#L432)、[Patch 覆盖赋值](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/vendor/include/src/index.ts#L115)及 [SessionTitle.refresh](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-title/src/index.ts#L436)。实验运行官方 npm 包，上述链接用于定位相应实现。
