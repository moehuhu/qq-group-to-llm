import { Context } from 'koishi'
import type { Config } from './config'
import { extendModel } from './model'
import { LLMService } from './llm'
import { applyMessageListener } from './listener'
import { applyCommands } from './command'
import { applyRetentionCleanup } from './cleanup'

export { Config } from './config'
export * from './model'
export * from './types'
export { LLMService } from './llm'

export const name = 'qq-group-to-llm'
export const inject = ['database', 'http']

export function apply(ctx: Context, config: Config) {
  extendModel(ctx)
  applyMessageListener(ctx, config)
  applyRetentionCleanup(ctx, config)

  ctx.plugin(LLMService, config)
  ctx.inject(['qqGroupLlm'], (ctx) => applyCommands(ctx, config))
}
