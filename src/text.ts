/**
 * 记录文本的清洗。不依赖任何服务，纯函数。
 */

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
