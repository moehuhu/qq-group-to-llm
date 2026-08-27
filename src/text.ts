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
 * 所以入库前就把它压成一行一句的样子，谁说的写在前面，附件换成正文里通用的占位符：
 *
 *     [群聊的聊天记录]
 *     张三: 你好
 *     李四: [图片](https://…)
 *
 * 原话一个字不动，只是把排版行去掉、把发送者提到前面。
 */

/** 卡片标题行。平台会区分「群聊的聊天记录」和「聊天记录」，原样留着 */
const FORWARD_HEADER = /^[ \t]*\[([^\]\n]*聊天记录)\][ \t]*$/

/** 逐条之间的分隔行。见过 `=== 消息 1 ===`，适配器还认 `--- 第1条 ---` */
const FORWARD_SEPARATOR = /^[ \t]*(?:={2,}[ \t]*消息[ \t]*\d+[ \t]*={2,}|-{2,}[ \t]*第[ \t]*\d+[ \t]*条[ \t]*-{2,})[ \t]*$/

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

/** 附件类型 → 正文里的占位符，用的是元素序列化那边同一套词 */
const ATTACHMENT_TOKENS: Record<string, string> = {
  图片: '图片',
  视频: '视频',
  语音: '语音',
  音频: '语音',
  文件: '文件',
}

/** 发送者昵称的字数上限，与引用预览同理：名字占满一行就把话挤没了 */
const FORWARD_NAME_LIMIT = 24

interface ForwardEntry {
  sender: string
  content: string
}

/** 一个字段：标签加它底下的行。标签为空的那个是打头的无标签正文 */
interface ForwardField {
  label: string
  lines: string[]
}

/**
 * 把附件行压成一个占位符。
 * 只有图片带上地址——出图时它能换成真正的图片，别的类型给了地址也渲染不出来，
 * 白白在正文里留一串两百多字符的 URL。文件名、尺寸、大小一律丢掉：
 * 这些是卡片上的装饰，不是谁说的话。
 */
function attachmentToken(field: string, images: boolean): string {
  const token = ATTACHMENT_TOKENS[ATTACHMENT_TYPE.exec(field)?.[1] ?? ''] || '附件'
  const url = ATTACHMENT_URL.exec(field)?.[1]
  return token === '图片' && images && url ? `[图片](${url})` : `[${token}]`
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
 * 一条转发记录。正文取无标签的打头行与 `[消息内容]`，附件接在正文后面；
 * 两样都没有就返回 null——只剩个发送者的条目没什么可显示的。
 */
function parseForwardEntry(lines: string[], images: boolean): ForwardEntry | null {
  const fields = forwardFields(lines)
  const join = (label: string) => fields
    .filter((field) => field.label === label)
    .map((field) => field.lines.join('\n'))
    .join('\n')
    .trim()

  const media = fields
    .filter((field) => field.label.startsWith('附件'))
    .map((field) => attachmentToken(field.lines.join(' '), images))
  const content = [join(''), join('消息内容'), ...media].filter(Boolean).join(' ')
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
  return parseForwardEntry(lines, images)?.content ?? lines.join('\n')
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
  const start = lines.findIndex((line) => FORWARD_HEADER.test(line) || FORWARD_SEPARATOR.test(line))
  if (start < 0) return normalizeSingleEntry(lines, images)

  const blocks: string[][] = []
  for (const line of lines.slice(start + 1)) {
    if (FORWARD_SEPARATOR.test(line)) blocks.push([])
    else if (blocks.length) blocks[blocks.length - 1].push(line)
    else if (FORWARD_FIELD.test(line)) blocks.push([line])
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
  return normalizeForward(decodePlatformMarkup(text), images)
}
