import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDesktopAgentsChatStream, type AgentChatV2Session, type AgentsChatStreamEvent } from './desktopAgentsChatStream'

// Root-cause regression for the "Stop button doesn't stop" bug:
// cancelling the stream MUST emit a terminal `result` + `done` so the awaiting
// consumer (sendWorkbenchAiMessage) settles and the panel's sending/busy flag
// resets. Before the fix, `stop()` only unsubscribed the IPC listener, so the
// backend's own terminal events were dropped and the promise hung forever.

type ChatV2Callback = (event: unknown) => void

function installMockBridge() {
  let captured: ChatV2Callback | null = null
  const unsubscribe = vi.fn()
  const cancelChatV2 = vi.fn(async () => ({ ok: true }))
  const bridge = {
    agents: {
      chatV2Start: vi.fn(async () => ({ sessionId: 'session-test-1' })),
      confirmTool: vi.fn(async () => ({ ok: true })),
      cancelChatV2,
      onChatV2Event: vi.fn((_sessionId: string, callback: ChatV2Callback) => {
        captured = callback
        return unsubscribe
      }),
    },
  }
  ;(globalThis as unknown as { window?: unknown }).window = { nomiDesktop: bridge }
  return {
    cancelChatV2,
    unsubscribe,
    emit: (event: unknown) => captured?.(event),
  }
}

describe('openDesktopAgentsChatStream cancel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('emits a terminal result + done (with partial text) when cancelled mid-stream', async () => {
    const mock = installMockBridge()
    const events: AgentsChatStreamEvent[] = []
    let session: AgentChatV2Session | null = null

    await openDesktopAgentsChatStream(
      { vendor: 'agents', prompt: 'hi' },
      {
        onEvent: (event) => events.push(event),
        onSession: (s) => { session = s },
      },
    )

    expect(session).not.toBeNull()
    // Stream a couple of deltas so partial text exists.
    mock.emit({ type: 'content-delta', delta: '你好' })
    mock.emit({ type: 'content-delta', delta: '世界' })

    // User hits Stop.
    await session!.cancel()

    const result = events.find((e) => e.event === 'result')
    const done = events.find((e) => e.event === 'done')
    expect(result, 'cancel must emit a terminal result so the consumer settles').toBeTruthy()
    expect((result as { data: { response: { text: string } } }).data.response.text).toBe('你好世界')
    expect(done, 'cancel must emit done so the awaiting promise resolves').toBeTruthy()
    expect((done as { data: { reason: string } }).data.reason).toBe('finished')

    // And it must actually cancel the backend + unsubscribe.
    expect(mock.cancelChatV2).toHaveBeenCalledWith('session-test-1')
    expect(mock.unsubscribe).toHaveBeenCalled()
  })

  it('falls back to a "停止" placeholder when cancelled before any token', async () => {
    const mock = installMockBridge()
    const events: AgentsChatStreamEvent[] = []
    let session: AgentChatV2Session | null = null

    await openDesktopAgentsChatStream(
      { vendor: 'agents', prompt: 'hi' },
      {
        onEvent: (event) => events.push(event),
        onSession: (s) => { session = s },
      },
    )

    await session!.cancel()

    const result = events.find((e) => e.event === 'result')
    expect((result as { data: { response: { text: string } } }).data.response.text).toBe('（已停止生成）')
    void mock
  })

  it('is idempotent — a second cancel does not emit a second terminal pair', async () => {
    const mock = installMockBridge()
    const events: AgentsChatStreamEvent[] = []
    let session: AgentChatV2Session | null = null

    await openDesktopAgentsChatStream(
      { vendor: 'agents', prompt: 'hi' },
      {
        onEvent: (event) => events.push(event),
        onSession: (s) => { session = s },
      },
    )

    await session!.cancel()
    await session!.cancel()

    expect(events.filter((e) => e.event === 'done')).toHaveLength(1)
    expect(mock.cancelChatV2).toHaveBeenCalledTimes(1)
  })
})
