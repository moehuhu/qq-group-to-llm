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

/**
 * 块标量头：`detail: |-`、`- content: >`、`- |` 都算。
 * 捕获缩进（含 `- ` 前缀，取到键所在的列）与显式缩进指示符。
 */
const BLOCK_HEADER = /^(\s*(?:-\s+)*)(?:.*?:\s*)?[|>][+-]?(\d*)\s*$/

/** markdown 列表标记：`1.`、`2)`、`*`、`+`——`-` 本身就是合法 YAML，不动 */
const LIST_MARKER = /^(\s*)(\d+[.)]|[*+])(\s+)/

/**
 * 把 markdown 列表标记换成 `- `。
 * 模型偶尔用 `1. title:` 给顶层列表编号，而它下面几行的缩进是照着 `1. ` 的宽度对齐的，
 * 所以用空格把 `-` 补到一样宽，后面整块内容都不用动。
 */
function normalizeListMarker(line: string): string {
  const marker = line.match(LIST_MARKER)
  if (!marker) return line
  const width = marker[2].length + marker[3].length
  return marker[1] + '-' + ' '.repeat(width - 1) + line.slice(marker[0].length)
}

/** 缩进不足的那行是不是新的键或列表项——是的话说明块标量本来就该在这里结束 */
function looksStructural(text: string): boolean {
  return /^-(\s|$)/.test(text) || /^(?:"[^"]*"|'[^']*'|[^\s"'#][^:]*):(\s|$)/.test(text)
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

/**
 * 修正模型写坏的 YAML 格式，只处理两类反复出现的毛病：
 *
 * 1. 块标量的续行缩进不够——抄多行原话时只给第一行正确缩进，
 *    后面几行随手少打几个空格，js-yaml 报 `bad indentation of a sequence entry`
 * 2. 顶层列表用 markdown 的 `1.` 编号而不是 `- `，报 `bad indentation of a mapping entry`
 *
 * 块标量内部的文本一律照原样保留：那里的 `1.`、缩进都是原话的一部分。
 */
export function repairYaml(yaml: string): string {
  const lines = yaml.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = normalizeListMarker(lines[i])
    const header = line.match(BLOCK_HEADER)
    out.push(line)
    i++
    if (!header) continue

    const keyIndent = header[1].length
    // 显式指示符（`|2`）直接定基准，否则由块内第一条非空行决定
    let base = header[2] ? keyIndent + Number(header[2]) : -1

    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) {
        out.push(line)
        i++
        continue
      }
      const indent = indentOf(line)
      if (base < 0) {
        // 第一条非空行顶到了键的同列甚至更左，块就成了空的，补到键右侧两格
        base = indent > keyIndent ? indent : keyIndent + 2
        out.push(indent > keyIndent ? line : ' '.repeat(base) + line.trim())
        i++
        continue
      }
      if (indent >= base) {
        out.push(line)
        i++
        continue
      }
      if (looksStructural(line.trim())) break
      out.push(' '.repeat(base) + line.trim())
      i++
    }
  }

  return out.join('\n')
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
