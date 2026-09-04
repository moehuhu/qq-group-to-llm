import { Context, Session } from 'koishi'
import type { Config } from '../config'
import { logger } from '../logger'
import { analyzeGroup, answerQuery, fetchMessages } from '../analysis'
import { renderQueryAnswer } from '../analysis/report'
import { resolveTarget } from './target'
import { renderHtmlToImage, renderReportHtml } from '../render'
import type { GroupAnalysisResult } from '../types'

/** 分析结果缓存，键为 频道:天数。存结构化结果而非渲染文本，图文两种出口都能复用 */
interface CacheEntry {
  expireAt: number
  result: GroupAnalysisResult
}

/** 群分析：调用 LLM 生成报告，或就聊天记录自由提问 */
export function applyAnalysisCommand(ctx: Context, config: Config) {
  const log = logger(ctx)
  const cache = new Map<string, CacheEntry>()

  /** 优先出图，puppeteer 不可用、渲染失败或发送被拒时都不回退为 markdown，而是直接提示 */
  const send = async (session: Session, result: GroupAnalysisResult) => {
    const image = await renderHtmlToImage(
      ctx, config, renderReportHtml(result, config), '群分析',
    )
    if (!image) return '图片渲染失败，请稍后重试。'
    try {
      // send 的返回值是消息 id，直接返回会被命令当作文本再发一次，这里只 await 不 return
      await session.send(image)
    } catch (error) {
      log.warn(`[群分析] 图片发送失败:`, error)
      return `图片发送失败：${error instanceof Error ? error.message : String(error)}`
    }
  }

  ctx.command('群分析 [query:text]', '用 LLM 分析本群近期的聊天记录')
    .alias('group-analysis')
    .usage([
      '不带参数时生成一份分析报告（话题、金句、活跃榜）。高光对话见「高光对话」命令。',
      '带参数时就聊天记录自由提问，例如：群分析 今天有人聊到部署问题吗',
      '用 -n 指定分析的最近消息条数，例如：群分析 -n 200。超过设定上限时按上限处理。',
    ].join('\n'))
    .option('days', '-d <days:number>  分析最近几天的记录')
    .option('count', '-n <count:number>  分析最近的多少条消息，超过上限时按上限处理')
    .option('group', '-g <group:string>  指定频道 ID')
    .option('force', '-f  忽略缓存重新分析')
    .action(async ({ options = {}, session }, query) => {
      if (!session) return

      const channelId = options.group || session.channelId
      if (!channelId) return '请在群聊中使用，或用 -g 指定频道 ID。'

      const days = Math.min(Math.max(options.days ?? config.analysisDays, 1), 7)

      // 条数入参：缺省时按配置取；超过 maxMessages 上限时提示并按上限处理
      const limit = options.count
        ? Math.min(Math.max(Math.floor(options.count), 1), config.maxMessages)
        : config.maxMessages
      const overLimit = !!options.count && options.count > config.maxMessages

      const target = await resolveTarget(ctx, session, channelId)
      const question = query?.trim()

      log.info(`群分析由 ${session.userId} 在 ${channelId} 发起，days=${days}` +
        (options.count ? `，条数=${options.count}${overLimit ? '（超限，按上限处理）' : ''}` : '') +
        `，模式=${question ? `问答「${question}」` : '报告'}${options.force ? '，强制刷新' : ''}`)

      const cacheKey = `${channelId}:${days}`
      // 指定了条数时结果与默认配置不同，不复用缓存
      if (!question && !options.count && !options.force && config.cacheMinutes > 0) {
        const cached = cache.get(cacheKey)
        if (cached && cached.expireAt > Date.now()) {
          log.info(`命中群分析缓存 ${cacheKey}，剩余 ${Math.round((cached.expireAt - Date.now()) / 1000)}s，跳过 LLM 调用`)
          return send(session, cached.result)
        }
      }

      // 先登记并发名额并入队（同一用户同一指令去重，跨任务生效）。
      // 排队位次在提示语里直接告诉用户；取数期间占着位，防止同一个人反复堆请求
      const ticket = ctx.qqGroupLlm.register(question ? 'query' : 'topic', {
        userId: session.userId ?? 'unknown',
        command: '群分析',
      })
      if (!ticket) {
        log.info(`群分析去重: ${session.userId} 已有在飞或排队的请求`)
        return '你已有「群分析」请求在处理或排队中，请稍后再试。'
      }

      try {
        // 排队时立刻播报：用户无需等取数完成才知道自己排在第几个
        if (ticket.position > 0) {
          await session.send(`「群分析」请求已入队，前方还有 ${ticket.position} 个请求，请耐心等待…`)
        }

        // 条数超限时先提示用户按上限处理，再继续取数
        if (overLimit) {
          await session.send(`你指定的 ${options.count} 条超过单次分析上限 ${config.maxMessages} 条，将按 ${config.maxMessages} 条处理。`)
        }

        const messages = await fetchMessages(ctx, config, target, days, limit)
        if (messages.length < config.minMessages) {
          log.info(`群分析中止: ${messages.length} 条记录不足 minMessages=${config.minMessages}`)
          return `最近 ${days} 天只有 ${messages.length} 条记录，不足 ${config.minMessages} 条，无法分析。`
        }

        await session.send(`正在分析最近 ${days} 天的 ${messages.length} 条消息，请稍候…`)

        if (question) {
          const result = await answerQuery(ctx, config, messages, target, question, ticket)
          return renderQueryAnswer(result)
        }
        const result = await analyzeGroup(ctx, config, messages, target, '', ticket)
        if (!options.count && config.cacheMinutes > 0) {
          cache.set(cacheKey, { result, expireAt: Date.now() + config.cacheMinutes * 60 * 1000 })
          log.debug(`群分析结果已缓存 ${cacheKey}，${config.cacheMinutes} 分钟内复用`)
        }
        return send(session, result)
      } catch (error) {
        log.error('群分析执行失败:', error)
        return `群分析失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        ticket.release()
      }
    })

  ctx.on('dispose', () => cache.clear())
}
