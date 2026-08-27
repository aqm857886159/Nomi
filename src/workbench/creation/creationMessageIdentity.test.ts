import { afterEach, describe, expect, it, vi } from 'vitest'

async function freshMessageIds() {
  // A fresh module models renderer process restart without migrating stored bubbles.
  vi.resetModules()
  const { useCreationTurnStore } = await import('./creationTurnController')
  const { nextMessageId } = useCreationTurnStore.getState()
  return { user: nextMessageId('user'), assistant: nextMessageId('assistant') }
}

afterEach(() => { vi.resetModules(); vi.restoreAllMocks() })

describe('Creation message identity across cold restore', () => {
  it('a new reply leaves legacy bubble IDs and content unchanged', async () => {
    const archived = [
      { id: 'creation_ai_user_1', role: 'user', content: 'original request' },
      { id: 'creation_ai_assistant_2', role: 'assistant', content: 'F_DOC_DONE' },
    ]
    const ids = await freshMessageIds()
    const pending = [...archived,
      { id: ids.user, role: 'user', content: 'restored request' },
      { id: ids.assistant, role: 'assistant', content: '' },
    ]
    // This is the panel's identity-based stream/final update, not a text match.
    const completed = pending.map((message) => message.id === ids.assistant ? { ...message, content: 'F_RESTORED' } : message)
    expect(completed.slice(0, archived.length)).toEqual(archived)
    expect(completed.at(-1)?.content).toBe('F_RESTORED')
    expect(new Set(completed.map((message) => message.id)).size).toBe(completed.length)
  })

  it('two renderer lifetimes cannot reuse new message IDs even at the same wall-clock time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const first = await freshMessageIds()
    const reopened = await freshMessageIds()
    expect(new Set([...Object.values(first), ...Object.values(reopened)]).size).toBe(4)
  })
})
