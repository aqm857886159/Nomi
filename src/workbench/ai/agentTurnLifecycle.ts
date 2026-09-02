/** Renderer ownership of one in-flight turn. Stop preserves its display identity;
 * abandoning changes identity before invoking callbacks from the old transport. */
export type AgentTurnHandle = {
  id: number
  isCurrent: () => boolean
  canWrite: () => boolean
  isCancelled: () => boolean
}

export type AgentTurnState = {
  turnId: number
  sending: boolean
  cancel: (() => void) | null
  cancelRequested: boolean
  begin: () => AgentTurnHandle
  attachCancel: (turnId: number, cancel: () => void) => void
  finish: (turnId: number) => void
  requestUserCancel: () => void
  abandon: () => void
}

// Project replacement must invalidate any renderer transport that was created
// before the new project binding was installed. Keep this registry in the
// neutral lifecycle module so release code does not import an area-specific
// turn store (which would recreate a second semantic owner).
const turnInvalidators = new Set<() => void>()

export function registerAgentTurnInvalidator(invalidate: () => void): () => void {
  turnInvalidators.add(invalidate)
  return () => turnInvalidators.delete(invalidate)
}

export function invalidateAgentTurnStates(): void {
  for (const invalidate of [...turnInvalidators]) invalidate()
}

export function createAgentTurnState(
  set: (state: Partial<AgentTurnState>) => void,
  get: () => AgentTurnState,
): AgentTurnState {
  const invalidate = () => {
    const state = get()
    set({ turnId: state.turnId + 1, sending: false, cancel: null, cancelRequested: true })
    state.cancel?.()
  }
  registerAgentTurnInvalidator(invalidate)
  return {
    turnId: 0,
    sending: false,
    cancel: null,
    cancelRequested: false,
    begin: () => {
      const previous = get()
      const id = previous.turnId + 1
      set({ turnId: id, sending: true, cancel: null, cancelRequested: false })
      previous.cancel?.()
      const isCurrent = () => get().turnId === id
      return {
        id, isCurrent,
        canWrite: () => isCurrent() && get().sending && !get().cancelRequested,
        isCancelled: () => isCurrent() && get().cancelRequested,
      }
    },
    attachCancel: (turnId, cancel) => {
      const state = get()
      if (state.turnId !== turnId || state.cancelRequested || !state.sending) {
        cancel()
        return
      }
      set({ cancel })
    },
    finish: (turnId) => {
      if (get().turnId === turnId) set({ sending: false, cancel: null })
    },
    requestUserCancel: () => {
      const state = get()
      if (state.cancelRequested || !state.sending) return
      set({ cancelRequested: true, cancel: null })
      state.cancel?.()
    },
    abandon: () => {
      invalidate()
    },
  }
}

export function assertTurnCanWrite(canWrite: () => boolean): void {
  if (!canWrite()) throw new DOMException('Agent turn is no longer writable', 'AbortError')
}
