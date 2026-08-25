# koishi-plugin-qq-group-to-llm

[![npm](https://img.shields.io/npm/v/koishi-plugin-qq-group-to-llm?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-qq-group-to-llm)

记录 QQ 群消息，并接入 LLM 做群聊分析。

## 功能

- **消息记录**：监听群消息写入 `qq_group_messages` 表，消息元素序列化为纯文本（图片、引用是否展开可配置），不记录 bot 自身的消息
- **群聊分析**：`群分析` 命令调用 LLM 生成报告——热门话题、高光对话、活跃榜
- **自由问答**：`群分析 <问题>` 就近期聊天记录提问，仅依据记录作答
- **用户画像**：`用户画像` 命令跨群汇总某人的发言生成画像，每次都基于最新发言重新生成，结论落库供缓存复用
- **定期清理**：按 `retentionDays` 删除过期消息（0 表示永久保留）

## 命令

```
群分析                        # 分析最近 1 天，输出报告（别名 group-analysis）
群分析 -d 3                   # 分析最近 3 天
群分析 今天聊了什么部署的事    # 就记录自由提问
群分析 -f                     # 忽略缓存重新分析
群分析 -g <频道 ID>            # 私聊中指定目标频道
用户画像                      # 查看自己的画像（别名 user-persona）
用户画像 @某人                # 查看他人，需要 personaViewAuthority 权限
用户画像 -f                   # 忽略缓存重新生成
```

## LLM 接入

走 OpenAI 兼容的 `/chat/completions` 接口，任何兼容厂商都可以用，在插件配置的「LLM 接口」一节填写 `openaiEndpoint` / `openaiApiKey` / `openaiModel`。

结构化结果要求模型返回 markdown 代码块中的 YAML；四段提示词模板（话题 / 高光对话 / 问答 / 用户画像）都可在配置的「提示词」一节改写，占位符见各项描述。

`LLMService` 注册为 `ctx.qqGroupLlm` 服务，其他插件可直接复用。

## 高光对话

报告里的「高光对话」板块取代了原先的单条金句：入选的必须是一段连续的多轮对话，并且同时满足两个条件——用到了某个学科的术语、定理、模型或研究范式，且笑点来自一本正经的推演与反差，而不是感叹号、颜文字和网络热梗。两条缺一不可，模型找不到就返回空列表，该板块整段不渲染。

`maxHighlights` 控制最多截几段（0 关闭该板块），`maxHighlightLines` 控制单段最多保留几轮。模型返回后还会再过一道：丢掉空轮次、按 `maxHighlightLines` 截断，并要求剩下的至少两轮、至少两人——一个人自问自答不算对话，会被整段丢弃。

## 用户画像

每次生成都只依据回溯窗口内的最新发言，不把已有结论回喂给模型，也不与旧画像做字段合并——结果完全由这批记录决定。画像以 YAML 存进 `qq_group_personas` 表，仅用于缓存复用；当发言条数不足或模型调用失败、本次无法产出时，会返回库里的旧画像并说明原因，而不是把它抹掉。

投喂给模型的每条消息都带 `<msgid:xxx>` 锚点，模型在 `evidence` 中引用这些 id，渲染前回查原文——查不到的 id 直接丢弃，模型编不出不存在的「代表发言」。

默认汇总该用户在所有已记录频道的发言，`personaOnlyCurrentGroup` 可限制为当前频道；`personaCacheDays` 天内复用已有结果，`-f` 跳过。

命令触发时会抓取画像主人的头像并存进 `qq_group_personas.avatar`，结果消息里作为图片附在文字前面。看自己的画像时头像直接来自会话；看他人时走 `bot.getUser()`，平台不支持就省略头像，不影响画像本身。本次没抓到时沿用库里已存的旧值。

## 调试

日志统一挂在 `qq-group-to-llm` 名下，在控制台的日志页按这个名字过滤即可。

`info` 级别覆盖关键路径：插件启动的生效配置、监听范围、每次 LLM 请求的模型/提示词长度/耗时/**token 用量**、**LLM 的完整返回原文与解析后的结构**、取数条数与是否触顶截断、缓存命中、命令由谁在哪里发起、画像更新与合并方式。

`warn` 覆盖可疑但不致命的情况：提示词有未替换的占位符、模型没按 YAML 格式返回、画像引用了不存在的 msgid（会列出被丢弃的 id）、子任务失败导致报告某段留空。

出错时一律打全文不截断：没按格式返回时打完整响应，YAML 语法错时打完整 YAML，接口返回空时打完整响应体（含厂商的 error 字段，比如 `insufficient_quota`）。

把日志级别调到 `debug` 会额外打印**完整提示词**——里面含几百条群消息，很吵，按需开启。API Key 在任何级别都不会进日志。

嫌 `info` 里的完整响应太吵，把 `llm/index.ts` 里那两行 `完整响应` / `解析出` 的 `log.info` 改回 `log.debug` 即可。注意 reggol 对**单行**超过 10240 字会截断，YAML 是多行的所以不受影响。

## 目录结构

```
src/
├── index.ts            插件入口：装配各模块
├── types.ts            跨模块共享的领域类型
├── logger.ts           具名 logger，统一日志来源
├── config/
│   ├── index.ts        配置接口与 Schema
│   └── prompts.ts      提示词模板默认值
├── database/
│   ├── index.ts        建表
│   └── tables.ts       表名常量与记录类型
├── llm/
│   ├── index.ts        LLMService：OpenAI 兼容调用
│   └── prompt.ts       占位符填充、YAML 提取等纯函数
├── message/
│   ├── recorder.ts     消息监听、过滤与序列化
│   └── retention.ts    过期消息清理
├── analysis/
│   ├── group.ts        群分析编排
│   ├── persona.ts      用户画像编排
│   ├── stats.ts        发言统计（纯函数）
│   └── report.ts       文本报告渲染（纯函数）
└── commands/
    ├── analysis.ts     群分析 / 自由问答
    └── persona.ts      用户画像
```

依赖是单向的：`logger` 和 `types` 是叶子，`config`、`database` 只依赖它们，`llm` 与 `message` 建立在这之上，`analysis` 再往上，`commands` 位于最外层。统计与渲染被拆成不依赖 `Context` 的纯函数，可以脱离 Koishi 单独测试。
