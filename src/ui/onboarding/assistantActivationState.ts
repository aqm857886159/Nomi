export type AssistantClientKey = 'claude' | 'codex' | 'cursor'
export type AssistantVerifyPhase = 'checking' | 'ok' | 'broken' | null

export function resolveAssistantActivationState(input: {
  target: AssistantClientKey
  installed: boolean
  verifyPhase: AssistantVerifyPhase
  trustedHosts: readonly string[]
}): {
  broken: boolean
  cursorConfiguration: boolean
  cursorTrusted: boolean
  headerStatus: 'ok' | 'todo'
  showCursorPermissionAction: boolean
} {
  const broken = input.installed && input.verifyPhase === 'broken'
  const verified = input.installed && input.verifyPhase === 'ok'
  const cursorConfiguration = input.target === 'cursor' && input.installed && !broken
  const cursorTrusted = input.trustedHosts.includes('cursor')
  return {
    broken,
    cursorConfiguration,
    cursorTrusted,
    headerStatus: verified && input.target !== 'cursor' ? 'ok' : 'todo',
    showCursorPermissionAction: cursorConfiguration && !cursorTrusted,
  }
}
