/**
 * 记录文本的清洗。不依赖任何服务，纯函数。
 */

/**
 * 平台塞在正文里、适配器没能解析掉的内联标记。
 *
 * QQ 的 `<faceType=6,faceId="…",ext="…">` 会被适配器换成图片元素，
 * 但缺少 faceId/ext 的简写 `<faceType=6>` 匹配不上它的正则，
 * 于是原样留在文本里——表情本身已经变成图片了，这个残标记纯属噪音，
 * 既会显示在图里，也会跟着提示词一起喂给模型。
 */
const PLATFORM_MARKUP = /<faceType=\d+(?:,[^>]*)?>/g

/** 去掉平台残留的内联标记，并收拢由此产生的多余空格 */
export function stripPlatformMarkup(text: string | undefined | null): string {
  const source = String(text ?? '')
  if (!source.includes('<faceType')) return source
  return source.replace(PLATFORM_MARKUP, '').replace(/[ \t]{2,}/g, ' ').trim()
}
