import { resolve } from 'path'
import { Context } from 'koishi'
// 仅为拿到 ctx.console 的类型增强；type-only 导入不会产生运行时依赖
import type { } from '@koishijs/plugin-console'
import type { Config } from './config'
import { logger } from './logger'
import { extendModel } from './database'
import { LLMService } from './llm'
import { applyMessageListener } from './message/recorder'
import { applyRetentionCleanup } from './message/retention'
import { applyCommands } from './commands'
import { createTimeFormatter } from './time'

export { Config } from './config'
export * from './database'
export * from './types'
export * from './analysis'
export * from './render'
export * from './time'
export { LLMService } from './llm'

export const name = 'qq-group-to-llm'
// puppeteer 与 console 都是可选依赖：
// 没有 puppeteer 时图片渲染自动回退为 markdown 文本，没有 console 时只是设置页少块预览
export const inject = {
  required: ['database', 'http'],
  optional: ['puppeteer', 'console'],
}

export function apply(ctx: Context, config: Config) {
  const log = logger(ctx)
  log.info(`插件启动 | 模型 ${config.openaiModel} @ ${config.openaiEndpoint}` +
    `，并发上限 ${config.llmConcurrency}，${config.llmStream ? '流式' : '非流式'}，重试 ${config.llmRetries} 次` +
    `${config.openaiApiKey ? '' : '（未配置 API Key，分析类命令不可用）'}`)
  log.info(`时区 | ${config.timezone || '跟随系统'}（当前 ${
    createTimeFormatter(config.timezone).dateTime(new Date())}）`)
  log.info(`结果出口 | ${config.renderImage
    ? `图片（${config.imageWidth}px @${config.imageScale}x）${ctx.puppeteer ? '' : '，但 puppeteer 未就绪，将回退为文字'}`
    : '文字'}`)

  // 提示词与版面模板都太长且很少是排查重点，摘要里跳过
  const skipped = [
    'reportHtmlTemplate', 'reportCssTemplate',
    'dialoguesHtmlTemplate', 'dialoguesCssTemplate',
    'personaHtmlTemplate', 'personaCssTemplate',
    'extraCss',
  ]
  const summary = Object.fromEntries(
    Object.entries(config).filter(([key]) => !key.startsWith('prompt') && !skipped.includes(key)),
  )
  log.debug('生效配置（不含提示词与版面模板）: %o', { ...summary, openaiApiKey: config.openaiApiKey ? '***' : '' })

  applyConsole(ctx)
  extendModel(ctx)
  applyMessageListener(ctx, config)
  applyRetentionCleanup(ctx, config)

  ctx.plugin(LLMService, config)
  ctx.inject(['qqGroupLlm'], (ctx) => applyCommands(ctx, config))
}

/**
 * 给控制台的插件设置页挂上版面预览。
 *
 * 控制台没装就整段跳过——预览是锦上添花的，不该成为跑这个插件的前提。
 * dev 指向 client 源码（开发时由 vite 现编），prod 指向 `yarn build` 产出的 dist。
 */
function applyConsole(ctx: Context) {
  ctx.inject(['console'], (ctx) => {
    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    })
  })
}
