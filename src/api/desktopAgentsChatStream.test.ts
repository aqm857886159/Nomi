import { afterEach, describe, expect, it, vi } from 'vitest'

const surface = vi.hoisted(() => ({
  binding: Object.freeze({
    version: 1 as const,
    bindingId: 'binding-a',
    binding: Object.freeze({ projectId: 'p', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 3 }),
    webContentsId: 1,
    processId: 10,
    frameRoutingId: 2,
    origin: 'file://',
    surfaceInstanceId: 'surface-a',
    portRevision: 4,
    nonce: 'nonce-a',
  }),
}))
import { openDesktopAgentsChatStream, type AgentChatV2Session, type AgentsChatStreamEvent, type AgentsChatRequestDto } from './desktopAgentsChatStream'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const request = { prompt: 'hello', capability: 'canvas-chat', history: { kind: 'persistent', binding: { sessionKey: 'nomi:workbench:p:generation', threadId: 'thread' } } } as AgentsChatRequestDto
function bridge() {
  let listener: ((event: unknown) => void) | undefined
  const ack = deferred<{ sessionId: string }>()
  const unsubscribe = vi.fn()
  const agents = {
    chatV2Start: vi.fn(() => ack.promise), confirmTool: vi.fn(async () => ({ ok: true })),
    cancelChatV2: vi.fn(async () => ({ ok: true })),
    onChatV2Event: vi.fn((_id: string, callback: (event: unknown) => void) => { listener = callback; return unsubscribe }),
  }
  ;(globalThis as unknown as { window: unknown }).window = { nomiDesktop: { agents } }
  return { agents, ack, unsubscribe, emit: (event: unknown) => listener?.(event) }
}
const result = (status = 'finished') => ({ id: 'result', text: 'completed text', status,
  finishReason: status === 'cancelled' ? 'aborted' : 'stop', toolCalls: [], artifacts: [],
  usage: { promptTokens: 4, completionTokens: 2, cachedPromptTokens: 1, totalTokens: 6 },
  ...(status === 'cancelled' ? { raw: { cancelled: true } } : {}) })
afterEach(() => { delete (globalThis as unknown as { window?: unknown }).window })

describe('desktop Agent stream admission and stable settlement', () => {
  it('subscribes and exposes the cancel handle synchronously before start ACK', async () => {
    const mock = bridge()
    let session: AgentChatV2Session | undefined
    const opening = openDesktopAgentsChatStream(
      request,
      { onEvent: () => {}, onSession: (value) => { session = value } },
      { surfaceBinding: surface.binding },
    )
    expect(mock.agents.onChatV2Event).toHaveBeenCalledOnce()
    expect(session).toBeDefined()
    expect(mock.agents.onChatV2Event.mock.invocationCallOrder[0]).toBeLessThan(mock.agents.chatV2Start.mock.invocationCallOrder[0]!)
    const id = session!.sessionId
    expect(mock.agents.chatV2Start).toHaveBeenCalledWith({ requestId: id, request, surfaceBinding: surface.binding })
    mock.ack.resolve({ sessionId: id })
    await opening
    mock.emit({ type: 'done', reason: 'finished' })
  })

  it('transports only the opaque captured snapshot admission for production', async () => {
    const mock = bridge()
    const capturedCanvasReadSnapshot = Object.freeze({
      version: 1 as const,
      handleId: 'captured-a',
      nonce: 'captured-nonce-a',
    })
    let session: AgentChatV2Session | undefined
    const opening = openDesktopAgentsChatStream(
      request,
      { onEvent: () => {}, onSession: (value) => { session = value } },
      { capturedCanvasReadSnapshot },
    )

    expect(mock.agents.chatV2Start).toHaveBeenCalledWith({
      requestId: session!.sessionId,
      request,
      capturedCanvasReadSnapshot,
    })
    mock.ack.resolve({ sessionId: session!.sessionId })
    await opening
    mock.emit({ type: 'done', reason: 'finished' })
  })

  it('does not lose content/tool/result/done before ACK or revive a completed request on late ACK', async () => {
    const mock = bridge()
    const events: AgentsChatStreamEvent[] = []
    let session: AgentChatV2Session | undefined
    const opening = openDesktopAgentsChatStream(request, { onEvent: (event) => events.push(event), onSession: (value) => { session = value } })
    mock.emit({ type: 'content-delta', delta: 'early' })
    mock.emit({ type: 'tool-call-pending', toolCallId: 'c', toolName: 'read_canvas_state', args: {} })
    mock.emit({ type: 'result', result: { ...result(), snapshot: 'MUST NOT CROSS', model: { apiKey: 'secret' } } })
    mock.emit({ type: 'done', reason: 'finished' })
    expect(events.map((event) => event.event)).toEqual(['initial', 'content', 'tool-call', 'result', 'done'])
    const publicResult = events.find((event) => event.event === 'result')
    expect(JSON.stringify(publicResult)).not.toContain('MUST NOT CROSS')
    expect(JSON.stringify(publicResult)).not.toContain('secret')
    mock.ack.resolve({ sessionId: session!.sessionId })
    await opening
    mock.emit({ type: 'content-delta', delta: 'late' })
    expect(events.filter((event) => event.event === 'content')).toHaveLength(1)
    expect(mock.unsubscribe).toHaveBeenCalledOnce()
  })

  it('early repeated Stop requests real cancellation and waits for actual cancelled usage', async () => {
    const mock = bridge()
    const events: AgentsChatStreamEvent[] = []
    let session: AgentChatV2Session | undefined
    const opening = openDesktopAgentsChatStream(request, { onEvent: (event) => events.push(event), onSession: (value) => { session = value } })
    expect(session).toBeDefined()
    await session!.cancel()
    await session!.cancel()
    expect(mock.agents.cancelChatV2).toHaveBeenCalledOnce()
    expect(mock.unsubscribe).not.toHaveBeenCalled()
    expect(events.some((event) => event.event === 'done')).toBe(false)
    mock.emit({ type: 'result', result: result('cancelled') })
    mock.emit({ type: 'done', reason: 'cancelled' })
    expect(events.at(-1)).toEqual({ event: 'done', data: { reason: 'cancelled' } })
    expect(events.find((event) => event.event === 'result')).toMatchObject({ data: { response: { usage: { totalTokens: 6 }, status: 'cancelled' } } })
    mock.ack.resolve({ sessionId: session!.sessionId })
    await opening
    expect(mock.unsubscribe).toHaveBeenCalledOnce()
  })

  it('remembers Stop from the synchronous onSession callback until start has been dispatched', async () => {
    const mock = bridge()
    let id = ''
    const opening = openDesktopAgentsChatStream(request, { onEvent: () => {}, onSession: (session) => { id = session.sessionId; void session.cancel() } })
    expect(mock.agents.chatV2Start).toHaveBeenCalledOnce()
    expect(mock.agents.cancelChatV2).toHaveBeenCalledWith(id)
    expect(mock.agents.chatV2Start.mock.invocationCallOrder[0]).toBeLessThan(mock.agents.cancelChatV2.mock.invocationCallOrder[0]!)
    mock.emit({ type: 'result', result: result('cancelled') })
    mock.emit({ type: 'done', reason: 'cancelled' })
    mock.ack.resolve({ sessionId: id })
    await opening
  })

  it('start failure settles once and removes the early subscription', async () => {
    const mock = bridge()
    const events: AgentsChatStreamEvent[] = []
    const opening = openDesktopAgentsChatStream(request, { onEvent: (event) => events.push(event) })
    mock.ack.reject(new Error('start failed'))
    await opening
    expect(events.filter((event) => event.event === 'done')).toEqual([{ event: 'done', data: { reason: 'error' } }])
    expect(mock.unsubscribe).toHaveBeenCalledOnce()
  })

  it('compaction warnings do not terminate or become user errors', async () => {
    const mock = bridge()
    const events: AgentsChatStreamEvent[] = []
    const onError = vi.fn()
    const opening = openDesktopAgentsChatStream(request, { onEvent: (event) => events.push(event), onError })
    mock.emit({ type: 'warning', error: { kind: 'http', message: 'summary failed', status: 503 } })
    expect(onError).not.toHaveBeenCalled()
    expect(events.some((event) => event.event === 'error' || event.event === 'done')).toBe(false)
    mock.emit({ type: 'result', result: result() })
    mock.emit({ type: 'done', reason: 'finished' })
    mock.ack.resolve({ sessionId: mock.agents.onChatV2Event.mock.calls[0]?.[0] ?? '' })
    await opening
  })

  it('keeps the structured credential code on the renderer error event', async () => {
    const mock = bridge()
    const events: AgentsChatStreamEvent[] = []
    const opening = openDesktopAgentsChatStream(request, { onEvent: (event) => events.push(event) })
    mock.emit({ type: 'error', message: 'Text model credential is locked', code: 'text_model_credential_locked' })
    expect(events.at(-1)).toEqual({ event: 'error', data: {
      message: 'Text model credential is locked', code: 'text_model_credential_locked',
    } })
    mock.emit({ type: 'done', reason: 'error' })
    mock.ack.resolve({ sessionId: mock.agents.onChatV2Event.mock.calls[0]?.[0] ?? '' })
    await opening
  })
})
