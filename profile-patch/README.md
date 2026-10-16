# 配置里的 5 改成 9，标题真的会变吗

一份配置要求会话标题最多取前 5 个词，上层 Patch 把它改成 9。这个实验会核对两件事：合成后的配置是什么，真正运行的标题服务又生成了什么。对应第 08 讲。

Patch 是覆盖下层条目的配置。本实验只取完整产品中的标题服务这一小段，不需要另装 dsh 命令，也不调用模型。

完成[依赖安装](../README.md)后，在仓库根目录执行：

```sh
node profile-patch/run.mjs
```

关键输出为：

```text
PASS patch: official renderConfigDump fallbackMaxWords=5 -> 9; whole config replacement asserted
PASS activation: real sessionTitle fallback="a b c d e" -> "a b c d e f g h i"; no model provider
```

第一行说明配置合成结果变了；第二行说明官方标题服务的行为也变了。两项都检查，才能区分“配置写出来了”和“运行时用上了”。

## 两份文件各改了什么

[base.cordis.yml](./base.cordis.yml) 是基础条目，[session-title.patch.yml](./session-title.patch.yml) 按同一个 Entry id 覆盖它。Entry 就是配置中的一个插件条目。

| 字段 | 基础值 | Patch 值 | 含义 |
| --- | --- | --- | --- |
| fallbackMaxWords | 5 | 9 | 不使用模型生成标题时，最多取几个词 |
| fallbackMaxBytes | 40 | 40 | 同一路径的标题字节上限 |
| maxTitleBytes | 80 | 80 | 标题长度的字节上限 |

这里的 config 按整份对象替换。只在 Patch 中写 `fallbackMaxWords: 9`，不会顺便保留下层另外两个字段。脚本调用官方 `applyEntryPatches` 检查了这一点；完整 Patch 因而明确保留 40、80。

## 从配置走到标题

打开 [run.mjs](./run.mjs)，先看 `before`、`after` 两份配置，再看 `titles` 的生成过程：

1. 调用与 CLI 配置输出共用的 `renderConfigDump`，核对 5 与 9。
2. 分别创建两套运行环境，由 Include 加载基础配置或带 Patch 的配置，逐项等待插件处于 ACTIVE 状态。
3. 在两套会话中写入同一条消息 `a b c d e f g h i j`，调用官方 `sessionTitle.refresh()`。

没有配置标题模型，因此服务使用自己的备用规则，从输入中取词。两份标题分别为 `a b c d e` 和 `a b c d e f g h i`。脚本还比较运行树中条目的配置，确认它与前面的合成结果一致。

如果想检查为何 config 必须写全，可以在临时副本中删除 Patch 的 `fallbackMaxBytes`、`maxTitleBytes`，再运行。应报 `ValidationError`，提示 fallbackMaxBytes 缺少必填值；基础配置中的 40 没有自动补回。修改前先保留原文件，练习后恢复。

## 复现时的装配细节

运行使用官方 npm 包 DSH `0.2.1-alpha.2`，共享环境在 [preset-runtime](../preset-runtime/README.md)。脚本将 `DSH_HOME` 指向自己的临时目录，退出后恢复环境并清理文件。

临时目录位于 npm 子包目录之外，无法直接找到子包依赖。脚本因此只把运行副本中的模块名解析成已安装包的绝对 URL，条目 id 和 config 不变；配置覆盖仍由官方 Include 执行。

本实验验证启动时的配置组合。它不包含在线热更新、默认 Profile 修改或会话落盘；源配置和临时基础文件在运行结束时都应保持原样。

## 可选源码对照

[base Bundle 的原始行](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/bundle/base/cordis.patch.yml#L55)、[官方 dump 合成入口](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/boot/app-boot/src/index.ts#L432)、[Patch 覆盖赋值](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/vendor/include/src/index.ts#L115)及 [SessionTitle.refresh](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-title/src/index.ts#L436)。实验运行官方 npm 包，上述链接用于定位相应实现。
