export type CustomCallDiagnosticEntry = {
  method: string
  url: string
  status: 'ok' | 'error'
  durationMs: number
  requestPreview?: string
  responsePreview?: string
  errorMessage?: string
}

export function parseCustomCallTestParams(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('试跑参数不是有效 JSON，请检查引号和逗号。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('试跑参数必须是一个 JSON 对象。')
  }
  return parsed as Record<string, unknown>
}

/**
 * 修复 AI 真正需要的是“发了什么、收到了什么”，不是只有最后一句错误。transcript 已在主进程
 * 脱敏；这里限制条目和总长度，避免长轮询把提示词撑爆，同时保留首调和最后几次查询。
 */
export function formatCustomCallDiagnosticContext(input: {
  errorMessage?: string
  transcript: CustomCallDiagnosticEntry[]
}): string {
  const entries = input.transcript.length <= 6
    ? input.transcript
    : [...input.transcript.slice(0, 2), ...input.transcript.slice(-4)]
  const lines = [input.errorMessage ? `Final error: ${input.errorMessage}` : '']
  if (input.transcript.length > entries.length) lines.push(`(${input.transcript.length - entries.length} middle requests omitted)`)
  entries.forEach((entry, index) => {
    lines.push(`Request ${index + 1}: ${entry.method} ${entry.url} [${entry.status}, ${entry.durationMs}ms]`)
    if (entry.requestPreview) lines.push(`Request body: ${entry.requestPreview}`)
    if (entry.responsePreview) lines.push(`Response: ${entry.responsePreview}`)
    if (entry.errorMessage) lines.push(`Request error: ${entry.errorMessage}`)
  })
  return lines.filter(Boolean).join('\n').slice(0, 12_000)
}
