/** 把分析结果渲染成发到群里的 markdown 报告，不含任何取数与调用逻辑 */
/**
 * QQ 官方 markdown 渲染约束（https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/markdown.html）：
 * - 支持标题(#/##)、加粗(**)、斜体、删除线、有序/无序列表与嵌套
 * - 列表前若是普通文本，必须用空行隔开，否则无法被识别
 * - 单条 markdown 消息建议不超过 2000 字符
 */
import type { GroupAnalysisResult, UserPersonaProfile } from '../types'
import { escapeMarkdown } from '../markdown'

const toArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : []

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

  if (result.highlights.length) {
    lines.push(`## 🧊 高光对话`)
    for (const highlight of result.highlights) {
      if (highlight.title) lines.push(`**${escapeMarkdown(highlight.title)}**`)
      // 逐轮渲染，保留一来一回的节奏——冷幽默的笑点常常只在上下文里成立
      for (const line of highlight.lines) {
        lines.push(`> **${escapeMarkdown(line.sender || '匿名')}：**${escapeMarkdown(line.content)}`)
      }
      if (highlight.academicPoint) lines.push(`**🎓 学术要素：** ${escapeMarkdown(highlight.academicPoint)}`)
      if (highlight.reason) lines.push(`**❄️ 冷在哪：** ${escapeMarkdown(highlight.reason)}`)
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

  // 去除结尾多余空行
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

/** 把画像渲染为 markdown 文本 */
export function renderPersona(persona: UserPersonaProfile, evidenceText: string[] = []): string {
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

  if (evidenceText.length) {
    lines.push('', '**📌 代表发言**')
    for (const quote of evidenceText) {
      lines.push(`> ${escapeMarkdown(quote)}`)
    }
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}
