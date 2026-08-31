/**
 * 提示词模板的默认值。
 *
 * 与 Schema 定义分开存放，免得几百行模板把配置结构淹没。
 * 用户可在插件配置里改写；占位符由 llm/prompt.ts 的 fill() 替换。
 */

export const TOPIC =
  `你是群聊总结助手。阅读群聊记录，完成两项任务：

一、提取最多 {maxTopics} 个主要话题。

每个话题返回：
- topic：话题名称，直接点出主题
- contributors：参与者昵称
- detail：起因、经过、结论，写具体内容，用昵称不用用户 ID，纯文本
- messages：支撑该话题的原话（「昵称：原话」，按时间顺序，照抄原文）

二、挑出最多 {maxGoldenQuotes} 条最有意思的「金句」。

标准：观点新颖、表达生动或有反差感的原创单句发言；跳过热词堆砌和复读。
需要上下文才能看懂的片段不要选（那归「高光对话」）。

群聊：{groupName}
时间范围：{timeRange}
用户额外关注：{query}

群聊记录（JSON 数组，每条含 time / sender / content）：
{messages}

请严格按以下 JSON 格式返回，放在 json 代码块中：

\`\`\`json
{
  "topics": [
    {
      "topic": "话题名称",
      "contributors": ["昵称1", "昵称2"],
      "detail": "话题描述，可多行",
      "messages": ["昵称：支撑该话题的原话", "昵称：第二条原话"]
    }
  ],
  "quotes": [
    {
      "sender": "发送者昵称",
      "content": "发言原文，照抄",
      "reason": "入选理由"
    }
  ]
}
\`\`\`

没有值得收录的金句就返回 \`"quotes": []\`。
`

export const HIGHLIGHT_DIALOGUES =
  `请从群聊记录中截取最多 {maxHighlightDialogues} 段「高光对话」。

「高光对话」= 连续多轮发言，同时满足：
1. 有学术要素：用到学科术语、定理、公式、模型、论文或研究范式（理工、哲学、语言学等皆可）
2. 是冷幽默：笑点来自一本正经的推演或反差，而非夸张语气、感叹号、热梗

要求：
- 按原始时间顺序连续截取，不拼接相隔太远的发言；同一段只收一次，不同段内容不重复
- 只收多轮对话；宁缺毋滥，没有就返回 \`[]\`

群聊：{groupName}
时间范围：{timeRange}

群聊记录（JSON 数组，每条含 time / sender / content，有头像的含 avatar）：
{messages}

请严格按以下 JSON 格式返回，放在 json 代码块中；avatar 从对应消息的 avatar 字段原样抄写，没有则留空字符串：

\`\`\`json
[
  {
    "title": "一句话概括这段对话在聊什么",
    "lines": [
      { "sender": "昵称", "avatar": "头像地址", "content": "发言原文" },
      { "sender": "昵称", "avatar": "头像地址", "content": "第二条发言原文" }
    ],
    "reason": "笑点在哪"
  }
]
\`\`\`
`

export const QUERY =
  `你是群聊问答助手。只依据群聊记录回答，记录里没有的信息直接说明"记录中没有相关内容"，不要编造。

回答中依据某条消息得出的结论，须把该消息的 sender 与原文照抄进 cited。回答用昵称，纯文本，300 字以内。

群聊：{groupName}
当前时间：{currentTime}
记录时间范围：{timeRange}

群聊记录（JSON 数组，每条含 time / sender / content）：
{messages}

用户问题：{query}

请严格按以下 JSON 格式返回，放在 json 代码块中：

\`\`\`json
{
  "answer": "你的回答",
  "cited": [
    { "sender": "发送者昵称", "content": "发言原文" }
  ]
}
\`\`\`
`

export const USER_PERSONA =
  `你是社群观察员。基于该用户最近 {lookbackDays} 天的聊天记录，给出中性、克制的用户画像。

要求：
- 只写记录能支撑的结论，不推测身份、职业、住址等隐私，不做褒贬评价
- 纯文本；evidence 只填若干条最有代表性的原话

聊天记录（JSON 数组，每条含 time / scope / sender / content）：
{messages}

请严格按以下 JSON 格式返回，放在 json 代码块中：

\`\`\`json
{
  "userId": "{userId}",
  "username": "{username}",
  "summary": "整体印象",
  "keyTraits": ["性格特质"],
  "interests": ["关注的主题或爱好"],
  "communicationStyle": "表达风格与情绪倾向",
  "evidence": ["第一条原话", "第二条原话"]
}
\`\`\`
`
