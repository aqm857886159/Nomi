import type { AgentChatToolDecision } from '../../../electron/shared/contracts/agentChatContracts'
import type { AgentTurnHandle } from '../ai/agentTurnLifecycle'

export const WRITE_TOOL_NAMES = ['insert_at_cursor', 'replace_selection', 'append_to_end'] as const
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number]

export function isWriteTool(name: string): name is WriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name)
}

export type ToolDecision = AgentChatToolDecision
export type TurnHandle = AgentTurnHandle

export type PendingDocToolCall = {
  readonly toolCallId: string
  readonly toolName: WriteToolName
  readonly content: string
  readonly confirm: (decision: ToolDecision) => Promise<void>
}
