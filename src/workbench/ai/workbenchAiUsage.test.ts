import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentsChatStreamHandlers } from '../../api/desktopAgentsChatStream'
import type { WorkbenchAiRequest } from './workbenchAiClient'
const state = vi.hoisted(() => ({ stream: vi.fn() }))
vi.mock('../../api/desktopClient', () => ({ workbenchAgentsChatStream: state.stream }))
vi.mock('./assistantModelPref', () => ({ getAssistantModelPref: () => null }))
import { sendWorkbenchAiMessage } from './workbenchAiClient'
import { runWorkbenchAgent } from './workbenchAgentRunner'
import { useAgentUsageStore } from './agentUsageStore'

const input = { prompt: 'p', displayPrompt: 'd', skillKey: 'skill', skillName: 'Skill',
  capability: 'canvas-chat', history: { kind: 'ephemeral' } } as WorkbenchAiRequest
let handlers: AgentsChatStreamHandlers
const usage = { promptTokens: 10, completionTokens: 4, cachedPromptTokens: 3, totalTokens: 14 }
beforeEach(() => {
  useAgentUsageStore.getState().reset()
  state.stream.mockImplementation(async (_input, next: AgentsChatStreamHandlers) => { handlers = next; return () => {} })
})
function complete(status: 'finished' | 'cancelled' | 'error') {
  handlers.onEvent({ event: 'result', data: { response: { id: 'r', text: 'actual', status, usage,
    finishReason: status === 'cancelled' ? 'aborted' : 'stop', toolCalls: [], artifacts: [] } } })
  handlers.onEvent({ event: 'done', data: { reason: status } })
}

describe('one usage sink at the common Agent client', () => {
  it('observer failure cannot suppress final bookkeeping, cancellation status or actual usage', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const request = sendWorkbenchAiMessage(input, { onEvent: () => { throw new Error('view is gone') } })
    expect(() => complete('cancelled')).not.toThrow()
    expect(await request).toMatchObject({ status: 'cancelled', text: 'actual' })
    expect(useAgentUsageStore.getState()).toMatchObject({ turns: 1, totalTokens: 14 })
    warn.mockRestore()
  })

  it.each(['finished', 'cancelled'] as const)('counts direct/single-shot %s consumption exactly once', async (status) => {
    const request = sendWorkbenchAiMessage(input, {})
    complete(status)
    expect(await request).toMatchObject({ status })
    expect(useAgentUsageStore.getState()).toMatchObject({ turns: 1, promptTokens: 10, completionTokens: 4, totalTokens: 14 })
  })
  it('waits past an error event for the actual result usage before rejecting on done', async () => {
    let rejected = false
    const request = sendWorkbenchAiMessage(input, {}).catch((error: Error) => { rejected = true; return error })
    handlers.onEvent({ event: 'error', data: { message: 'vendor failed after consuming tokens' } })
    await Promise.resolve(); await Promise.resolve()
    expect(rejected).toBe(false)
    complete('error')
    expect(await request).toMatchObject({ message: 'vendor failed after consuming tokens' })
    expect(useAgentUsageStore.getState()).toMatchObject({ turns: 1, totalTokens: 14 })
  })
  it('the common tool runner does not add the same final usage a second time', async () => {
    const request = runWorkbenchAgent(input)
    complete('finished')
    await request
    expect(useAgentUsageStore.getState()).toMatchObject({ turns: 1, totalTokens: 14 })
  })
  it('the runner delivers a matching tool error before the turn finishes so its approval can expire', async () => {
    const onToolError = vi.fn()
    const requestInput = { ...input, onToolError }
    const request = runWorkbenchAgent(requestInput)
    const expired = { toolCallId: 'expired-tool', toolName: 'append_to_end', message: 'confirmation timed out', denied: true }
    handlers.onEvent({ event: 'tool-error', data: expired })
    const beforeDone = onToolError.mock.calls.slice()
    complete('finished')
    await request
    expect(beforeDone).toEqual([[expired]])
    expect(onToolError).toHaveBeenCalledTimes(1)
    expect(useAgentUsageStore.getState()).toMatchObject({ turns: 1, totalTokens: 14 })
  })
  it('a caller without a tool handler explicitly denies instead of waiting ten minutes', async () => {
    const confirmTool = vi.fn(async () => {})
    const request = runWorkbenchAgent(input)
    handlers.onSession?.({ sessionId: 's', cancel: async () => {}, confirmTool })
    handlers.onEvent({ event: 'tool-call', data: { sessionId: 's', toolCallId: 'call', toolName: 'set_node_prompt', args: {} } })
    expect(confirmTool).toHaveBeenCalledWith('call', expect.objectContaining({ ok: false, denied: true }))
    complete('finished'); await request
  })
  it('a failing tool-view callback consumes a raced confirmation rejection without losing the final result', async () => {
    const confirmTool = vi.fn(async () => { throw new Error('confirmation already settled') })
    const request = runWorkbenchAgent({ ...input, onToolCall: async () => { throw new Error('view failed') } })
    handlers.onSession?.({ sessionId: 's', cancel: async () => {}, confirmTool })
    handlers.onEvent({ event: 'tool-call', data: { sessionId: 's', toolCallId: 'call', toolName: 'set_node_prompt', args: {} } })
    await vi.waitFor(() => expect(confirmTool).toHaveBeenCalledWith('call', { ok: false, message: 'view failed' }))
    complete('cancelled')
    expect(await request).toMatchObject({ status: 'cancelled' })
    expect(useAgentUsageStore.getState()).toMatchObject({ turns: 1, totalTokens: 14 })
  })
})
