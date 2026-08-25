/**
 * 把分析结果渲染成用于截图的 HTML，纯函数，不依赖 Context。
 * 与 analysis/report.ts 的 markdown 渲染并行存在：同一份数据两种出口，
 * 开关关闭或 puppeteer 不可用时仍旧走 markdown。
 */
import type { GroupAnalysisResult, HighlightDialogue, UserPersonaProfile } from '../types'
import { STYLE } from './theme'

const toArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : []

/** HTML 转义。群昵称和消息内容都是不可信输入，一律走这里 */
export function escapeHtml(value: string | undefined | null): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** 由昵称派生一个稳定的头像底色，同一个人每次渲染颜色一致 */
const AVATAR_COLORS = [
  '#5b6ef5', '#8b5cf6', '#e0568c', '#f0913a',
  '#2ec5b6', '#3b9ae1', '#7c9c3b', '#c2568c',
]
function avatarColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/**
 * 取头像上的单字。中文昵称取末字——「老王」「老李」这类前缀在群里太常见，
 * 取首字几乎必然撞成同一个字；其余情况取首字。用展开符切分，emoji 代理对不会被劈开。
 */
export function initial(name: string): string {
  const chars = [...(name || '')]
  if (!chars.length) return '?'
  return CJK.test(name) ? chars[chars.length - 1] : chars[0].toUpperCase()
}

const section = (title: string, inner: string) =>
  `<div class="section"><div class="section-title">${title}</div>${inner}</div>`

/** 拼装完整文档。宽度由外层容器控制，截图时按 #card 的实际高度裁切 */
function document_(title: string, width: number, inner: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${STYLE}
html { width: ${width}px; }
</style>
</head>
<body><div id="card">${inner}</div></body>
</html>`
}

const stat = (value: string | number, label: string) =>
  `<div class="stat"><div class="stat-value">${escapeHtml(String(value))}</div>` +
  `<div class="stat-label">${escapeHtml(label)}</div></div>`

/** 一段高光对话：按发言人轮流左右排布，还原聊天气泡的观感 */
function renderDialogue(dialogue: HighlightDialogue): string {
  // 发言人首次出现的顺序决定左右，同一个人始终在同一侧
  const sides = new Map<string, number>()
  for (const line of dialogue.lines) {
    if (!sides.has(line.sender)) sides.set(line.sender, sides.size)
  }

  const turns = dialogue.lines.map((line) => {
    const name = line.sender || '匿名'
    const right = (sides.get(line.sender) ?? 0) % 2 === 1
    return `<div class="turn${right ? ' right' : ''}">` +
      `<div class="avatar" style="background:${avatarColor(name)}">${escapeHtml(initial(name))}</div>` +
      `<div class="bubble-wrap">` +
      `<div class="speaker">${escapeHtml(name)}</div>` +
      `<div class="bubble">${escapeHtml(line.content)}</div>` +
      `</div></div>`
  }).join('')

  const notes = [
    dialogue.academicPoint && `<div class="note"><span class="note-tag edu">学术要素</span>` +
      `<span>${escapeHtml(dialogue.academicPoint)}</span></div>`,
    dialogue.reason && `<div class="note"><span class="note-tag cold">冷在哪</span>` +
      `<span>${escapeHtml(dialogue.reason)}</span></div>`,
  ].filter(Boolean).join('')

  return `<div class="dialogue">` +
    (dialogue.title ? `<div class="dialogue-title">${escapeHtml(dialogue.title)}</div>` : '') +
    turns + notes + `</div>`
}

/** 群聊分析报告 → HTML */
export function renderReportHtml(result: GroupAnalysisResult, width: number): string {
  const parts: string[] = []

  parts.push(
    `<div class="banner">` +
    `<div class="banner-title">📊 群聊分析报告</div>` +
    `<div class="banner-sub">${escapeHtml(result.groupName)}</div>` +
    `<div class="banner-sub">${escapeHtml(result.timeRange)}</div>` +
    `</div>`,
  )

  parts.push(
    `<div class="stats">` +
    stat(result.totalMessages, '消息') +
    stat(result.totalParticipants, '参与者') +
    stat(result.totalChars, '总字数') +
    (result.mostActivePeriod ? stat(result.mostActivePeriod, '最活跃时段') : '') +
    `</div>`,
  )

  const inner: string[] = []

  const topics = result.topics.length
    ? result.topics.map((topic) => {
      const contributors = toArray(topic.contributors)
      return `<div class="topic">` +
        `<div class="topic-name">${escapeHtml(topic.topic)}</div>` +
        (topic.detail?.trim() ? `<div class="topic-detail">${escapeHtml(topic.detail.trim())}</div>` : '') +
        (contributors.length
          ? `<div class="chips">${contributors.map((name) => `<span class="chip">${escapeHtml(name)}</span>`).join('')}</div>`
          : '') +
        `</div>`
    }).join('')
    : `<div class="empty">暂无</div>`
  inner.push(section('💬 热门话题', topics))

  // 高光记录：对话与金句共用一个板块，各自带小标题
  const dialogues = result.highlights.filter((item) => item.kind === 'dialogue')
  const quotes = result.highlights.filter((item) => item.kind === 'quote')
  if (dialogues.length || quotes.length) {
    const blocks: string[] = []
    if (dialogues.length) {
      blocks.push(`<div class="subsection-title">🧊 高光对话</div>`)
      blocks.push(dialogues.map(renderDialogue).join(''))
    }
    if (quotes.length) {
      blocks.push(`<div class="subsection-title">💬 金句</div>`)
      blocks.push(quotes.map((quote) =>
        `<div class="quote">` +
        `<div class="quote-text">${escapeHtml(quote.content)}</div>` +
        `<div class="quote-meta">—— ${escapeHtml(quote.sender || '匿名')}</div>` +
        (quote.reason ? `<div class="quote-reason">${escapeHtml(quote.reason)}</div>` : '') +
        `</div>`).join(''))
    }
    inner.push(section('✨ 高光记录', blocks.join('')))
  }

  if (result.userStats.length) {
    // 条形长度相对榜首，最少留一点宽度免得看起来是空的
    const top = Math.max(...result.userStats.map((user) => user.messageCount), 1)
    const rows = result.userStats.map((user, index) => {
      const medal = index < 3 ? ` top${index + 1}` : ''
      const ratio = Math.max(4, Math.round((user.messageCount / top) * 100))
      return `<div class="rank">` +
        `<div class="rank-no${medal}">${index + 1}</div>` +
        `<div class="rank-main">` +
        `<div class="rank-head">` +
        `<span class="rank-name">${escapeHtml(user.username)}</span>` +
        `<span class="rank-num">${user.messageCount} 条 · 均 ${user.avgChars} 字</span>` +
        `</div>` +
        `<div class="rank-bar"><div class="rank-fill" style="width:${ratio}%"></div></div>` +
        `</div></div>`
    }).join('')
    inner.push(section('🔥 活跃榜', rows))
  }

  parts.push(`<div class="body">${inner.join('')}</div>`)
  parts.push(
    `<div class="footer"><span>${escapeHtml(result.groupName)}</span>` +
    `<span>共 ${result.totalMessages} 条消息</span></div>`,
  )

  return document_('群聊分析报告', width, parts.join(''))
}

/** 用户画像 → HTML */
export function renderPersonaHtml(
  persona: UserPersonaProfile,
  evidence: string[],
  avatar: string | undefined,
  width: number,
): string {
  const name = persona.username || persona.userId
  const parts: string[] = []

  // 头像取不到（或加载失败）时退回首字底色块，版面不会塌
  const avatarHtml = avatar
    ? `<img class="profile-avatar" src="${escapeHtml(avatar)}" alt="" ` +
      `onerror="this.replaceWith(Object.assign(document.createElement('div'),` +
      `{className:'profile-avatar',textContent:${JSON.stringify(initial(name))}}))">`
    : `<div class="profile-avatar">${escapeHtml(initial(name))}</div>`

  parts.push(
    `<div class="banner"><div class="profile">` +
    avatarHtml +
    `<div class="profile-meta">` +
    `<div class="banner-title">${escapeHtml(name)}</div>` +
    `<div class="banner-sub">用户画像 · ${escapeHtml(persona.userId)}</div>` +
    `</div></div></div>`,
  )

  const inner: string[] = []
  inner.push(section('📝 整体印象',
    `<div class="summary">${escapeHtml(persona.summary?.trim() || '（无总结）')}</div>`))

  const traits = toArray(persona.keyTraits)
  const interests = toArray(persona.interests)
  const style = persona.communicationStyle?.trim()
  if (traits.length || interests.length || style) {
    const fields: string[] = []
    if (traits.length) {
      fields.push(`<div class="field"><span class="field-label">🏷 性格特质</span>` +
        `<span class="field-value"><span class="chips">` +
        traits.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('') +
        `</span></span></div>`)
    }
    if (interests.length) {
      fields.push(`<div class="field"><span class="field-label">🎯 关注领域</span>` +
        `<span class="field-value"><span class="chips">` +
        interests.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('') +
        `</span></span></div>`)
    }
    if (style) {
      fields.push(`<div class="field"><span class="field-label">🗣 表达风格</span>` +
        `<span class="field-value">${escapeHtml(style)}</span></div>`)
    }
    inner.push(section('🔍 画像要点', fields.join('')))
  }

  if (evidence.length) {
    inner.push(section('📌 代表发言',
      evidence.map((quote) => `<div class="evidence">${escapeHtml(quote)}</div>`).join('')))
  }

  parts.push(`<div class="body">${inner.join('')}</div>`)
  parts.push(`<div class="footer"><span>${escapeHtml(name)}</span><span>用户画像</span></div>`)

  return document_(`用户画像 · ${name}`, width, parts.join(''))
}
