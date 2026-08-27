import { create } from 'zustand'
import type { AgentChatToolDecision } from '../../../electron/harness/agentChatContracts'
import { createAgentTurnState, type AgentTurnHandle, type AgentTurnState } from '../ai/agentTurnLifecycle'

export const WRITE_TOOL_NAMES = ['insert_at_cursor', 'replace_selection', 'append_to_end'] as const
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number]
export function isWriteTool(name: string): name is WriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name)
}
export type ToolDecision = AgentChatToolDecision
export type TurnHandle = AgentTurnHandle
export type PendingDocToolCall = {
  toolCallId: string
  toolName: WriteToolName
  content: string
  confirm: (decision: ToolDecision) => Promise<void>
}

type CreationTurnState = AgentTurnState & {
  pendingToolCalls: PendingDocToolCall[]
  addPendingToolCall: (call: PendingDocToolCall) => void
  resolvePendingToolCall: (toolCallId: string, decision: ToolDecision) => void
  clearPendingToolCalls: (reject?: boolean) => void
  nextMessageId: (role: 'user' | 'assistant') => string
}

function safeConfirm(call: PendingDocToolCall, decision: ToolDecision): void {
  void Promise.resolve(call.confirm(decision)).catch(() => {})
}

export const useCreationTurnStore = create<CreationTurnState>((set, get) => {
  const lifecycle = createAgentTurnState(set, get)
  const rejectPending = () => get().clearPendingToolCalls(true)
  return {
    ...lifecycle,
    pendingToolCalls: [],
    begin: () => {
      const turn = lifecycle.begin()
      rejectPending()
      return turn
    },
    finish: (turnId) => {
      const state = get()
      // A local chatStory card may be created while idle, before the next begin.
      // Only the first terminal transition owns the running turn's approvals.
      if (state.turnId !== turnId || !state.sending) return
      set({ sending: false, cancel: null, pendingToolCalls: [] })
      for (const call of state.pendingToolCalls) safeConfirm(call, { ok: false, denied: true, message: 'creation turn ended' })
    },
    abandon: () => {
      lifecycle.abandon()
      rejectPending()
    },
    requestUserCancel: () => {
      lifecycle.requestUserCancel()
      rejectPending()
    },
    addPendingToolCall: (call) => {
      set((state) => ({ pendingToolCalls: [...state.pendingToolCalls, call] }))
    },
    resolvePendingToolCall: (toolCallId, decision) => {
      const target = get().pendingToolCalls.find((call) => call.toolCallId === toolCallId)
      set((state) => ({ pendingToolCalls: state.pendingToolCalls.filter((call) => call.toolCallId !== toolCallId) }))
      if (target) safeConfirm(target, decision)
    },
    clearPendingToolCalls: (reject) => {
      const { pendingToolCalls } = get()
      set({ pendingToolCalls: [] })
      if (reject) for (const call of pendingToolCalls) safeConfirm(call, { ok: false, denied: true, message: 'creation turn ended' })
    },
    nextMessageId: (role) => `creation_ai_${role}_${globalThis.crypto.randomUUID()}`,
  }
})

export function abandonCreationTurn(): void {
  useCreationTurnStore.getState().abandon()
}
