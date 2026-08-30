/** 提示词与响应的纯函数处理，不依赖 Context，便于单独测试 */

/** 用 {占位符} → 值 填充模板 */
export function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  )
}

/** 找出模板里没被替换掉的占位符，用于告警 */
export function findLeftovers(prompt: string): string[] {
  return [...new Set(prompt.match(/\{[a-zA-Z]\w*\}/g) ?? [])]
}

/** 取出 markdown 代码块中的 JSON，找不到时返回 null */
export function extractJson(raw: string): string | null {
  // 优先取 ```json 代码块
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i)?.[1]
  if (fenced) return fenced.trim()
  // 其次退而求其次：任意的 ``` 代码块
  const generic = raw.match(/```\w*\s*([\s\S]*?)\s*```/)?.[1]
  if (generic) return generic.trim()
  // 都没有代码块：从第一个 { 或 [ 截到与之配对的 } 或 ]
  return extractTopLevel(raw)
}

/**
 * 从一段文本里截出最外层括号配对的 JSON 片段。
 * 模型偶尔会不套代码块直接吐 JSON，或者前面先垫一句介绍的话。
 */
function extractTopLevel(raw: string): string | null {
  const start = raw.search(/[[{]/)
  if (start < 0) return null
  const open = raw[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let i = start; i < raw.length; i++) {
    const c = raw[i]
    if (quote) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r'

/** 去掉 JSON 里的行注释与块注释（模型偶尔会带 JSONC 风格的注释），字符串内容不动 */
function stripComments(raw: string): string {
  let out = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (quote) {
      out += c
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      out += c
      continue
    }
    if (c === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') i++
      continue
    }
    if (c === '/' && raw[i + 1] === '*') {
      i += 2
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++
      i++
      continue
    }
    out += c
  }
  return out
}

/** 把单引号字符串转成双引号字符串（内部的 " 一并转义），兼容模型偷懒用单引号的情况 */
function normalizeQuotes(raw: string): string {
  let out = ''
  let single = false
  let double = false
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (single) {
      if (escaped) {
        escaped = false
        out += c
        continue
      }
      if (c === '\\') {
        escaped = true
        out += c
        continue
      }
      if (c === "'") {
        single = false
        out += '"'
        continue
      }
      if (c === '"') {
        out += '\\"'
        continue
      }
      out += c
      continue
    }
    if (double) {
      out += c
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') double = false
      continue
    }
    if (c === "'") {
      single = true
      out += '"'
      continue
    }
    if (c === '"') {
      double = true
      out += c
      continue
    }
    out += c
  }
  return out
}

/** 去掉数组/对象末尾悬着的尾逗号，字符串内容不动 */
function stripTrailingCommas(raw: string): string {
  let out = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (quote) {
      out += c
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      out += c
      continue
    }
    if (c === '}' || c === ']') {
      // 结构闭合前悬着的逗号是模型常犯的错，直接去掉
      let j = out.length - 1
      while (j >= 0 && isWs(out[j])) j--
      if (out[j] === ',') out = out.slice(0, j) + out.slice(j + 1)
    }
    out += c
  }
  return out
}

/**
 * 修正模型写坏的 JSON 格式，只处理几类反复出现的毛病：
 *
 * 1. 行注释 `//` 与块注释 `/* ... *\/`（模型常带 JSONC 风格的注释）
 * 2. 单引号字符串——转成双引号，并转义字符串内部的 `"`
 * 3. 数组/对象末尾悬着的尾逗号，JSON.parse 直接报 `Unexpected token`
 *
 * 字符串内部的文本一律照原样保留（只调整引号与转义），
 * 里面的 `//`、缩进、多行内容都是原话的一部分。
 */
export function repairJson(json: string): string {
  return stripTrailingCommas(normalizeQuotes(stripComments(json)))
}

/** 把接口返回的 usage 渲染成一行日志 */
export function formatUsage(usage?: {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}): string {
  if (!usage) return 'tokens 未返回'
  return `tokens ${usage.prompt_tokens ?? '?'}+${usage.completion_tokens ?? '?'}=${usage.total_tokens ?? '?'}`
}

/**
 * 沿 cause 链收集所有错误码。
 * fetch 的失败会被 cordis 包一层、undici 再包一层，
 * `UND_ERR_HEADERS_TIMEOUT` 这类码往往埋在两三层之下。
 */
export function collectErrorCodes(error: unknown): string[] {
  const codes: string[] = []
  const seen = new Set<unknown>()
  let current: any = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if (typeof current.code === 'string') codes.push(current.code)
    current = current.cause
  }
  return codes
}

/** 值得重试的错误码：连接抖动与各类超时，都是重发一次很可能就好的 */
const RETRYABLE_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'EAI_AGAIN',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET', 'UND_ERR_RESPONSE_STATUS_CODE',
])

/** 值得重试的状态码：限流与网关类故障 */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

/**
 * 判断一次失败要不要重发。
 * 鉴权失败、请求格式错误这类重试多少次都一样，直接放过去让调用方看到真正的原因。
 */
export function isRetryable(error: unknown): boolean {
  const status = (error as any)?.response?.status
  if (typeof status === 'number') return RETRYABLE_STATUS.has(status)
  return collectErrorCodes(error).some((code) => RETRYABLE_CODES.has(code))
}

/** 给日志用的一句话错误描述 */
export function describeError(error: unknown): string {
  const status = (error as any)?.response?.status
  const codes = collectErrorCodes(error)
  const message = error instanceof Error ? error.message : String(error)
  return [status && `HTTP ${status}`, codes.length && codes.join('/'), message]
    .filter(Boolean).join(' | ')
}
