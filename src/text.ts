/**
 * 记录文本的清洗。不依赖任何服务，纯函数。
 */
import { layoutRecord } from './transcript'

/**
 * 平台塞在正文里、适配器没能解析掉的内联表情标记。
 *
 * QQ 的表情在正文里长这样：
 *
 *     <faceType=4,faceId="",ext="eyJ0ZXh0IjoiW+Wuieivpl0ifQ==">
 *
 * `ext` 是一段 base64，解出来是 `{"text":"[安详]"}`——正是这个表情在 QQ 里
 * 显示的名字。官方适配器会把它拆成 emoji 元素，但 adapter-qq-crack 直接把
 * 整段 content 塞进一个文本元素，标记就原样留在正文里了。
 *
 * 属性写法不固定（还有缺 faceId/ext 的简写 `<faceType=6>`），
 * 所以只锁定 faceType 本身，剩下的属性整段捕下来再单独取 ext。
 * 两侧的空格一并吃掉：标记整个删掉时，它左右的空格会并成一处。
 */
const PLATFORM_FACE = /([ \t]*)<faceType=(\d+)((?:,[^>]*)?)>([ \t]*)/g

/** 从属性串里取出 ext 的 base64 */
const FACE_EXT = /(?:^|,)ext="([^"]*)"/

/**
 * 动画表情 / 超级 QQ 秀 / GIF 表情。
 * 图本身在 attachments 里，适配器已经单独给过一个图片元素，
 * 这里再还原一次就成了重复的两份，所以只把标记删掉。
 */
const FACE_TYPE_IMAGE = 6

/** 解出表情名。ext 不是预期的 base64 JSON 时返回空串，交给调用方按「删掉」处理 */
function decodeFaceName(ext: string | undefined): string {
  if (!ext) return ''
  try {
    const { text } = JSON.parse(Buffer.from(ext, 'base64').toString('utf8')) ?? {}
    return typeof text === 'string' ? text.trim() : ''
  } catch {
    return ''
  }
}

/** 统一成 QQ 里看到的样子：`[安详]`。名字自带方括号时不再套一层 */
export function faceToken(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  return /^\[.*\]$/.test(trimmed) ? trimmed : `[${trimmed}]`
}

/**
 * 把平台残留的内联标记还原成可读文本：表情还原成 `[安详]` 这样的名字，
 * 还原不出名字的（图片类表情、缺 ext 的简写）直接去掉。
 *
 * 早先这里是一律删掉的——当时以为表情都已经被适配器换成了图片元素，
 * 残标记纯属噪音。实际上只有 faceType=6 是这样，小黄脸、超级表情、
 * 表情商城那几类的内容全在 ext 里，删掉就等于把这句话说了什么弄丢了。
 */
export function decodePlatformMarkup(text: string | undefined | null): string {
  const source = String(text ?? '')
  if (!source.includes('<faceType')) return source
  return source.replace(PLATFORM_FACE, (_, before: string, type: string, attrs: string, after: string) => {
    const token = Number(type) === FACE_TYPE_IMAGE
      ? ''
      : faceToken(decodeFaceName(attrs.match(FACE_EXT)?.[1]))
    if (token) return `${before}${token}${after}`
    // 标记本来就贴着字的，不要凭空插出一个空格
    return before && after ? ' ' : ''
  }).trim()
}

/**
 * QQ 的「合并转发」到了适配器手里不是结构化数据，而是平台自己排好版的一整块文本。
 * 纯文字的转发长这样：
 *
 *     [群聊的聊天记录]
 *     === 消息 1 ===
 *     [消息内容] 你好
 *     [发送者] 张三
 *
 * 带图的那条则没有 `[消息内容]`，图挂在 `[附件N]` 上，字段顺序也反过来：
 *
 *     === 消息 2 ===
 *     [发送者] 李四
 *     [附件1] 类型:图片 文件名:x.jpg 尺寸:1920x864 大小:72.2KB URL:https://…
 *
 * 一条转发四五行里只有一两行是人说的话，剩下全是排版噪音：喂给模型是白烧 token，
 * 出图是一堆 `=== 消息 N ===` 和文件名尺寸糊在气泡里，发文字更惨——markdown 出口
 * 会把换行压成空格，整块挤成一长条。
 *
 * 转发还能套娃——里头的某一条本身又是一整份聊天记录，里层用另一种分隔行（`--- 第N条 ---`）。
 *
 * 所以入库前就把它压成一行一句的样子，谁说的写在前面，附件换成正文里通用的占位符，
 * 套进去的那份记录只留一个缩略标题：
 *
 *     [群聊的聊天记录]
 *     张三: 你好
 *     李四: [图片](https://…)
 *     王五: [群聊的聊天记录 4 条]
 *
 * 外层的原话一个字不动，只是把排版行去掉、把发送者提到前面。
 */

/** 卡片标题行。平台会区分「群聊的聊天记录」和「聊天记录」，原样留着 */
const FORWARD_HEADER = /^[ \t]*\[([^\]\n]*聊天记录)\][ \t]*$/

/**
 * 逐条之间的分隔行，两种样式：`=== 消息 1 ===` 和 `--- 第1条 ---`。
 *
 * 转发是可以套娃的——转发里的某一条本身又是一整份聊天记录。这时两种样式各管一层：
 * 先出现的那种是外层，另一种就是里层。所以这里不写死谁是外层，
 * 由 `pickSeparators` 按出场顺序当场认——不然一份套娃转发会被里层的分隔行
 * 切得七零八落，里层的十几张图全平铺到外层列表里，套了几层根本看不出来。
 *
 * 括号里捕的是序号，用来估里层有多少条。
 */
const FORWARD_SEPARATOR_STYLES = [
  /^[ \t]*={2,}[ \t]*消息[ \t]*(\d+)[ \t]*={2,}[ \t]*$/,
  /^[ \t]*-{2,}[ \t]*第[ \t]*(\d+)[ \t]*条[ \t]*-{2,}[ \t]*$/,
]

/** 任一样式的分隔行 */
const isSeparator = (line: string) => FORWARD_SEPARATOR_STYLES.some((style) => style.test(line))

/**
 * 按出场顺序定下哪种样式是外层。
 * 只用到一种样式（绝大多数转发）时里层为空，什么都不会被折叠。
 */
function pickSeparators(lines: string[]): { outer: RegExp, inner?: RegExp } {
  for (const line of lines) {
    const index = FORWARD_SEPARATOR_STYLES.findIndex((style) => style.test(line))
    if (index >= 0) {
      return { outer: FORWARD_SEPARATOR_STYLES[index], inner: FORWARD_SEPARATOR_STYLES[1 - index] }
    }
  }
  return { outer: FORWARD_SEPARATOR_STYLES[0] }
}

/**
 * 条目里的字段标签。只认这几个已知的：
 * 转发的正文里出现 `[图片]` `[表情]` 是常事，按通配的 `[标签]` 认字段会把正文吃掉。
 */
const FORWARD_FIELD = /^[ \t]*\[(消息内容|发送者|发送时间|消息类型|关联消息|附件\d*)\][ \t]*(.*)$/

/** 有没有必要往下解析。行首出现已知标签才算，正文里提到「[发送者]」不作数 */
const FORWARD_MARKER = /^[ \t]*\[(?:消息内容|发送者|发送时间|消息类型|关联消息|附件\d*)\]/m

/** 附件行里的元数据：`类型:图片 文件名:x.jpg 尺寸:1920x864 大小:72.2KB URL:https://…` */
const ATTACHMENT_TYPE = /(?:^|\s)类型[:：][ \t]*(\S+)/
const ATTACHMENT_URL = /(?:^|\s)URL[:：][ \t]*(\S+)/

/** 转发卡片里的附件类型 → 正文里的占位符，用的是元素序列化那边同一套词 */
const ATTACHMENT_TOKENS: Record<string, string> = {
  图片: '图片',
  视频: '视频',
  语音: '语音',
  音频: '语音',
  文件: '文件',
}

/** 带地址的两类。图片出图时能换成真图；视频画一枚播放占位块，地址只作留存 */
const MEDIA_WITH_URL = new Set(['图片', '视频'])

/**
 * 正文里的媒体占位符：`[图片](地址)` / `[视频](地址)` / `[语音]` / `[文件]`。
 * 一处定义，元素序列化、转发卡片、原始附件三条来路共用，免得同一个视频
 * 一边存成 `[视频]`、一边存成 `[video]`，渲染那头还得认两套。
 */
export function mediaToken(kind: string, url?: string, keepUrl = true): string {
  return keepUrl && url && MEDIA_WITH_URL.has(kind) ? `[${kind}](${url})` : `[${kind}]`
}

/**
 * MIME → 占位符类型。QQ 下发的附件带的是 `image/jpeg`、`video/mp4` 这样的 MIME，
 * 也见过 `file` / `voice` 这类光秃秃的词，两种都认。认不出的一律算文件。
 */
export function mediaKind(mime: string | undefined): string {
  const type = String(mime ?? '').toLowerCase()
  if (type.startsWith('image')) return '图片'
  if (type.startsWith('video')) return '视频'
  if (type.startsWith('audio') || type === 'voice') return '语音'
  return '文件'
}

/** @全体成员。QQ 客户端上就显示这四个字，这里跟着叫，免得报告里冒出一个 `everyone` */
export const AT_ALL_NAME = '全体成员'

/** 认不出被 @ 的是谁时的兜底称呼 */
const AT_UNKNOWN_NAME = '某人'

/** 昵称的字数上限，与引用预览同理：名字占满一行就把话挤没了 */
const AT_NAME_LIMIT = 24

/** 会破掉 `[@昵称]` 这对方括号边界的字符 */
const AT_NAME_BREAKERS = /[[\]\r\n]/g

/**
 * 一次提及：`[@张三]`。
 *
 * 名字**连着 @ 一起包在方括号里**，跟 `[引用 张三]` 是同一个道理——渲染那边要断得出边界。
 * 只写 `@张三` 的话，遇上「@张三你看看」这种紧接着说下去的（群里最常见的写法）
 * 就分不清哪一截是名字：@ 后面没有收尾符号，名字有多长全靠猜。
 *
 * 认不出是谁时退成 `[@某人]`，而不是把 ID 填进去：QQ 给的是三十多位的 openid，
 * 摆在正文里既不是人话，出图时还能撑破一行；而且它和记录里的昵称对不上，
 * 模型拿它也接不到任何一个人身上，纯是白烧 token。
 */
export function atToken(name: string | undefined | null): string {
  const trimmed = String(name ?? '').replace(AT_NAME_BREAKERS, ' ').trim()
  return `[@${trimmed.slice(0, AT_NAME_LIMIT).trim() || AT_UNKNOWN_NAME}]`
}

/**
 * 历史记录里的 `[at]`。
 *
 * at 元素早先没人认，落到序列化的兜底分支里，存下来就只剩一个元素类型名——
 * 提的是谁没了不说，`[at]` 这三个字母混在中文正文里，模型也读不出它是一次提及。
 * 读取时就地换成统一的形态，历史记录跟着一起对齐（新记录走的是 `atToken`，
 * 这里再跑一遍是空转）。
 *
 * 两侧贴着字母、数字、点号时不认：`zhang[at]qq.com` 是群里躲爬虫的邮箱写法，
 * 不是一次提及，换掉就把人家的邮箱改了。真正的提及总是独立成词——
 * 后面跟着空格或中文，前面要么是行首、要么是另一个 `[at]`。
 */
const LEGACY_AT = /(?<![\w.-])\[at\](?![\w.-])/g

/** 发送者昵称的字数上限，与引用预览同理：名字占满一行就把话挤没了 */
const FORWARD_NAME_LIMIT = 24

/** 整条正文就是一个记录标题——套娃转发的那一条长这样 */
const NESTED_TITLE = /^\[([^\]\n]*聊天记录)\]$/

interface ForwardEntry {
  sender: string
  content: string
}

/** 切好的一条，加上它里层记录的条数（0 表示这条不是套娃） */
interface ForwardBlock {
  lines: string[]
  nested: number
}

/** 一个字段：标签加它底下的行。标签为空的那个是打头的无标签正文 */
interface ForwardField {
  label: string
  lines: string[]
}

/**
 * 把附件行压成一个占位符。
 * 只有图片和视频带上地址，语音、文件给了地址也渲染不出来，
 * 白白在正文里留一串两百多字符的 URL。文件名、尺寸、大小一律丢掉：
 * 这些是卡片上的装饰，不是谁说的话。
 */
function attachmentToken(field: string, images: boolean): string {
  const kind = ATTACHMENT_TOKENS[ATTACHMENT_TYPE.exec(field)?.[1] ?? ''] || '附件'
  return mediaToken(kind, ATTACHMENT_URL.exec(field)?.[1], images)
}

/** 按标签把一段拆成字段。没有标签的行算上一个字段的续行——正文本身就可能是多行的 */
function forwardFields(lines: string[]): ForwardField[] {
  const fields: ForwardField[] = [{ label: '', lines: [] }]
  for (const line of lines) {
    const match = FORWARD_FIELD.exec(line)
    if (match) fields.push({ label: match[1], lines: [match[2]] })
    else fields[fields.length - 1].lines.push(line)
  }
  return fields
}

/**
 * 套娃转发折叠成的缩略标题：`[群聊的聊天记录 4 条]`。
 * 条数取里层分隔行上的最大序号，套了三层时序号会重新从 1 数起，
 * 取最大值至少不会越滚越大——横竖是个「里面还有多少」的量级，不是精确统计。
 */
function nestedToken(title: string, count: number): string {
  const name = title || '聊天记录'
  return count ? `[${name} ${count} 条]` : `[${name}]`
}

/**
 * 一条转发记录。正文取无标签的打头行与 `[消息内容]`，附件接在正文后面；
 * 两样都没有就返回 null——只剩个发送者的条目没什么可显示的。
 *
 * 这一条本身又是一整份聊天记录时（套娃转发），只留一个缩略标题：
 * 里层的内容在 `normalizeForward` 里就没往下收——一份四层套娃展开是几十行图片，
 * 平铺出来既看不出层次，也把报告和提示词撑爆。
 */
function parseForwardEntry(block: ForwardBlock, images: boolean): ForwardEntry | null {
  const fields = forwardFields(block.lines)
  const join = (label: string) => fields
    .filter((field) => field.label === label)
    .map((field) => field.lines.join('\n'))
    .join('\n')
    .trim()

  const media = fields
    .filter((field) => field.label.startsWith('附件'))
    .map((field) => attachmentToken(field.lines.join(' '), images))
  const body = [join(''), join('消息内容'), ...media].filter(Boolean).join(' ')

  // 里层记录有三种露头方式：分隔行、正文只剩一个记录标题、消息类型写着「聊天记录」
  const title = NESTED_TITLE.exec(body)?.[1]
  const kind = join('消息类型').includes('聊天记录') ? '聊天记录' : ''
  const content = block.nested || title || kind
    ? nestedToken(title || kind, block.nested)
    : body
  if (!content) return null

  const sender = join('发送者').replace(/\s+/g, ' ').trim().slice(0, FORWARD_NAME_LIMIT)
  return { sender, content }
}

/**
 * 单条形态：没有标题也没有分隔行，整段就是一条消息的排版树。
 * 引用回来的那条消息就长这样——正文之后跟着 `[发送者] 某某`，图片消息则只有 `[附件1]`。
 * 这里只留正文与附件：是谁说的，引用预览已经从 session.quote 里拿到了，
 * 再抄一遍就成了「张三：张三: [图片]」。
 */
function normalizeSingleEntry(lines: string[], images: boolean): string {
  return parseForwardEntry({ lines, nested: 0 }, images)?.content ?? lines.join('\n')
}

/**
 * 把合并转发的排版块压成「谁: 说了什么」。
 *
 * `images` 跟 `recordImages` 配置走：关掉时附件只留 `[图片]`，不留地址。
 * 不是转发、或者一条都没解析出来时原样返回——认错了还不如不动。
 * 压好的形态里没有 `[消息内容]` 这类标签，所以重复跑一遍是空转：
 * 入库时和读取时各调一次（后者顺带覆盖历史记录）不会把内容越洗越薄。
 */
export function normalizeForward(text: string | undefined | null, images = true): string {
  const source = String(text ?? '').replace(/\r\n?/g, '\n')
  if (!FORWARD_MARKER.test(source)) return source

  const lines = source.split('\n')
  const start = lines.findIndex((line) => FORWARD_HEADER.test(line) || isSeparator(line))
  if (start < 0) return normalizeSingleEntry(lines, images)

  const rest = lines.slice(start + 1)
  const { outer, inner } = pickSeparators(rest)
  const blocks: ForwardBlock[] = []
  for (const line of rest) {
    if (outer.test(line)) {
      blocks.push({ lines: [], nested: 0 })
      continue
    }
    const last = blocks[blocks.length - 1]
    const nested = inner?.exec(line)
    if (nested && last) {
      // 里层记录：只数一数有多少条，内容整段不收
      last.nested = Math.max(last.nested, Number(nested[1]) || 1)
      continue
    }
    if (last) {
      if (!last.nested) last.lines.push(line)
    } else if (FORWARD_FIELD.test(line)) {
      blocks.push({ lines: [line], nested: 0 })
    }
  }
  const entries = blocks
    .map((block) => parseForwardEntry(block, images))
    .filter((entry): entry is ForwardEntry => !!entry)
  if (!entries.length) return source

  const header = FORWARD_HEADER.exec(lines[start])?.[1] || '聊天记录'
  const card = [
    `[${header}]`,
    // 正文多行时续行缩进，和整篇对话文本一个道理：不缩进就分不清是新的一条还是上一条的下一行
    ...entries.map((entry) => layoutRecord(entry.sender ? `${entry.sender}: ` : '', entry.content)),
  ].join('\n')

  // 卡片之前可能还有别的正文（`@某人 看这个` 之类），原样留在前面
  const prefix = lines.slice(0, start).join('\n').trimEnd()
  return prefix ? `${prefix}\n${card}` : card
}

/**
 * 记录文本的标准清洗：先还原平台残标记，再把合并转发压成人话。
 * 入库与读取两头都走这一条，历史记录读出来就地跟上，渲染和提示词不必各处理一遍。
 */
export function cleanContent(text: string | undefined | null, images = true): string {
  return normalizeForward(decodePlatformMarkup(text), images).replace(LEGACY_AT, atToken(''))
}
