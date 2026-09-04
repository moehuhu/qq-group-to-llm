import { Context, Session } from 'koishi'
import type { Config } from '../config'
import { logger } from '../logger'
import { analyzeDialogues, fetchMessages } from '../analysis'
import { resolveTarget } from './target'
import { renderDialoguesHtml, renderHtmlToImage } from '../render'
import type { DialogueDigest } from '../types'

/** 对话抽取结果缓存，键为 频道:天数 */
interface CacheEntry {
  expireAt: number
  digest: DialogueDigest
}

/** 高光对话：单独成命令，只抽取带学术要素的冷幽默对话片段 */
export function applyHighlightCommand(ctx: Context, config: Config) {
  const log = logger(ctx)
  const cache = new Map<string, CacheEntry>()

  /**
   * 优先出图，puppeteer 不可用、渲染失败或发送被拒时都不回退为 markdown，而是直接提示。
   * 抽取结果已含昵称与原文，直接渲染即可。
   */
  const send = async (session: Session, digest: DialogueDigest) => {
    if (!digest.dialogues.length) {
      log.info(`高光对话没有可展示的片段`)
      return '没有找到可展示的高光对话。'
    }
    const image = await renderHtmlToImage(
      ctx, config, renderDialoguesHtml(digest, config), '高光对话',
    )
    if (!image) return '图片渲染失败，请稍后重试。'
    try {
      // send 的返回值是消息 id，直接返回会被命令当作文本再发一次，这里只 await 不 return
      await session.send(image)
    } catch (error) {
      log.warn(`[高光对话] 图片发送失败:`, error)
      return `图片发送失败：${error instanceof Error ? error.message : String(error)}`
    }
  }

  ctx.command('高光对话 [count:number]', '截取带学术要素的冷幽默群聊对话')
    .alias('highlight')
    .usage([
      '从最近的聊天记录里截取几段「一本正经地用学科知识讨论鸡毛蒜皮」的对话。',
      '判定严格，宁缺毋滥——没有符合条件的片段时会直说没找到。',
      '用 -n 指定从最近的多少条消息里找，例如：高光对话 -n 200。超过设定上限时按上限处理。',
    ].join('\n'))
    .option('days', '-d <days:number>  分析最近几天的记录')
    .option('limit', '-n <limit:number>  从最近的多少条消息里找，超过上限时按上限处理')
    .option('group', '-g <group:string>  指定频道 ID')
    .option('force', '-f  忽略缓存重新抽取')
    .action(async ({ options = {}, session }, count) => {
      if (!session) return

      const channelId = options.group || session.channelId
      if (!channelId) return '请在群聊中使用，或用 -g 指定频道 ID。'

      const days = Math.min(Math.max(options.days ?? config.analysisDays, 1), 7)

      // 条数入参：指定 -n 时按入参取（超过 maxMessages 上限提示并按上限处理）；
      // 缺省时按配置的 defaultMessages 取，同样钳制在 maxMessages 内
      const messageLimit = options.limit
        ? Math.min(Math.max(Math.floor(options.limit), 1), config.maxMessages)
        : Math.min(Math.max(Math.floor(config.defaultMessages), 1), config.maxMessages)
      const overLimit = !!options.limit && options.limit > config.maxMessages

      const target = await resolveTarget(ctx, session, channelId)

      log.info(`高光对话由 ${session.userId} 在 ${channelId} 发起，days=${days}` +
        (options.limit ? `，条数=${options.limit}${overLimit ? '（超限，按上限处理）' : ''}` : '') +
        `${count ? `，指定 ${count} 段` : ''}${options.force ? '，强制刷新' : ''}`)

      // 带段数或条数参数时结果不同，不能复用缓存
      const cacheKey = `${channelId}:${days}`
      if (!count && !options.limit && !options.force && config.cacheMinutes > 0) {
        const cached = cache.get(cacheKey)
        if (cached && cached.expireAt > Date.now()) {
          log.info(`命中高光对话缓存 ${cacheKey}，剩余 ${Math.round((cached.expireAt - Date.now()) / 1000)}s，跳过 LLM 调用`)
          return send(session, cached.digest)
        }
      }

      // 同一用户同一指令去重，登记并发名额
      const ticket = ctx.qqGroupLlm.register('highlightDialogues', {
        userId: session.userId ?? 'unknown',
        command: '高光对话',
      })
      if (!ticket) {
        log.info(`高光对话去重: ${session.userId} 已有在飞或排队的请求`)
        return '你已有「高光对话」请求在处理或排队中，请稍后再试。'
      }

      try {
        // 排队时立刻播报，用户无需等取数完成
        if (ticket.position > 0) {
          await session.send(`「高光对话」请求已入队，前方还有 ${ticket.position} 个请求，请耐心等待…`)
        }

        // 条数超限时先提示用户按上限处理，再继续取数
        if (overLimit) {
          await session.send(`你指定的 ${options.limit} 条超过单次分析上限 ${config.maxMessages} 条，将按 ${config.maxMessages} 条处理。`)
        }

        const messages = await fetchMessages(ctx, config, target, days, messageLimit)
        if (messages.length < config.minMessages) {
          log.info(`高光对话中止: ${messages.length} 条记录不足 minMessages=${config.minMessages}`)
          return `最近 ${days} 天只有 ${messages.length} 条记录，不足 ${config.minMessages} 条，无法分析。`
        }

        await session.send(`正在从最近 ${days} 天的 ${messages.length} 条消息里找高光对话，请稍候…`)

        // 命令参数只在本次生效，不覆盖配置里的默认值
        const limit = count
          ? Math.min(Math.max(count, 1), config.maxHighlightDialogues)
          : config.maxHighlightDialogues
        const digest = await analyzeDialogues(
          ctx, { ...config, maxHighlightDialogues: limit }, messages, target, ticket,
        )

        if (!digest.dialogues.length) {
          return `最近 ${days} 天里没找到符合条件的高光对话。`
        }
        if (!count && !options.limit && config.cacheMinutes > 0) {
          cache.set(cacheKey, { digest, expireAt: Date.now() + config.cacheMinutes * 60 * 1000 })
          log.debug(`高光对话结果已缓存 ${cacheKey}，${config.cacheMinutes} 分钟内复用`)
        }
        return send(session, digest)
      } catch (error) {
        log.error('高光对话抽取失败:', error)
        return `高光对话抽取失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        ticket.release()
      }
    })

  ctx.on('dispose', () => cache.clear())
}
