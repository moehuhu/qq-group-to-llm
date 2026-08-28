import { Context, Session } from 'koishi'
import type { Config } from '../config'
import { logger } from '../logger'
import { toMarkdownMessage } from '../markdown'
import { analyzeGroup, answerQuery, fetchMessages } from '../analysis'
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
      return await session.send(image)
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
    ].join('\n'))
    .option('days', '-d <days:number>  分析最近几天的记录')
    .option('group', '-g <group:string>  指定频道 ID')
    .option('force', '-f  忽略缓存重新分析')
    .action(async ({ options = {}, session }, query) => {
      if (!session) return

      const channelId = options.group || session.channelId
      if (!channelId) return '请在群聊中使用，或用 -g 指定频道 ID。'

      const days = Math.min(Math.max(options.days ?? config.analysisDays, 1), 7)
      const target = await resolveTarget(ctx, session, channelId)
      const question = query?.trim()

      log.info(`群分析由 ${session.userId} 在 ${channelId} 发起，days=${days}，` +
        `模式=${question ? `问答「${question}」` : '报告'}${options.force ? '，强制刷新' : ''}`)

      const cacheKey = `${channelId}:${days}`
        if (!question && !options.force && config.cacheMinutes > 0) {
        const cached = cache.get(cacheKey)
        if (cached && cached.expireAt > Date.now()) {
          log.info(`命中群分析缓存 ${cacheKey}，剩余 ${Math.round((cached.expireAt - Date.now()) / 1000)}s，跳过 LLM 调用`)
          return send(session, cached.result)
        }
      }

      const messages = await fetchMessages(ctx, config, target, days)
      if (messages.length < config.minMessages) {
        log.info(`群分析中止: ${messages.length} 条记录不足 minMessages=${config.minMessages}`)
        return `最近 ${days} 天只有 ${messages.length} 条记录，不足 ${config.minMessages} 条，无法分析。`
      }

      await session.send(`正在分析最近 ${days} 天的 ${messages.length} 条消息，请稍候…`)

      try {
        if (question) {
          const answer = await answerQuery(ctx, config, messages, target, question)
          return toMarkdownMessage(answer)
        }
        const result = await analyzeGroup(ctx, config, messages, target)
        if (config.cacheMinutes > 0) {
          cache.set(cacheKey, { result, expireAt: Date.now() + config.cacheMinutes * 60 * 1000 })
          log.debug(`群分析结果已缓存 ${cacheKey}，${config.cacheMinutes} 分钟内复用`)
        }
        return send(session, result)
      } catch (error) {
        log.error('群分析执行失败:', error)
        return `群分析失败：${error instanceof Error ? error.message : String(error)}`
      }
    })

  ctx.on('dispose', () => cache.clear())
}
