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

/** 取出 markdown 代码块中的 YAML，找不到时返回 null */
export function extractYaml(raw: string): string | null {
  return raw.match(/```ya?ml\s*([\s\S]*?)\s*```/)?.[1] ?? null
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
