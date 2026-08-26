/**
 * 把分析结果渲染成用于截图的 HTML，纯函数，不依赖 Context。
 * 与 analysis/report.ts 的 markdown 渲染并行存在：同一份数据两种出口，
 * 开关关闭或 puppeteer 不可用时仍旧走 markdown。
 */
import type { DialogueDigest, GroupAnalysisResult, HighlightDialogue, UserPersonaProfile } from '../types'
import { STYLE } from './theme'
import { decodePlatformMarkup } from '../text'

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

/**
 * 记录里的图片占位符。recorder 把图片元素序列化成 `[图片](地址)`，
 * recordImages 关闭时只留 `[图片]`。
 */
const IMAGE_PATTERN = /\[图片\](?:\((https?:\/\/[^\s)]+)\))?/g

/** 只放行 http(s)，别的协议一律当没有地址处理 */
function safeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  return /^https?:\/\//i.test(url) ? url : undefined
}

/**
 * 一张消息图片。图片盖在「🖼 图片」小标签上，
 * 加载失败时 img 自我移除，:has() 失配，标签自动露出来——
 * 图链失效（QQ 的图片地址会过期）时不至于只剩一块空白。
 */
function imageTag(url: string | undefined): string {
  const safe = safeImageUrl(url)
  return `<span class="msg-img-wrap"><span class="msg-img-chip">🖼 图片</span>` +
    (safe ? `<img class="msg-img" src="${escapeHtml(safe)}" alt="" onerror="this.remove()">` : '') +
    `</span>`
}

/**
 * 渲染一条消息正文：文字转义，图片占位符换成真正的图片。
 * 不做这一步的话，群里发的图在报告里就是一行扎眼的 `[图片](https://...)` 原文。
 */
export function renderMessageContent(text: string): string {
  // 数据在入库和读取时都还原过一遍，这里再兜一道：模型可能把残标记原样抄回结果里
  const source = decodePlatformMarkup(text)
  const out: string[] = []
  let images: string[] = []

  // 连续的图片并成一个块级容器：图片留在文字行里会把行高撑得老高，
  // 前后的文字被挤成上下两截，读起来很难受
  const flushImages = () => {
    if (!images.length) return
    out.push(`<span class="msg-media">${images.join('')}</span>`)
    images = []
  }

  let last = 0
  for (const match of source.matchAll(IMAGE_PATTERN)) {
    const before = source.slice(last, match.index)
    if (before.trim()) {
      flushImages()
      out.push(escapeHtml(before.trim()))
    }
    images.push(imageTag(match[1]))
    last = match.index + match[0].length
  }
  flushImages()

  const tail = source.slice(last)
  if (tail.trim()) out.push(escapeHtml(tail.trim()))
  return out.join('')
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

/**
 * 头像元素：底层永远是首字色块，图片盖在上面。
 * 图挂了就 this.remove() 露出底下的字——比在 onerror 里拼一段构造 DOM 的
 * JS 稳妥得多，那种写法里的引号会把 HTML 属性提前截断。
 */
function avatarTag(name: string, url: string | undefined, className: string): string {
  const image = url
    ? `<img class="avatar-img" src="${escapeHtml(url)}" alt="" onerror="this.remove()">`
    : ''
  return `<div class="${className}" style="background:${avatarColor(name)}">` +
    `${escapeHtml(initial(name))}${image}</div>`
}

/**
 * 一个分节。keep=true 表示不允许跨列拆开——
 * 排行榜拆了序号会断在两列，画像要点拆了会有孤立小节落在右列顶端、头上没有标题。
 * 篇幅可能很大的分节（高光记录）必须留着可拆，否则两列没法平衡。
 */
const section = (title: string, inner: string, keep = false) =>
  `<div class="section${keep ? ' keep' : ''}"><div class="section-title">${title}</div>${inner}</div>`

/** 低于这个宽度就不分栏——每列不足 400px 时对话气泡会挤得没法读 */
const TWO_COLUMN_MIN_WIDTH = 820

/**
 * 板块内部的分栏容器。
 * 列数取「板块上限」和「实际条目数」的较小值——两条内容排三列会空出一列，
 * 一条内容排两列会空出一半。画布不够宽时一律退回单列，
 * 每列不足 400px 时卡片里的文字会挤得没法读。
 */
function group(inner: string, count: number, maxColumns: 1 | 2 | 3, width: number): string {
  const columns = width >= TWO_COLUMN_MIN_WIDTH
    ? Math.max(1, Math.min(maxColumns, count))
    : 1
  return `<div class="group${columns > 1 ? ` cols-${columns}` : ''}">${inner}</div>`
}

/**
 * 页面级两列（仅用户画像用）：分节整块地灌进两列。
 * 群分析不走这条——它的列数是逐板块指定的。
 */
function layout(width: number, sections: string[]): string {
  const present = sections.filter(Boolean)
  const twoColumn = width >= TWO_COLUMN_MIN_WIDTH && present.length > 1
  return `<div class="body${twoColumn ? ' columns' : ''}">${present.join('')}</div>`
}

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

/** 一段高光对话：逐轮自上而下，气泡一律靠左，发言人靠头像与名字区分 */
function renderDialogue(dialogue: HighlightDialogue): string {
  const turns = dialogue.lines.map((line) => {
    const name = line.sender || '匿名'
    return `<div class="turn">` +
      avatarTag(name, line.avatar, 'avatar') +
      `<div class="bubble-wrap">` +
      `<div class="speaker">${escapeHtml(name)}</div>` +
      `<div class="bubble">${renderMessageContent(line.content)}</div>` +
      `</div></div>`
  }).join('')

  const notes = [
    dialogue.reason && `<div class="note"><span class="note-tag cold">入选原因</span>` +
    `<span>${escapeHtml(dialogue.reason)}</span></div>`,
  ].filter(Boolean).join('')

  return `<div class="dialogue">` +
    (dialogue.title ? `<div class="dialogue-title">${escapeHtml(dialogue.title)}</div>` : '') +
    turns + notes + `</div>`
}

/** 柱形区的像素高度。用绝对值而非百分比：列高会被上下的标签撑开，百分比算不准 */
const CHART_HEIGHT = 110

/** 24 小时发言量柱状图 */
function renderHourly(hourly: number[], totalMessages: number): string {
  const peak = Math.max(...hourly)
  // 全零时不画图，一排贴地的柱子没有信息量
  if (!peak) return `<div class="empty">暂无足够数据</div>`

  const peakHour = hourly.indexOf(peak)
  const bars = hourly.map((count, hour) => {
    // 有发言的整点至少留 3px，否则「1 条」和「没有」看起来一样
    const height = count ? Math.max(3, Math.round((count / peak) * CHART_HEIGHT)) : 0
    const classes = ['chart-col']
    if (hour === peakHour) classes.push('peak')
    if (hour < 6) classes.push('night')
    return `<div class="${classes.join(' ')}">` +
      `<div class="chart-value">${count || ''}</div>` +
      `<div class="chart-bar" style="height:${height}px"></div>` +
      `<div class="chart-hour">${hour}</div>` +
      `</div>`
  }).join('')

  const night = hourly.slice(0, 6).reduce((sum, count) => sum + count, 0)
  const nightRatio = totalMessages ? Math.round((night / totalMessages) * 100) : 0
  return `<div class="chart">${bars}</div>` +
    `<div class="chart-foot">` +
    `<span>最闹的一小时 ${String(peakHour).padStart(2, '0')}:00（${peak} 条）</span>` +
    `<span>深夜 00–06 点占 ${nightRatio}%</span>` +
    `</div>`
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

  const topicCards = result.topics.length
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
    : ''
  // 话题与活跃榜是群分析的常规板块，一律两列
  const topics = topicCards
    ? group(topicCards, result.topics.length, 2, width)
    : `<div class="empty">暂无</div>`

  // 金句：多列，金句短，一行一句太浪费横向空间
  const quotesHtml = result.quotes.length
    ? section('✨ 金句', group(result.quotes.map((quote) =>
      `<div class="quote">` +
      `<div class="quote-text">${renderMessageContent(quote.content)}</div>` +
      `<div class="quote-meta">—— ${escapeHtml(quote.sender || '匿名')}</div>` +
      (quote.reason ? `<div class="quote-reason">${escapeHtml(quote.reason)}</div>` : '') +
      `</div>`).join(''), result.quotes.length, 3, width))
    : ''

  let ranksHtml = ''
  if (result.userStats.length) {
    // 条形长度相对榜首，最少留一点宽度免得看起来是空的
    const top = Math.max(...result.userStats.map((user) => user.messageCount), 1)
    const rows = result.userStats.map((user, index) => {
      const medal = index < 3 ? ` top${index + 1}` : ''
      const ratio = Math.max(4, Math.round((user.messageCount / top) * 100))
      return `<div class="rank">` +
        `<div class="rank-no${medal}">${index + 1}</div>` +
        avatarTag(user.username, user.avatar, 'rank-avatar') +
        `<div class="rank-main">` +
        `<div class="rank-head">` +
        `<span class="rank-name">${escapeHtml(user.username)}</span>` +
        `<span class="rank-num">${user.messageCount} 条 · 均 ${user.avgChars} 字</span>` +
        `</div>` +
        `<div class="rank-bar"><div class="rank-fill" style="width:${ratio}%"></div></div>` +
        `</div></div>`
    }).join('')
    ranksHtml = section('🔥 活跃榜', group(rows, result.userStats.length, 2, width))
  }

  // 分节通栏纵向堆叠，分栏发生在各板块内部
  parts.push(`<div class="body">${[
    section('💬 热门话题', topics),
    quotesHtml,
    ranksHtml,
    // 活跃时段固定压在报告最底部
    section('🕓 活跃时段', renderHourly(result.hourly ?? [], result.totalMessages)),
  ].filter(Boolean).join('')}</div>`)
  parts.push(
    `<div class="footer"><span>${escapeHtml(result.groupName)}</span>` +
    `<span>共 ${result.totalMessages} 条消息</span></div>`,
  )

  return document_('群聊分析报告', width, parts.join(''))
}

/** 高光对话 → HTML。单列通栏：聊天气泡要靠宽度才排得开 */
export function renderDialoguesHtml(digest: DialogueDigest, width: number): string {
  const parts: string[] = []

  parts.push(
    `<div class="banner">` +
    `<div class="banner-title">🧊 高光对话</div>` +
    `<div class="banner-sub">${escapeHtml(digest.groupName)}</div>` +
    `<div class="banner-sub">${escapeHtml(digest.timeRange)}</div>` +
    `</div>`,
  )

  const body = digest.dialogues.length
    ? group(digest.dialogues.map(renderDialogue).join(''), digest.dialogues.length, 1, width)
    : `<div class="empty">这段时间没有找到符合条件的对话。</div>`
  parts.push(`<div class="body"><div class="section">${body}</div></div>`)

  parts.push(
    `<div class="footer"><span>${escapeHtml(digest.groupName)}</span>` +
    `<span>${digest.dialogues.length} 段 · 取自 ${digest.totalMessages} 条消息</span></div>`,
  )

  return document_('高光对话', width, parts.join(''))
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

  parts.push(
    `<div class="banner"><div class="profile">` +
    avatarTag(name, avatar, 'profile-avatar') +
    `<div class="profile-meta">` +
    `<div class="banner-title">${escapeHtml(name)}</div>` +
    `<div class="banner-sub">用户画像 · ${escapeHtml(persona.userId)}</div>` +
    `</div></div></div>`,
  )

  const summaryHtml = section('📝 整体印象',
    `<div class="summary">${escapeHtml(persona.summary?.trim() || '（无总结）')}</div>`, true)

  let pointsHtml = ''
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
    pointsHtml = section('🔍 画像要点', fields.join(''), true)
  }

  const evidenceHtml = evidence.length
    ? section('📌 代表发言',
      evidence.map((quote) => `<div class="evidence">${renderMessageContent(quote)}</div>`).join(''))
    : ''

  parts.push(layout(width, [summaryHtml, pointsHtml, evidenceHtml]))
  parts.push(`<div class="footer"><span>${escapeHtml(name)}</span><span>用户画像</span></div>`)

  return document_(`用户画像 · ${name}`, width, parts.join(''))
}
