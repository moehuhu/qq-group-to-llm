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
export * from './render'
export { LLMService } from './llm'

export const name = 'qq-group-to-llm'
// puppeteer 是可选依赖：没有它时图片渲染自动回退为 markdown 文本
export const inject = {
  required: ['database', 'http'],
  optional: ['puppeteer'],
}

export function apply(ctx: Context, config: Config) {
  const log = logger(ctx)
  log.info(`插件启动 | 模型 ${config.openaiModel} @ ${config.openaiEndpoint}` +
    `，并发上限 ${config.llmConcurrency}，${config.llmStream ? '流式' : '非流式'}，重试 ${config.llmRetries} 次` +
    `${config.openaiApiKey ? '' : '（未配置 API Key，分析类命令不可用）'}`)
  log.info(`结果出口 | ${config.renderImage
    ? `图片（${config.imageWidth}px @${config.imageScale}x）${ctx.puppeteer ? '' : '，但 puppeteer 未就绪，将回退为文字'}`
    : '文字'}`)

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
