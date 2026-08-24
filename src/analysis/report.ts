/** 把分析结果渲染成发到群里的纯文本，不含任何取数与调用逻辑 */

import type { GroupAnalysisResult, UserPersonaProfile } from '../types'

const toArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : []

/** 把分析结果渲染为纯文本报告 */
export function renderReport(result: GroupAnalysisResult): string {
  const lines = [
    `📊 群聊分析 · ${result.groupName}`,
    `时间范围: ${result.timeRange}`,
    `消息 ${result.totalMessages} 条 | 参与 ${result.totalParticipants} 人 | 共 ${result.totalChars} 字` +
      (result.mostActivePeriod ? ` | 最活跃时段 ${result.mostActivePeriod}` : ''),
  ]

  lines.push('', '💬 热门话题')
  if (result.topics.length) {
    for (const topic of result.topics) {
      const contributors = toArray(topic.contributors)
      lines.push(`· ${topic.topic}${contributors.length ? `（${contributors.join('、')}）` : ''}`)
      if (topic.detail?.trim()) lines.push(`  ${topic.detail.trim().replace(/\n/g, '\n  ')}`)
    }
  } else {
    lines.push('· 暂无')
  }

  if (result.goldenQuotes.length) {
    lines.push('', '✨ 群圣经')
    for (const quote of result.goldenQuotes) {
      lines.push(`· "${quote.content?.trim() ?? ''}" —— ${quote.sender || '匿名'}`)
      if (quote.reason?.trim()) lines.push(`  ${quote.reason.trim()}`)
    }
  }

  if (result.userStats.length) {
    lines.push('', '🔥 活跃榜')
    result.userStats.forEach((user, index) => {
      lines.push(`${index + 1}. ${user.username} — ${user.messageCount} 条 / 平均 ${user.avgChars} 字`)
    })
  }

  return lines.join('\n')
}

/** 把画像渲染为纯文本 */
export function renderPersona(persona: UserPersonaProfile, evidenceText: string[] = []): string {
  const lines = [`🪞 用户画像 · ${persona.username || persona.userId}`, '', persona.summary?.trim() || '（无总结）']

  const traits = toArray(persona.keyTraits)
  if (traits.length) lines.push('', `🏷 性格特质：${traits.join('、')}`)

  const interests = toArray(persona.interests)
  if (interests.length) lines.push('', `🎯 关注领域：${interests.join('、')}`)

  if (persona.communicationStyle?.trim()) {
    lines.push('', `🗣 表达风格：${persona.communicationStyle.trim()}`)
  }

  if (evidenceText.length) {
    lines.push('', '📌 代表发言')
    for (const quote of evidenceText) lines.push(`· ${quote}`)
  }

  return lines.join('\n')
}
