/**
 * 把分析结果渲染成用于截图的 HTML，纯函数，不依赖 Context。
 * 与 analysis/report.ts 的 markdown 渲染并行存在：同一份数据两种出口，
 * 开关关闭或 puppeteer 不可用时仍旧走 markdown。
 *
 * 版面文案里不要写 emoji。截图跑在 puppeteer 里，字体栈全是系统字体，
 * 服务器上的 Linux 常常没装 Noto Color Emoji，标题上的图标会直接变成方框
 * ——markdown 那条出口不受影响，emoji 由聊天客户端自己渲染，那边照旧用。
 * 用户内容里的 emoji 是数据，原样透传，这条只约束模板自己写死的字符。
 */
import type { DialogueDigest, GroupAnalysisResult, HighlightDialogue, ResolvedHighlightLine, UserPersonaProfile } from '../types'
import {
  DIALOGUES_THEME, PERSONA_THEME, REPORT_THEME,
  resolveDocument, type RenderStyleConfig,
} from './theme'
import { cleanContent } from '../text'

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
 * 记录里的媒体占位符：`[图片](地址)` 与 `[视频](地址)`，
 * recordImages 关闭时（或平台没给地址）只剩 `[图片]` `[视频]`。
 * 语音、文件不在这里——它们没什么可展示的，当普通文字排就够了。
 */
const MEDIA_PATTERN = /\[(图片|视频)\](?:\((https?:\/\/[^\s)]+)\))?/g

/**
 * 正文里的提及：`[@张三]`，认不出是谁时是 `[@某人]`。
 * 名字连着 @ 一起包在方括号里（入库时就这么存的），边界才咬得死——
 * 群里「@张三你看看」这种紧接着说下去的写法很常见，没有收尾的方括号就断不出名字。
 */
const MENTION_PATTERN = /\[@([^\][\n]*)\]/g

/** 一次提及排成一枚淡靛标签：一眼看出这是冲谁说的，而不是正文里顺口打的一个 @ */
function mentionTag(name: string): string {
  return `<span class="msg-at">@${escapeHtml(name)}</span>`
}

/** 只放行 http(s)，别的协议一律当没有地址处理 */
function safeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  return /^https?:\/\//i.test(url) ? url : undefined
}

/**
 * 一张消息图片。图片盖在「图片」小标签上，
 * 加载失败时 img 自我移除，:has() 失配，标签自动露出来——
 * 图链失效（QQ 的图片地址会过期）时不至于只剩一块空白。
 */
function imageTag(url: string | undefined): string {
  const safe = safeImageUrl(url)
  return `<span class="msg-img-wrap"><span class="msg-img-chip">图片</span>` +
    (safe ? `<img class="msg-img" src="${escapeHtml(safe)}" alt="" onerror="this.remove()">` : '') +
    `</span>`
}

/**
 * 一段视频，画成一块带播放标记的占位块。
 *
 * 不放 `<video>`：截图跑在 puppeteer 里，视频既不解码也不会停在第一帧，
 * 拿到的就是一块黑；QQ 的地址还几分钟就过期，等于给报告留一块必然失效的空白。
 * 播放三角用 CSS 边框画，不靠字体——`▶` 这类字符在没装 emoji 字体的机器上会变方框。
 * 地址照旧留在记录里，只是不参与渲染。
 */
function videoTag(): string {
  return `<span class="msg-video"><span class="msg-video-play"></span>视频</span>`
}

/** 一个媒体占位符 → 一块可视的东西 */
function mediaTag(kind: string, url: string | undefined): string {
  return kind === '视频' ? videoTag() : imageTag(url)
}

/**
 * 正文首行的引用预览。recorder 把被引用的那条消息压成 `[引用 张三] 原话`，
 * 昵称与原话都可能缺席（关掉 recordQuotes 时只剩一个 `[引用]`）。
 * 只认行首：正文里顺口提到的「[引用]」字样不该被当成引用条。
 */
const QUOTE_PATTERN = /^\[引用(?: ([^\]]*))?\](?:[ \t]*([^\n]*))?(?:\n|$)/

/** 引用条：被回复的那句压成一条窄带，浮在正文上方 */
function quoteBar(name: string, text: string): string {
  const inner = (name ? `<span class="msg-quote-name">${escapeHtml(name)}</span>` : '') +
    // 预览里的 `[图片]` 之类占位符照常走正文渲染，只是没有图链，落成一个小标签
    (text ? `<span class="msg-quote-text">${renderInline(text)}</span>` : '')
  // 两者都缺（recordQuotes 关着）时也要留下痕迹：这句话确实是回复别人的
  return `<div class="msg-quote">${inner || `<span class="msg-quote-text">引用</span>`}</div>`
}

/**
 * 合并转发。text.ts 已经把平台那一大块排版文本压成了标题 + 一行一句：
 *
 *     [群聊的聊天记录]
 *     张三: 你好
 *     李四: hello
 *
 * 卡片一开就排到消息末尾，前面可能还有别的正文（`@某人 看这个` 之类），那截照常渲染。
 */
const FORWARD_PATTERN = /(?:^|\n)\[([^\]\n]*聊天记录)\]\n([\s\S]+)$/

/** 卡片里最多列几条。转发几十条的截图会长得没法看，剩下的折成一行计数 */
const FORWARD_MAX_ROWS = 8

/** 一条转发记录的行首 `昵称: `。昵称不含冒号，长度与入库时的上限一致 */
const FORWARD_SENDER = /^([^\s:：][^:：]{0,23})[:：][ \t]*(.*)$/

/**
 * 被折叠掉的里层记录：`[群聊的聊天记录 4 条]`。
 * 转发是可以套娃的，里层的内容在入库时就没往下收（见 text.ts），
 * 这里只把这个标题排成一枚标签，跟正文区分开。
 */
const FORWARD_NESTED = /^\[([^\]\n]*聊天记录)(?:[ \t]+(\d+)[ \t]*条)?\]$/

/** 把压平后的卡片正文拆回逐条。缩进的行是上一条的续行，入库时就是这么排的 */
function forwardEntries(block: string): { sender: string, content: string }[] {
  const entries: { sender: string, content: string }[] = []
  for (const line of block.split('\n')) {
    if (!line.trim()) continue
    if (/^\s/.test(line) && entries.length) {
      entries[entries.length - 1].content += `\n${line.trim()}`
      continue
    }
    const sender = FORWARD_SENDER.exec(line)
    entries.push(sender
      ? { sender: sender[1], content: sender[2] }
      : { sender: '', content: line.trim() })
  }
  return entries
}

/**
 * 一张转发卡片。名字与内容分成两列对齐——转发的都是别人说的话，
 * 一行一句、名字对齐才看得出这是一段记录，而不是本人一口气说了这么多。
 */
function forwardCard(title: string, block: string): string {
  const entries = forwardEntries(block)
  if (!entries.length) return renderInline(`[${title}]\n${block}`)

  // 名字与正文直接铺进卡片这张两列网格，不套行容器——
  // 套了每行各自成格，名字列就按各行自己的宽度走，对不齐
  const rows = entries.slice(0, FORWARD_MAX_ROWS).map((entry) => {
    const nested = FORWARD_NESTED.exec(entry.content)
    const text = nested
      ? `<span class="msg-fwd-nested">${escapeHtml(nested[1])}` +
      (nested[2] ? ` · ${nested[2]} 条` : '') + `</span>`
      : renderInline(entry.content)
    return `<span class="msg-fwd-name">${escapeHtml(entry.sender || '匿名')}</span>` +
      `<span class="msg-fwd-text">${text}</span>`
  }).join('')
  const rest = entries.length - FORWARD_MAX_ROWS
  return `<div class="msg-fwd">` +
    `<div class="msg-fwd-head">${escapeHtml(title)} · ${entries.length} 条</div>` +
    rows +
    (rest > 0 ? `<div class="msg-fwd-more">还有 ${rest} 条</div>` : '') +
    `</div>`
}

/**
 * 渲染一条消息正文：文字转义，图片占位符换成真正的图片，
 * 引用与合并转发各自成块。
 * 不做这一步的话，群里发的图在报告里就是一行扎眼的 `[图片](https://...)` 原文。
 */
export function renderMessageContent(text: string): string {
  // 数据在入库和读取时都清过一遍，这里再兜一道：模型可能把残标记原样抄回结果里
  const source = cleanContent(text)
  const quote = source.match(QUOTE_PATTERN)
  if (!quote) return renderBody(source)
  return quoteBar(quote[1]?.trim() ?? '', quote[2]?.trim() ?? '') +
    renderBody(source.slice(quote[0].length))
}

/** 引用条之后的正文：带转发卡片就把卡片单独画出来，其余按普通正文排 */
function renderBody(source: string): string {
  const forward = source.match(FORWARD_PATTERN)
  if (!forward) return renderInline(source)
  return renderInline(source.slice(0, forward.index)) + forwardCard(forward[1], forward[2])
}

/**
 * 一段纯文字：转义之外，把提及换成标签。
 *
 * 单开一趟扫提及、而不是并进下面那条媒体正则，是因为媒体占位符自成块级一行、
 * 前后的空白是噪音要 trim 掉，提及却是行内的——`[@张三] 你好` 一并 trim
 * 就成了「@张三你好」，把人家原本打的那个空格吃了。
 */
function renderText(text: string): string {
  const out: string[] = []
  let last = 0
  for (const match of text.matchAll(MENTION_PATTERN)) {
    out.push(escapeHtml(text.slice(last, match.index)), mentionTag(match[1]))
    last = match.index + match[0].length
  }
  out.push(escapeHtml(text.slice(last)))
  return out.join('')
}

/** 正文本体：转义文字，把图片占位符换成图片、把提及换成标签 */
function renderInline(source: string): string {
  const out: string[] = []
  let images: string[] = []

  // 连续的图片、视频并成一个块级容器：媒体块留在文字行里会把行高撑得老高，
  // 前后的文字被挤成上下两截，读起来很难受
  const flushImages = () => {
    if (!images.length) return
    out.push(`<span class="msg-media">${images.join('')}</span>`)
    images = []
  }

  let last = 0
  for (const match of source.matchAll(MEDIA_PATTERN)) {
    const before = source.slice(last, match.index)
    if (before.trim()) {
      flushImages()
      out.push(renderText(before.trim()))
    }
    images.push(mediaTag(match[1], match[2]))
    last = match.index + match[0].length
  }
  flushImages()

  const tail = source.slice(last)
  if (tail.trim()) out.push(renderText(tail.trim()))
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
 * 篇幅可能很大的分节（高光对话）必须留着可拆，否则两列没法平衡。
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
 * 页面级两列（仅用户画像用）：分节整块地灌进两列，容器由模板给。
 * 群分析不走这条——它的列数是逐板块指定的。
 * 只有一个分节时不分栏：两列里空着一列还不如老老实实通栏。
 */
function columnsClass(width: number, sections: string[]): string {
  return width >= TWO_COLUMN_MIN_WIDTH && sections.filter(Boolean).length > 1
    ? 'columns'
    : ''
}

const stat = (value: string | number, label: string) =>
  `<div class="stat"><div class="stat-value">${escapeHtml(String(value))}</div>` +
  `<div class="stat-label">${escapeHtml(label)}</div></div>`

/** 一段高光对话：逐轮自上而下，气泡一律靠左，发言人靠头像与名字区分 */
function renderDialogue(dialogue: HighlightDialogue<ResolvedHighlightLine>): string {
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

/** 群聊分析报告 → HTML。板块各自渲染，位置由 REPORT_TEMPLATE 决定 */
export function renderReportHtml(result: GroupAnalysisResult, config: RenderStyleConfig): string {
  const width = config.imageWidth

  const stats = stat(result.totalMessages, '消息') +
    stat(result.totalParticipants, '参与者') +
    stat(result.totalChars, '总字数') +
    (result.mostActivePeriod ? stat(result.mostActivePeriod, '最活跃时段') : '')

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
    ? section('金句', group(result.quotes.map((quote) =>
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
    ranksHtml = section('活跃榜', group(rows, result.userStats.length, 2, width))
  }

  return resolveDocument(config, REPORT_THEME(config), {
    title: escapeHtml('群聊分析报告'),
    groupName: escapeHtml(result.groupName),
    timeRange: escapeHtml(result.timeRange),
    totalMessages: String(result.totalMessages),
    totalParticipants: String(result.totalParticipants),
    totalChars: String(result.totalChars),
    mostActivePeriod: escapeHtml(result.mostActivePeriod ?? ''),
    stats,
    topics: section('热门话题', topics),
    quotes: quotesHtml,
    ranks: ranksHtml,
    hourly: section('活跃时段', renderHourly(result.hourly ?? [], result.totalMessages)),
  })
}

/** 高光对话 → HTML。单列通栏：聊天气泡要靠宽度才排得开 */
export function renderDialoguesHtml(digest: DialogueDigest<ResolvedHighlightLine>, config: RenderStyleConfig): string {
  const dialogues = digest.dialogues.length
    ? group(digest.dialogues.map(renderDialogue).join(''), digest.dialogues.length, 1, config.imageWidth)
    : `<div class="empty">这段时间没有找到符合条件的对话。</div>`

  return resolveDocument(config, DIALOGUES_THEME(config), {
    title: escapeHtml('高光对话'),
    groupName: escapeHtml(digest.groupName),
    timeRange: escapeHtml(digest.timeRange),
    count: String(digest.dialogues.length),
    totalMessages: String(digest.totalMessages),
    dialogues,
  })
}

/** 用户画像 → HTML */
export function renderPersonaHtml(
  persona: UserPersonaProfile,
  evidence: string[],
  avatar: string | undefined,
  config: RenderStyleConfig,
): string {
  const name = persona.username || persona.userId

  const summaryHtml = section('整体印象',
    `<div class="summary">${escapeHtml(persona.summary?.trim() || '（无总结）')}</div>`, true)

  let pointsHtml = ''
  const traits = toArray(persona.keyTraits)
  const interests = toArray(persona.interests)
  const style = persona.communicationStyle?.trim()
  if (traits.length || interests.length || style) {
    const fields: string[] = []
    if (traits.length) {
      fields.push(`<div class="field"><span class="field-label">性格特质</span>` +
        `<span class="field-value"><span class="chips">` +
        traits.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('') +
        `</span></span></div>`)
    }
    if (interests.length) {
      fields.push(`<div class="field"><span class="field-label">关注领域</span>` +
        `<span class="field-value"><span class="chips">` +
        interests.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('') +
        `</span></span></div>`)
    }
    if (style) {
      fields.push(`<div class="field"><span class="field-label">表达风格</span>` +
        `<span class="field-value">${escapeHtml(style)}</span></div>`)
    }
    pointsHtml = section('画像要点', fields.join(''), true)
  }

  const evidenceHtml = evidence.length
    ? section('代表发言',
      evidence.map((quote) => `<div class="evidence">${renderMessageContent(quote)}</div>`).join(''))
    : ''

  return resolveDocument(config, PERSONA_THEME(config), {
    title: escapeHtml(`用户画像 · ${name}`),
    name: escapeHtml(name),
    userId: escapeHtml(persona.userId),
    avatar: avatarTag(name, avatar, 'profile-avatar'),
    columns: columnsClass(config.imageWidth, [summaryHtml, pointsHtml, evidenceHtml]),
    summary: summaryHtml,
    points: pointsHtml,
    evidence: evidenceHtml,
  })
}
