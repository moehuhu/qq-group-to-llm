# koishi-plugin-qq-group-to-llm

[![npm](https://img.shields.io/npm/v/koishi-plugin-qq-group-to-llm?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-qq-group-to-llm)

记录 QQ 群消息，并接入 LLM 做群聊分析。

## 功能

- **消息记录**：监听群消息写入 `qq_group_messages` 表，消息元素序列化为纯文本（图片、引用是否展开可配置），不记录 bot 自身的消息
- **群聊分析**：`群分析` 命令调用 LLM 生成报告——热门话题、群圣经、活跃榜
- **自由问答**：`群分析 <问题>` 就近期聊天记录提问，仅依据记录作答
- **用户画像**：`用户画像` 命令跨群汇总某人的发言生成画像，结论落库并在下次分析时迭代
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

结构化结果要求模型返回 markdown 代码块中的 YAML；四段提示词模板（话题 / 金句 / 问答 / 用户画像）都可在配置的「提示词」一节改写，占位符见各项描述。

`LLMService` 注册为 `ctx.qqGroupLlm` 服务，其他插件可直接复用。

## 用户画像

画像以 YAML 存进 `qq_group_personas` 表，下次生成时作为「历史画像」回喂给模型，让结论在已有基础上迭代而不是每次重来；新画像里为空的字段会回退到历史值，一次失败的生成不会抹掉已有结论。

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
