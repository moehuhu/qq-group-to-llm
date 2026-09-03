/**
 * 图片缓存的本地文件存储。
 *
 * 背景：图片缓存原先以 base64 data URI 存进数据库（qq_group_media），
 * SQL.js 是 WASM 实现的 SQLite，全部数据都驻留在它自己的线性内存里，
 * 几百 MB 的 base64 会把这块内存逼到上限，最终表现为 `memory access out of bounds`。
 * 现在改为按 URL 的 sha256 存成文件（`<hash>` 二进制 + `<hash>.json` 元数据），
 * 数据库里不再存放图片数据；渲染时读文件转回 data URI，渲染层无需感知介质变化。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from 'koishi'
import { MEDIA_TABLE, type MediaRecord } from './database'
import { logger } from './logger'

/** 缓存根目录：`data/qq-group-media`，与 koishi.yml 的 `path` 同级 */
export const MEDIA_DIR = 'qq-group-media'

function mediaDir(ctx: Context): string {
  return join(ctx.baseDir, 'data', MEDIA_DIR)
}

function hashOf(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

function filePath(dir: string, hash: string): string {
  return join(dir, hash)
}

function metaPath(dir: string, hash: string): string {
  return join(dir, `${hash}.json`)
}

interface MediaMeta {
  url: string
  platform: string
  mime: string
  updatedAt: string
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/**
 * 下载一张图片并写入本地缓存。
 * 超出 mediaCacheMaxImageBytes 上限时跳过（只保留原链接）。
 */
export async function saveMedia(
  ctx: Context,
  url: string,
  platform: string,
  data: ArrayBuffer,
  config: { mediaCacheMaxImageBytes: number },
): Promise<void> {
  if (config.mediaCacheMaxImageBytes > 0 && data.byteLength > config.mediaCacheMaxImageBytes) {
    logger(ctx).warn(`图片缓存跳过（${data.byteLength} 字节超过上限 ${config.mediaCacheMaxImageBytes}）：${url}`)
    return
  }
  const dir = mediaDir(ctx)
  await ensureDir(dir)
  const hash = hashOf(url)
  const now = new Date().toISOString()
  await Promise.all([
    writeFile(filePath(dir, hash), Buffer.from(data)),
    writeFile(metaPath(dir, hash), JSON.stringify({
      url,
      platform,
      mime: 'image/jpeg',
      updatedAt: now,
    } as MediaMeta)),
  ])
}

/** 读一条缓存，转成渲染层要的 data URI；文件缺失时返回 undefined */
export async function loadMedia(
  ctx: Context,
  url: string,
): Promise<string | undefined> {
  const dir = mediaDir(ctx)
  const hash = hashOf(url)
  try {
    const [meta, data] = await Promise.all([
      readFile(metaPath(dir, hash), 'utf8'),
      readFile(filePath(dir, hash)),
    ])
    const { mime } = JSON.parse(meta) as MediaMeta
    return `data:${mime || 'image/jpeg'};base64,${data.toString('base64')}`
  } catch {
    return undefined
  }
}

/** 本地缓存文件列表，按最后修改时间升序（最旧的在前） */
async function listMediaFiles(ctx: Context): Promise<{ path: string, meta?: MediaMeta, mtime: number }[]> {
  const dir = mediaDir(ctx)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const files = entries.filter((name) => !name.endsWith('.json'))
  const withMeta = await Promise.all(files.map(async (name) => {
    const full = join(dir, name)
    const [info, meta] = await Promise.all([
      stat(full),
      readFile(join(dir, `${name}.json`), 'utf8').catch(() => undefined),
    ])
    return {
      path: full,
      meta: meta ? JSON.parse(meta) as MediaMeta : undefined,
      mtime: info.mtimeMs,
    }
  }))
  withMeta.sort((left, right) => left.mtime - right.mtime)
  return withMeta
}

/** 清理过期与超量的缓存文件（不触碰数据库） */
export async function cleanupMediaFiles(
  ctx: Context,
  config: { mediaRetentionDays: number, mediaCacheMaxEntries: number },
): Promise<number> {
  const files = await listMediaFiles(ctx)
  let removed = 0
  const cutoff = config.mediaRetentionDays > 0
    ? Date.now() - config.mediaRetentionDays * 24 * 60 * 60 * 1000
    : 0
  const keep = config.mediaCacheMaxEntries > 0 ? config.mediaCacheMaxEntries : Infinity
  const toRemove = files.filter((file, index) =>
    (cutoff > 0 && file.mtime < cutoff) ||
    (keep !== Infinity && index < files.length - keep))
  for (const file of toRemove) {
    try {
      await Promise.all([
        unlink(file.path).catch(() => undefined),
        unlink(`${file.path}.json`).catch(() => undefined),
      ])
      removed++
    } catch {
      // 单个文件删不掉不阻塞整体清理
    }
  }
  return removed
}

/**
 * 把数据库里的旧缓存迁移到文件存储，随后清空数据库表。
 *
 * 升级前图片 base64 存在 qq_group_media.data 里，首次启动时把它们
 * 写成文件（按当前 URL 哈希），然后清表——表结构保留以便回滚，
 * 但此后不再写入。
 */
export async function migrateMediaToFiles(ctx: Context): Promise<void> {
  const log = logger(ctx)
  let records: MediaRecord[] = []
  try {
    records = await ctx.database.get(MEDIA_TABLE, {})
  } catch (error) {
    log.warn('读取旧图片缓存失败，跳过迁移:', error)
    return
  }
  if (!records.length) return

  const dir = mediaDir(ctx)
  await ensureDir(dir)
  let moved = 0
  for (const record of records) {
    try {
      const dataUri = record.data
      if (!dataUri?.startsWith('data:')) continue
      const comma = dataUri.indexOf(',')
      if (comma < 0) continue
      const mime = dataUri.slice(5, dataUri.indexOf(';')) || 'image/jpeg'
      const binary = Buffer.from(dataUri.slice(comma + 1), 'base64')
      const hash = hashOf(record.url)
      await Promise.all([
        writeFile(filePath(dir, hash), binary),
        writeFile(metaPath(dir, hash), JSON.stringify({
          url: record.url,
          platform: record.platform,
          mime,
          updatedAt: new Date(record.updatedAt).toISOString(),
        } as MediaMeta)),
      ])
      moved++
    } catch (error) {
      log.warn(`迁移图片缓存失败（${record.url}）:`, error)
    }
  }

  try {
    await ctx.database.remove(MEDIA_TABLE, {})
  } catch (error) {
    log.warn('清空旧图片缓存表失败:', error)
  }
  log.info(`图片缓存已迁移到文件存储（${moved}/${records.length} 条），数据库表已清空`)
}
