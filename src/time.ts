/**
 * 时区相关的时间处理。
 *
 * 分桶和展示都必须用同一个时区，否则报告里的时间范围和柱状图会对不上。
 * 全部走 Intl，不引第三方库，夏令时也由它负责。
 */
import { Context } from 'koishi'
import { logger } from './logger'

export interface TimeFormatter {
  /** 该时区下的整点（0-23） */
  hour(date: Date): number
  /** 年月日时分秒，用于展示 */
  dateTime(date: Date): string
  /** 时分秒，用于投喂给模型的逐条时间戳 */
  time(date: Date): string
}

/** 时区名是否被运行时认识 */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/**
 * 建一组绑定时区的格式化器。
 * timezone 为空表示跟随系统时区。
 *
 * hourCycle 固定 h23：默认的 h24 会把午夜写成 24，分桶时会多出一个不存在的下标。
 */
export function createTimeFormatter(timezone?: string): TimeFormatter {
  const zone = timezone && isValidTimezone(timezone) ? timezone : undefined

  const hourFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: '2-digit', hourCycle: 'h23',
  })
  const dateTimeFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  const timeFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: zone,
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })

  return {
    hour: (date) => Number(hourFormat.format(date)),
    dateTime: (date) => dateTimeFormat.format(date),
    time: (date) => timeFormat.format(date),
  }
}

/** 按配置建格式化器；时区名不认识时退回系统时区并告警 */
export function resolveTimeFormatter(ctx: Context, timezone: string): TimeFormatter {
  if (timezone && !isValidTimezone(timezone)) {
    logger(ctx).warn(`时区 "${timezone}" 无法识别，本次按系统时区处理。请填 IANA 名称，如 Asia/Shanghai`)
    return createTimeFormatter()
  }
  return createTimeFormatter(timezone)
}
