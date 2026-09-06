export type AgentFailureCategory = 'auth' | 'quota' | 'network' | 'provider' | 'lifecycle' | 'capability' | 'unknown'

export function safeAgentFailureCode(code: string): string {
  const normalized = code.trim()
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(normalized) ? normalized : 'unknown'
}

/** Keep diagnostics useful to the runner without projecting provider messages or credentials into the DOM. */
export function agentFailureCategory(code: string, message: string): AgentFailureCategory {
  const text = `${code} ${message}`.toLowerCase()
  if (/401|403|auth|credential|api.?key|unauthori[sz]ed|forbidden/.test(text)) return 'auth'
  if (/429|quota|rate.?limit|too many requests/.test(text)) return 'quota'
  if (/network|fetch failed|timeout|econn|dns|connect/.test(text)) return 'network'
  if (/provider|upstream|http 5\d\d|runtime_error/.test(text)) return 'provider'
  if (/stale|precondition|binding|subscription|abort|cancel|lifecycle/.test(text)) return 'lifecycle'
  if (/capability|write|approval|denied/.test(text)) return 'capability'
  return 'unknown'
}

export function readableFailure(t: (key: string, options?: Record<string, unknown>) => string, code: string, message: string): string {
  const text = `${code} ${message}`.toLowerCase()
  if (text.includes('model') && (text.includes('config') || text.includes('credential') || text.includes('key'))) return t('agentResident.modelUnavailable')
  if (text.includes('stale') || text.includes('precondition')) return t('agentResident.contextChanged')
  if (text.includes('denied') || text.includes('approval')) return t('agentResident.operationDenied')
  if (text.includes('cancel')) return t('agentResident.operationStopped')
  return t('agentResident.operationFailed')
}

export function isWriteFailure(code: string, message: string): boolean {
  return /(^|[_\s-])(write|written)([_\s-]|$)|canvas[._-]write/i.test(`${code} ${message}`)
}
