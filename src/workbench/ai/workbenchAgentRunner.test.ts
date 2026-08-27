import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentChatV2Session, AgentsChatResponseDto, AgentsChatStreamEvent } from '../../api/desktopClient'
import type { WorkbenchAiStreamHandlers } from './workbenchAiClient'
import type { ToolCallEvent } from './workbenchAgentRunner'
const deps = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('./workbenchAiClient', () => ({ sendWorkbenchAiMessage: deps.send }))
vi.mock('./assistantModelPref', () => ({ getAssistantModelPref: () => null }))
import { runWorkbenchAgent } from './workbenchAgentRunner'

beforeEach(() => vi.clearAllMocks())

function start() {
  let wire!: WorkbenchAiStreamHandlers
  let finish!: (response: AgentsChatResponseDto) => void
  let reject!: (error: Error) => void
  let cancel!: () => void
  const calls: ToolCallEvent[] = []
  const confirmTool = vi.fn<AgentChatV2Session['confirmTool']>(async () => {})
  const onToolError = vi.fn()
  deps.send.mockImplementationOnce((_input, handlers: WorkbenchAiStreamHandlers) => {
    wire = handlers
    wire.onSession?.({ sessionId: 'session', cancel: async () => {}, confirmTool })
    return new Promise<AgentsChatResponseDto>((resolve, fail) => { finish = resolve; reject = fail })
  })
  const result = runWorkbenchAgent({ prompt: 'p', displayPrompt: 'p', capability: 'canvas-agent', history: { kind: 'ephemeral' },
    skillKey: 'method', skillName: 'Method', onToolCall: (call) => { calls.push(call) }, onToolError,
    onCancelReady: (stop) => { cancel = stop },
  })
  const emit = (event: AgentsChatStreamEvent) => wire.onEvent?.(event)
  const call = (id: string) => emit({ event: 'tool-call', data: { sessionId: 'session', toolCallId: id, toolName: 'set_node_prompt', args: {} } })
  const complete = async () => {
    finish({ id: 'response', status: 'finished', text: '', toolCalls: [], artifacts: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0 } })
    await result
  }
  return { calls, call, emit, cancel: () => cancel(), complete, reject, result, confirmTool, onToolError }
}

describe('shared Agent tool-call lifetime', () => {
  it.each(['tool-error', 'tool-result'] as const)('%s expires only the matching call before the turn settles', async (event) => {
    const session = start()
    session.call('expired')
    session.call('live')
    session.emit(event === 'tool-error'
      ? { event, data: { toolCallId: 'expired', toolName: 'set_node_prompt', message: 'confirmation timed out' } }
      : { event, data: { toolCallId: 'expired', toolName: 'set_node_prompt', result: {} } })
    expect(session.calls[0].isPending()).toBe(false)
    expect(session.calls[1].isPending()).toBe(true)
    await expect(session.calls[0].confirm({ ok: true })).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.confirmTool).not.toHaveBeenCalled()
    await session.complete()
  })

  it('confirmation claims the call synchronously so duplicate approvals cannot be transported', async () => {
    const session = start()
    session.call('once')
    const first = session.calls[0].confirm({ ok: true })
    const second = session.calls[0].confirm({ ok: true })
    await first
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.calls[0].isPending()).toBe(false)
    expect(session.confirmTool).toHaveBeenCalledTimes(1)
    await session.complete()
  })

  it('an obsolete same-ID callback cannot settle or remove its replacement call', async () => {
    const session = start()
    session.call('same-id')
    session.call('same-id')
    expect(session.calls[0].isPending()).toBe(false)
    expect(session.calls[1].isPending()).toBe(true)
    await expect(session.calls[0].confirm({ ok: false })).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.calls[1].isPending()).toBe(true)
    await session.calls[1].confirm({ ok: true })
    expect(session.confirmTool).toHaveBeenCalledExactlyOnceWith('same-id', { ok: true })
    await session.complete()
  })

  it.each(['stop', 'done', 'error', 'resolve', 'reject'] as const)('%s expires pending calls even without a panel cleanup callback', async (action) => {
    const session = start()
    session.call('pending')
    if (action === 'stop') session.cancel()
    else if (action === 'done') session.emit({ event: 'done', data: { reason: 'finished' } })
    else if (action === 'error') session.emit({ event: 'error', data: { message: 'terminal failure' } })
    else if (action === 'resolve') await session.complete()
    else {
      const rejected = expect(session.result).rejects.toThrow('transport failed')
      session.reject(new Error('transport failed'))
      await rejected
    }
    expect(session.calls[0].isPending()).toBe(false)
    await expect(session.calls[0].confirm({ ok: true })).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.confirmTool).not.toHaveBeenCalled()
    if (action !== 'resolve' && action !== 'reject') await session.complete()
  })
})
