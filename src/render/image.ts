/**
 * puppeteer 截图桥接层。
 *
 * 图片是锦上添花的出口：puppeteer 没装、没起来或渲染失败时，
 * 一律返回 null 由调用方回退到 markdown，绝不让命令整个失败。
 */
import { Context } from 'koishi'
// 仅为拿到 ctx.puppeteer 的类型增强；type-only 导入不会产生运行时依赖
import type { } from 'koishi-plugin-puppeteer'
import type { Config } from '../config'
import { logger } from '../logger'

/** 图片渲染是否可用：开关打开且 puppeteer 服务确实在线 */
export function canRenderImage(ctx: Context, config: Config): boolean {
  return config.renderImage && !!ctx.puppeteer
}

function redactImageUrl(value: string): string {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value
  }
}

function formatHtmlForLog(html: string): string {
  let indent = 0
  return html
    .replace(/>\s*</g, '>\n<')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^<\//.test(line)) indent = Math.max(0, indent - 1)
      const formatted = `${'  '.repeat(indent)}${line}`
      if (/^<[^!/][^>]*[^/]\s*>$/.test(line) && !/<\//.test(line)) indent += 1
      return formatted
    })
    .join('\n')
}

/**
 * 把 HTML 截成图片，返回可直接发送的图片元素字符串。
 * 失败返回 null——调用方据此回退到文本。
 */
export async function renderHtmlToImage(
  ctx: Context,
  config: Config,
  html: string,
  task: string,
): Promise<string | null> {
  if (!canRenderImage(ctx, config)) return null

  const log = logger(ctx)
  const startedAt = Date.now()
  try {
    log.info(`[${task}] 即将渲染 HTML:\n${formatHtmlForLog(html)}`)
    const image = await ctx.puppeteer.render(html, async (page, next) => {
      // deviceScaleFactor=2 出二倍图，QQ 里缩放后文字才不糊
      await page.setViewport({
        width: config.imageWidth,
        height: 720,
        deviceScaleFactor: config.imageScale,
      })

      // 头像等远程图片要等加载完再截，否则会拍到空白占位
      const failedImages = await page.evaluate(async (): Promise<string[]> => {
        const failed: string[] = []
        const images = Array.from(document.images)
        for (const image of images) {
          image.addEventListener('error', () => {
            failed.push(image.currentSrc || image.src)
          }, { capture: true, once: true })
          if (image.complete && image.naturalWidth === 0) {
            failed.push(image.currentSrc || image.src)
          }
        }

        const pending = images
          .filter((image) => !image.complete)
          .map((image) => new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true })
            image.addEventListener('error', resolve, { once: true })
          }))
        // 单张图卡住不该拖垮整次渲染，最多等 60 秒
        await Promise.race([
          Promise.all(pending),
          new Promise((resolve) => setTimeout(resolve, 60000)),
        ])
        return failed
      })

      for (const url of failedImages) {
        log.warn(`[${task}] 图片链接加载失败: ${redactImageUrl(url)}`)
      }

      const card = await page.$('#card')
      return next(card ?? undefined)
    })

    log.info(`[${task}] 图片渲染完成，耗时 ${Date.now() - startedAt}ms，` +
      `宽度 ${config.imageWidth}px @${config.imageScale}x`)
    return image
  } catch (error) {
    log.warn(`[${task}] 图片渲染失败（耗时 ${Date.now() - startedAt}ms），回退为文本:`, error)
    return null
  }
}
