/**
 * 提示词模板的默认值。
 *
 * 与 Schema 定义分开存放，免得几百行模板把配置结构淹没。
 * 用户可在插件配置里改写；占位符由 llm/prompt.ts 的 fill() 替换。
 */

export const TOPIC =
`你是群聊记录总结助手。请阅读下面的群聊记录，提取最多 {maxTopics} 个主要话题。

对每个话题请给出：
1. 话题名称：简明扼要，直接点出主题
2. 主要参与者：最多 5 人，使用昵称
3. 话题描述：讲清楚起因、经过、结论。写具体内容而不是"讨论了某某问题"这类空泛描述；描述中使用昵称而非用户 ID；使用纯文本，不要 markdown 语法

群聊：{groupName}
时间范围：{timeRange}
用户额外关注：{query}

群聊记录：
{messages}

请严格按以下 YAML 格式返回，并放在 markdown 代码块中：
\`\`\`yaml
- topic: "话题名称"
  contributors:
    - "昵称1"
    - "昵称2"
  detail: |-
    话题描述，可多行
\`\`\``

export const GOLDEN_QUOTES =
`请从下面的群聊记录中挑出最多 {maxGoldenQuotes} 条最有意思的「金句」。

挑选标准：观点新颖、表达生动、或有反差感与记忆点的原创发言。跳过纯粹的网络热词堆砌和复读。

群聊：{groupName}
时间范围：{timeRange}

群聊记录：
{messages}

请严格按以下 YAML 格式返回，并放在 markdown 代码块中：
\`\`\`yaml
- content: |-
    金句原文
  sender: "发言人昵称"
  reason: |-
    入选理由，纯文本
\`\`\``

export const QUERY =
`你是群聊记录问答助手。请只依据下面的群聊记录回答用户的问题。

规则：
- 记录里没有的信息，直接说明"记录中没有相关内容"，不要编造
- 回答中使用昵称而非用户 ID
- 用纯文本回答，不要使用 markdown 语法，控制在 300 字以内

群聊：{groupName}
当前时间：{currentTime}
记录时间范围：{timeRange}

群聊记录：
{messages}

用户问题：{query}`

export const USER_PERSONA =
`你是一名社群观察员。请基于该用户的聊天记录，给出一份中性、克制的用户画像。

步骤：
1. 通读「聊天记录」，这是该用户最近 {lookbackDays} 天的发言
2. 仅依据这批记录归纳结论，不要假设该用户在此之外还有别的特征

要求：
- 只写记录能支撑的结论，不要推测用户的真实身份、职业、住址等隐私信息
- 保持中性描述，不做褒贬评价
- 纯文本，不要 markdown 语法
- evidence 只填记录中 <msgid:xxx> 里的 id 原文，挑 5-10 条最有代表性的，不要编造 id

聊天记录：
{messages}

请严格按以下 YAML 格式返回，并放在 markdown 代码块中：
\`\`\`yaml
- userId: "{userId}"
  username: "{username}"
  summary: |-
    整体印象，200 字以内
  keyTraits:
    - "性格特质"
  interests:
    - "关注的主题或爱好"
  communicationStyle: |-
    表达风格与情绪倾向，100 字以内
  evidence:
    - "msgid"
\`\`\``
