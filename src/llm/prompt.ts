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
