import { create } from 'zustand'
import type { AgentUsage } from '../../api/desktopClient'

type AgentUsageState = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  turns: number
  addUsage: (usage?: AgentUsage) => void
  reset: () => void
}

/**
 * Cumulative agent token usage for the current app session, fed automatically by
 * `runWorkbenchAgent` (both panels). Previously the SDK collected usage and it
 * was dropped one IPC hop away (harness audit #8); now it accumulates here so a
 * token/cost readout can render it for free.
 */
export const useAgentUsageStore = create<AgentUsageState>((set) => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  turns: 0,
  addUsage: (usage) => {
    if (!usage) return
    set((s) => ({
      promptTokens: s.promptTokens + usage.promptTokens,
      completionTokens: s.completionTokens + usage.completionTokens,
      totalTokens: s.totalTokens + usage.totalTokens,
      turns: s.turns + 1,
    }))
  },
  reset: () => set({ promptTokens: 0, completionTokens: 0, totalTokens: 0, turns: 0 }),
}))
