# koishi-plugin-qq-group-to-llm

[![npm](https://img.shields.io/npm/v/koishi-plugin-qq-group-to-llm?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-qq-group-to-llm)

记录 QQ 群消息，并接入 LLM 做群聊分析。

## 功能

- **消息记录**：监听群消息写入 `qq_group_messages` 表，消息元素序列化为纯文本（图片、引用是否展开可配置），不记录 bot 自身的消息
- **群聊分析**：`群分析` 命令调用 LLM 生成报告——热门话题、群圣经、活跃榜
- **自由问答**：`群分析 <问题>` 就近期聊天记录提问，仅依据记录作答
- **消息查询**：`msglog [条数]` 查看原始记录，支持 `-g <频道 ID>` / `-u <用户 ID>`
- **定期清理**：按 `retentionDays` 删除过期消息（0 表示永久保留）

## 命令

```
群分析                        # 分析最近 1 天，输出报告（别名 group-analysis）
群分析 -d 3                   # 分析最近 3 天
群分析 今天聊了什么部署的事    # 就记录自由提问
群分析 -f                     # 忽略缓存重新分析
群分析 -g <频道 ID>            # 私聊中指定目标频道
msglog 20 -u <用户 ID>        # 查看原始记录
```

## LLM 接入

走 OpenAI 兼容的 `/chat/completions` 接口，任何兼容厂商都可以用，在插件配置的「LLM 接口」一节填写 `openaiEndpoint` / `openaiApiKey` / `openaiModel`。

结构化结果要求模型返回 markdown 代码块中的 YAML；三段提示词模板（话题 / 金句 / 问答）都可在配置的「提示词」一节改写，占位符见各项描述。

`LLMService` 注册为 `ctx.qqGroupLlm` 服务，其他插件可直接复用。

## 目录结构

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 插件入口，装配各模块 |
| `src/config.ts` | 配置项接口与 Schema（含提示词模板） |
| `src/model.ts` | 数据表结构与类型声明 |
| `src/types.ts` | 分析结果的领域类型 |
| `src/listener.ts` | 消息监听、过滤与序列化 |
| `src/llm.ts` | `LLMService`：OpenAI 兼容调用与 YAML 解析 |
| `src/analysis.ts` | 取数、统计、编排 LLM、渲染报告 |
| `src/command.ts` | `msglog` 与 `群分析` 命令 |
| `src/cleanup.ts` | 过期消息清理定时任务 |
