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
import { migrateMediaToFiles } from './media'
import { applyCommands } from './commands'
import { createTimeFormatter } from './time'

export { Config } from './config'
export * from './avatar'
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
  log.info(`插件启动 | 命名模型 ${config.llmModels.length ? config.llmModels.map((item) =>
    `${item.id}（${item.model} @ ${item.endpoint}）`).join('、') : '（未配置，分析类命令不可用）'}`)
  log.info(`任务分工 | 群分析=${config.llmModelTopic}（话题与金句同一次返回） 高光=${config.llmModelHighlightDialogues} ` +
    `问答=${config.llmModelQuery} 画像=${config.llmModelUserPersona}` +
    `，${config.llmStream ? '流式' : '非流式'}，重试 ${config.llmRetries} 次`)
  log.info(`模型并发 | ${config.llmModels.length ? config.llmModels.map((item) =>
    `${item.id}=${item.concurrency}`).join('、') : '（未配置）'}`)
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
  // 命名模型里的 apiKey 也要脱敏，不进日志
  if (Array.isArray(summary.llmModels)) {
    summary.llmModels = summary.llmModels.map((item: any) => ({
      ...item,
      apiKey: item.apiKey ? '***' : '',
    }))
  }
  log.debug('生效配置（不含提示词与版面模板）: %o', summary)

  applyConsole(ctx)
  extendModel(ctx)
  // 升级自旧版本时，把库里残留的 base64 图片缓存迁到文件存储并清空表
  void migrateMediaToFiles(ctx)
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
