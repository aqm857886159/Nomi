export type AssistantClientKey = 'claude' | 'codex' | 'cursor' | 'pi' | 'workbuddy'

/**
 * 宿主的显示名与排序。**唯一 owner 在这里**——「用 AI 帮我接入」卡与「接入 AI 编程助手」卡
 * 两处都要念这些名字，各抄一份的后果是同一个宿主在两屏上叫不同的名字。
 * 这些是产品专名（Claude Code / Codex / …），不进 i18n。
 */
export const ASSISTANT_CLIENT_LABEL: Record<AssistantClientKey, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  pi: 'Pi',
  workbuddy: 'WorkBuddy',
}
export const ASSISTANT_CLIENT_ORDER: readonly AssistantClientKey[] = ['claude', 'codex', 'cursor', 'pi', 'workbuddy']
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
