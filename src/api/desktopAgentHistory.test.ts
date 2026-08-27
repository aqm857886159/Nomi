import { afterEach, expect, it, vi } from 'vitest'
import { clearWorkbenchAgentSession, seedWorkbenchAgentSession } from './desktopClient'
const history = { kind: 'persistent' as const, binding: { sessionKey: 'nomi:workbench:p:creation', threadId: 'archived-thread' } }
afterEach(() => { delete (globalThis as unknown as { window?: unknown }).window })
it('empty seed is still an explicit ensure, never an early return or a clear', async () => {
  const seed = vi.fn(async () => ({ ok: true }))
  const clear = vi.fn(async () => ({ ok: true }))
  ;(globalThis as unknown as { window: unknown }).window = { nomiDesktop: { agents: { seedChatV2Session: seed, clearChatV2Session: clear } } }
  await seedWorkbenchAgentSession(history as unknown as Parameters<typeof seedWorkbenchAgentSession>[0], [])
  expect(seed).toHaveBeenCalledWith({ history, messages: [] })
  expect(clear).not.toHaveBeenCalled()
  await clearWorkbenchAgentSession(history as unknown as Parameters<typeof clearWorkbenchAgentSession>[0])
  expect(clear).toHaveBeenCalledWith({ history })
})
