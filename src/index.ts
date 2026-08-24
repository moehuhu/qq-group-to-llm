import { Context } from 'koishi'
import type { Config } from './config'
import { logger } from './logger'
import { extendModel } from './database'
import { LLMService } from './llm'
import { applyMessageListener } from './message/recorder'
import { applyRetentionCleanup } from './message/retention'
import { applyCommands } from './commands'

export { Config } from './config'
export * from './database'
export * from './types'
export * from './analysis'
export { LLMService } from './llm'

export const name = 'qq-group-to-llm'
export const inject = ['database', 'http']

export function apply(ctx: Context, config: Config) {
  const log = logger(ctx)
  log.info(`插件启动 | 模型 ${config.openaiModel} @ ${config.openaiEndpoint}` +
    `${config.openaiApiKey ? '' : '（未配置 API Key，分析类命令不可用）'}`)

  // 提示词模板太长且很少是排查重点，摘要里跳过；需要看时开 debug 会打完整提示词
  const summary = Object.fromEntries(
    Object.entries(config).filter(([key]) => !key.startsWith('prompt')),
  )
  log.debug('生效配置（不含提示词模板）: %o', { ...summary, openaiApiKey: config.openaiApiKey ? '***' : '' })

  extendModel(ctx)
  applyMessageListener(ctx, config)
  applyRetentionCleanup(ctx, config)

  ctx.plugin(LLMService, config)
  ctx.inject(['qqGroupLlm'], (ctx) => applyCommands(ctx, config))
}
