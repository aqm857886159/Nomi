import { create } from 'zustand'
import { createAgentTurnState, type AgentTurnState } from '../../ai/agentTurnLifecycle'

// Shared outside the panel so project/thread changes can invalidate even while
// the professional view is unmounted. A view switch itself does not abandon.
export const useCanvasTurnStore = create<AgentTurnState>((set, get) => createAgentTurnState(set, get))

export function abandonCanvasTurn(): void {
  useCanvasTurnStore.getState().abandon()
}
