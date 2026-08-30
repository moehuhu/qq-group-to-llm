/** 把分析结果渲染成发到群里的 markdown 报告，不含任何取数与调用逻辑 */
/**
 * QQ 官方 markdown 渲染约束（https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/markdown.html）：
 * - 支持标题(#/##)、加粗(**)、斜体、删除线、有序/无序列表与嵌套
 * - 列表前若是普通文本，必须用空行隔开，否则无法被识别
 * - 单条 markdown 消息建议不超过 2000 字符
 */
import type { DialogueDigest, GroupAnalysisResult, HighlightLine, QueryAnswerResult, UserPersonaProfile } from '../types'
import { escapeMarkdown } from '../markdown'

const toArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : []

/** 用八级方块字符把 24 小时发言量画成一行迷你柱状图 */
const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
export function sparkline(hourly: number[]): string {
  const peak = Math.max(0, ...hourly)
  if (!peak) return ''
  return hourly.map((count) => {
    if (!count) return ' '
    // 有发言就至少占一格，免得和「没有」混为一谈
    const level = Math.max(1, Math.round((count / peak) * (BLOCKS.length - 1)))
    return BLOCKS[level]
  }).join('')
}

/** 把分析结果渲染为 markdown 报告 */
export function renderReport(result: GroupAnalysisResult): string {
  const lines: string[] = []
  lines.push(`# 📊 群聊分析报告`)
  lines.push('')
  lines.push(`**群聊标题：** ${escapeMarkdown(result.groupName)}`)
  lines.push(`**时间范围：** ${escapeMarkdown(result.timeRange)}`)
  lines.push(`**统计：** ${result.totalMessages} 条消息 | ${result.totalParticipants} 人参与 | 共 ${result.totalChars} 字` +
    (result.mostActivePeriod ? ` | 最活跃时段 ${result.mostActivePeriod}` : ''))
  lines.push('')

  lines.push(`## 💬 热门话题`)
  if (result.topics.length) {
    for (const topic of result.topics) {
      const contributors = toArray(topic.contributors)
      lines.push(`**${escapeMarkdown(topic.topic)}**${contributors.length ? `（${escapeMarkdown(contributors.join('、'))}）` : ''}`)
      if (topic.detail?.trim()) {
        lines.push(`> ${escapeMarkdown(topic.detail.trim())}`)
      }
      lines.push('')
    }
  } else {
    lines.push('暂无')
    lines.push('')
  }

  if (result.quotes.length) {
    lines.push(`## ✨ 金句`)
    for (const quote of result.quotes) {
      lines.push(`> ${escapeMarkdown(quote.content)} —— ${escapeMarkdown(quote.sender || '匿名')}`)
      if (quote.reason) lines.push(`> ${escapeMarkdown(quote.reason)}`)
      lines.push('')
    }
  }

  if (result.userStats.length) {
    lines.push(`## 🔥 活跃榜`)
    result.userStats.forEach((user, index) => {
      lines.push(`${index + 1}. ${escapeMarkdown(user.username)} — ${user.messageCount} 条 / 平均 ${user.avgChars} 字`)
    })
    lines.push('')
  }

  const hourly = result.hourly ?? []
  const peak = Math.max(0, ...hourly)
  if (peak) {
    lines.push(`## 🕓 活跃时段`)
    // 文本出口用一行迷你柱状图：24 行逐时列表在聊天窗口里太占地方
    lines.push(`\`${sparkline(hourly)}\``)
    lines.push(`0 点 ————————— 12 点 ————————— 23 点`)
    const peakHour = hourly.indexOf(peak)
    lines.push(`最闹的一小时 ${String(peakHour).padStart(2, '0')}:00，共 ${peak} 条`)
    lines.push('')
  }

  // 去除结尾多余空行
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

/** 把高光对话渲染为 markdown 文本 */
export function renderDialogues(digest: DialogueDigest<HighlightLine>): string {
  const lines: string[] = []
  lines.push(`# 🧊 高光对话`)
  lines.push('')
  lines.push(`**群聊标题：** ${escapeMarkdown(digest.groupName)}`)
  lines.push(`**时间范围：** ${escapeMarkdown(digest.timeRange)}`)
  lines.push('')

  for (const dialogue of digest.dialogues) {
    if (dialogue.title) lines.push(`**${escapeMarkdown(dialogue.title)}**`)
    // 逐轮渲染，保留一来一回的节奏——冷幽默的笑点常常只在上下文里成立
    for (const line of dialogue.lines) {
      lines.push(`> **${escapeMarkdown(line.sender || '匿名')}：**${escapeMarkdown(line.content)}`)
    }
    if (dialogue.reason) lines.push(`**❄️ 冷在哪：** ${escapeMarkdown(dialogue.reason)}`)
    lines.push('')
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

/** 把画像渲染为 markdown 文本 */
export function renderPersona(persona: UserPersonaProfile, evidence: string[] = []): string {
  const lines: string[] = []
  lines.push(`# 🪞 用户画像 · ${escapeMarkdown(persona.username || persona.userId)}`)
  lines.push('')
  lines.push(escapeMarkdown(persona.summary?.trim() || '（无总结）'))
  lines.push('')

  const traits = toArray(persona.keyTraits)
  if (traits.length) lines.push(`**🏷 性格特质：** ${escapeMarkdown(traits.join('、'))}`)

  const interests = toArray(persona.interests)
  if (interests.length) lines.push(`**🎯 关注领域：** ${escapeMarkdown(interests.join('、'))}`)

  if (persona.communicationStyle?.trim()) {
    lines.push(`**🗣 表达风格：** ${escapeMarkdown(persona.communicationStyle.trim())}`)
  }

  if (evidence.length) {
    lines.push('', '**📌 代表发言**')
    for (const quote of evidence) {
      lines.push(`> ${escapeMarkdown(quote)}`)
    }
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

/**
 * 把问答渲染为普通文本，不做 markdown 转义，原文与换行照常保留。
 * 引用消息由模型直接返回发送者与原文，但按需求不展示引用来源，只输出回答正文。
 */
export function renderQueryAnswer(result: QueryAnswerResult): string {
  const lines: string[] = []
  lines.push(`回答：`)
  lines.push('')
  lines.push(result.answer?.trim() || '（无回答）')
  lines.push('')

  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}
