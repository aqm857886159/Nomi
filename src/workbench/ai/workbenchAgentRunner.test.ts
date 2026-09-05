import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentsChatResponseDto } from '../../api/desktopClient'
import type {
  ProjectAgentExecutionEvent,
  ProjectAgentExecutionEventPayload,
  ProjectAgentHostState,
  ProjectAgentStatus,
} from '../../../electron/shared/projectAgentContracts'
import { createInitialProjectAgentState } from '../../../electron/projectAgentHost/projectAgentState'
import { createProjectAgentContextBinding } from '../../../electron/projectAgentHost/projectAgentContextBinding'
import type { ToolCallEvent } from './workbenchAgentRunner'
import { buildResidentContextSnapshot } from './resident/residentContextSnapshot'

const deps = vi.hoisted(() => ({
  enqueue: vi.fn(),
  decide: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  eventListeners: new Set<(event: ProjectAgentExecutionEvent) => void>(),
  stateListeners: new Set<() => void>(),
  state: null as null | {
    binding: ProjectAgentHostState['binding']
    subscriptionId: string
    snapshot: ProjectAgentHostState
    lastError: string | null
  },
}))

vi.mock('./projectAgentTurnCommands', () => ({
  enqueueProjectAgentTurn: deps.enqueue,
  decideProjectAgentTool: deps.decide,
  stopProjectAgentTurn: deps.stop,
  subscribeProjectAgentEvents: (listener: (event: ProjectAgentExecutionEvent) => void) => {
    deps.eventListeners.add(listener)
    return () => deps.eventListeners.delete(listener)
  },
}))
vi.mock('./projectAgentProjectionStore', () => ({
  projectAgentProjectionStore: {
    getState: () => deps.state,
    subscribe: (listener: () => void) => {
      deps.stateListeners.add(listener)
      return () => deps.stateListeners.delete(listener)
    },
  },
}))
vi.mock('./assistantModelPref', () => ({ getAssistantModelPref: () => null }))

import { useAgentUsageStore } from './agentUsageStore'
import { runWorkbenchAgent } from './workbenchAgentRunner'

const binding = {
  projectId: 'project-a',
  immutableProjectUuid: '11111111-1111-4111-8111-111111111111',
  projectGeneration: 1,
} as const
const timestamp = '2026-08-29T00:00:00.000Z'

function snapshotFor(turnId?: string, status: ProjectAgentStatus = 'queued', text = ''): ProjectAgentHostState {
  const initial = createInitialProjectAgentState(binding)
  if (!turnId) return initial
  const threadId = 'thread-a'
  const contextRef = {
    binding: createProjectAgentContextBinding(binding, threadId),
    contextRevision: 0,
    recordId: 'context-a',
  } as const
  const assistantStatus =
    status === 'done' ? 'done' : status === 'failed' ? 'failed' : status === 'stopped' ? 'stopped' : 'running'
  return {
    ...initial,
    hostRevision: 2,
    commandLedgerHighWater: 2,
    activeThreadId: threadId,
    threads: [{ threadId, createdAt: timestamp, updatedAt: timestamp }],
    turns: [
      {
        turnId,
        threadId,
        executionToken: 'execution-a',
        model: { id: 'model', version: 1 },
        skillVersions: [],
        capabilityVersions: [{ id: 'canvas-agent', version: 1 }],
        contextRef,
        status,
        retryable: false,
        deviated: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    items:
      status === 'queued'
        ? []
        : [
            {
              itemId: 'assistant-a',
              threadId,
              turnId,
              kind: 'assistant',
              text,
              textRevision: text.length,
              status: assistantStatus,
              retryable: status === 'failed',
              deviated: false,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
  }
}

function publish(snapshot: ProjectAgentHostState): void {
  deps.state = { binding, subscriptionId: 'subscription-a', snapshot, lastError: null }
  for (const listener of deps.stateListeners) listener()
}

function emit(event: ProjectAgentExecutionEventPayload): void {
  const transportEvent = {
    ...event,
    subscriptionId: 'subscription-a',
    subscriptionEpoch: 1,
  } as ProjectAgentExecutionEvent
  for (const listener of deps.eventListeners) listener(transportEvent)
}

function response(overrides: Partial<AgentsChatResponseDto> = {}): AgentsChatResponseDto {
  return {
    id: 'runtime-response',
    status: 'finished',
    text: 'runtime text',
    toolCalls: [],
    artifacts: [],
    usage: { promptTokens: 5, completionTokens: 3, cachedPromptTokens: 1, totalTokens: 8 },
    finishReason: 'stop',
    ...overrides,
  }
}

function finish(turnId: string, status: ProjectAgentStatus, result?: AgentsChatResponseDto, text = 'host text'): void {
  publish(snapshotFor(turnId, status, text))
  if (result) emit({ type: 'execution-result', binding, turnId, executionToken: 'execution-a', response: result })
}

const baseInput = {
  prompt: 'edit the canvas',
  displayPrompt: 'edit the canvas',
  capability: 'canvas-agent' as const,
  projectId: binding.projectId,
  skillKey: 'canvas.general',
  skillName: 'Canvas general',
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.eventListeners.clear()
  deps.stateListeners.clear()
  useAgentUsageStore.getState().reset()
  publish(createInitialProjectAgentState(binding))
  deps.enqueue.mockImplementation(async (input: { turnId: string }) => {
    const state = snapshotFor(input.turnId)
    publish(state)
    return { state, turnId: input.turnId, queueItemId: 'queue-a', userItemId: 'user-a' }
  })
})

describe('Project Agent workbench compatibility runner', () => {
  it('enqueues one Host-owned canvas turn and returns real runtime metadata with Host text', async () => {
    const running = runWorkbenchAgent({ ...baseInput, selectedNodeIds: ['node-a'] })
    const command = deps.enqueue.mock.calls[0][0]
    expect(command).toMatchObject({
      displayPrompt: baseInput.displayPrompt,
      target: { kind: 'canvas', nodeIds: ['node-a'] },
      originSurface: { kind: 'canvas' },
      request: {
        prompt: baseInput.prompt,
        capability: 'canvas-agent',
        projectId: binding.projectId,
      },
    })
    expect(command.turnId).toMatch(/^turn-workbench-/)

    finish(command.turnId, 'done', response())
    await expect(running).resolves.toMatchObject({
      id: command.turnId,
      status: 'finished',
      text: 'host text',
      finishReason: 'stop',
      usage: { totalTokens: 8 },
    })
    expect(useAgentUsageStore.getState()).toMatchObject({ turns: 1, totalTokens: 8 })
  })

  it('preserves an explicit surface target instead of inventing a document or canvas target', async () => {
    const running = runWorkbenchAgent({
      ...baseInput,
      capability: 'canvas-chat',
      toolProfile: 'timeline',
      target: { kind: 'timeline', clipIds: ['clip-a'] },
      preconditions: { timeline: { revision: 'timeline-rev-1' } },
      originSurface: { surfaceId: 'project-agent-resident', kind: 'preview' },
    })
    const command = deps.enqueue.mock.calls[0][0]
    expect(command).toMatchObject({
      request: { toolProfile: 'timeline' },
      target: { kind: 'timeline', clipIds: ['clip-a'] },
      preconditions: { timeline: { revision: 'timeline-rev-1' } },
      originSurface: { surfaceId: 'project-agent-resident', kind: 'preview' },
    })
    finish(command.turnId, 'done', response())
    await expect(running).resolves.toMatchObject({ status: 'finished' })
  })

  it('streams Assistant Item revisions from the shared projection', async () => {
    const onContent = vi.fn()
    const running = runWorkbenchAgent({ ...baseInput, onContent })
    const turnId = deps.enqueue.mock.calls[0][0].turnId
    publish(snapshotFor(turnId, 'running', 'hel'))
    publish(snapshotFor(turnId, 'running', 'hello'))
    expect(onContent.mock.calls).toEqual([
      ['hel', 'hel'],
      ['lo', 'hello'],
    ])
    finish(turnId, 'done', response({ text: 'hello' }), 'hello')
    await running
  })

  it('claims a confirmation synchronously so duplicate approvals cannot cross IPC', async () => {
    const calls: ToolCallEvent[] = []
    const running = runWorkbenchAgent({
      ...baseInput,
      onToolCall: (call) => {
        calls.push(call)
      },
    })
    const turnId = deps.enqueue.mock.calls[0][0].turnId
    const assistantTextAnchor = Object.freeze({ itemId: 'assistant-a', textOffset: 12 })
    emit({
      type: 'tool-call',
      binding,
      turnId,
      executionToken: 'execution-a',
      toolCallId: 'call-a',
      toolName: 'set_node_prompt',
      args: { nodeId: 'node-a' },
      assistantTextAnchor,
    })
    expect(calls[0]).toMatchObject({ turnId, assistantTextAnchor })
    expect(calls[0].assistantTextAnchor).toBe(assistantTextAnchor)
    const first = calls[0].confirm({ ok: true, result: { applied: true } })
    const second = calls[0].confirm({ ok: true })
    await first
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(deps.decide).toHaveBeenCalledTimes(1)
    finish(turnId, 'done', response())
    await running
  })

  it('makes an obsolete same-ID callback unable to settle its replacement', async () => {
    const calls: ToolCallEvent[] = []
    const running = runWorkbenchAgent({
      ...baseInput,
      onToolCall: (call) => {
        calls.push(call)
      },
    })
    const turnId = deps.enqueue.mock.calls[0][0].turnId
    const event = {
      type: 'tool-call' as const,
      binding,
      turnId,
      executionToken: 'execution-a',
      toolCallId: 'same-id',
      toolName: 'set_node_prompt',
      args: {},
    }
    emit(event)
    emit(event)
    expect(calls[0].isPending()).toBe(false)
    expect(calls[1].isPending()).toBe(true)
    await expect(calls[0].confirm({ ok: false })).rejects.toMatchObject({ name: 'AbortError' })
    await calls[1].confirm({ ok: true })
    expect(deps.decide).toHaveBeenCalledExactlyOnceWith({ turnId, toolCallId: 'same-id', decision: { ok: true } })
    finish(turnId, 'done', response())
    await running
  })

  it('Stop invalidates pending calls and routes the terminal action through Host', async () => {
    const calls: ToolCallEvent[] = []
    let cancel!: () => void
    const running = runWorkbenchAgent({
      ...baseInput,
      onToolCall: (call) => {
        calls.push(call)
      },
      onCancelReady: (next) => {
        cancel = next
      },
    })
    const turnId = deps.enqueue.mock.calls[0][0].turnId
    await Promise.resolve()
    emit({
      type: 'tool-call',
      binding,
      turnId,
      executionToken: 'execution-a',
      toolCallId: 'pending',
      toolName: 'set_node_prompt',
      args: {},
    })
    cancel()
    expect(calls[0].isPending()).toBe(false)
    expect(deps.stop).toHaveBeenCalledExactlyOnceWith(turnId)
    finish(turnId, 'stopped', response({ status: 'cancelled', finishReason: 'aborted' }), '')
    await expect(running).resolves.toMatchObject({ status: 'cancelled', raw: { cancelled: true } })
  })

  it('expires failed tool cards from the terminal runtime result and cleans both subscriptions', async () => {
    const calls: ToolCallEvent[] = []
    const onToolError = vi.fn()
    const running = runWorkbenchAgent({
      ...baseInput,
      onToolCall: (call) => {
        calls.push(call)
      },
      onToolError,
    })
    const turnId = deps.enqueue.mock.calls[0][0].turnId
    emit({
      type: 'tool-call',
      binding,
      turnId,
      executionToken: 'execution-a',
      toolCallId: 'denied',
      toolName: 'set_node_prompt',
      args: {},
    })
    finish(
      turnId,
      'done',
      response({
        toolCalls: [
          {
            toolCallId: 'denied',
            toolName: 'set_node_prompt',
            args: {},
            status: 'denied',
            decision: { ok: false, denied: true, message: 'confirmation timed out' },
            error: 'confirmation timed out',
          },
        ],
      }),
    )
    await running
    expect(calls[0].isPending()).toBe(false)
    expect(onToolError).toHaveBeenCalledExactlyOnceWith({
      toolCallId: 'denied',
      toolName: 'set_node_prompt',
      message: 'confirmation timed out',
      denied: true,
    })
    expect(deps.eventListeners.size).toBe(0)
    expect(deps.stateListeners.size).toBe(0)
  })

  it('rejects a failed Host turn with the execution error and cleans subscriptions', async () => {
    const running = runWorkbenchAgent(baseInput)
    const turnId = deps.enqueue.mock.calls[0][0].turnId
    emit({ type: 'execution-error', binding, turnId, executionToken: 'execution-a', message: 'runtime failed' })
    publish(snapshotFor(turnId, 'failed', 'partial'))
    await expect(running).rejects.toThrow('runtime failed')
    expect(deps.eventListeners.size).toBe(0)
    expect(deps.stateListeners.size).toBe(0)
  })

  it('auto-denies a tool call when the caller has no tool handler', async () => {
    const running = runWorkbenchAgent(baseInput)
    const turnId = deps.enqueue.mock.calls[0][0].turnId
    emit({
      type: 'tool-call',
      binding,
      turnId,
      executionToken: 'execution-a',
      toolCallId: 'unhandled',
      toolName: 'set_node_prompt',
      args: {},
    })
    await Promise.resolve()
    expect(deps.decide).toHaveBeenCalledWith({
      turnId,
      toolCallId: 'unhandled',
      decision: { ok: false, denied: true, message: 'This request has no tool handler' },
    })
    finish(turnId, 'done', response())
    await running
    })
  })

  it('bridges the selected Skill into the canonical nested runtime context', async () => {
    const running = runWorkbenchAgent({
      ...baseInput,
      skillKey: 'craft.camera',
      skillName: 'Camera craft',
      selectedNodeIds: ['node-a'],
    })
    const command = deps.enqueue.mock.calls[0][0]
    expect(command.request).toMatchObject({
      skillKey: 'craft.camera',
      skillName: 'Camera craft',
      chatContext: { skill: { key: 'craft.camera', name: 'Camera craft' } },
    })
    finish(command.turnId, 'done', response())
    await expect(running).resolves.toMatchObject({ status: 'finished' })
  })

  it('bridges a frozen resident ContextSnapshot into the Host request', async () => {
    const contextSnapshot = buildResidentContextSnapshot({
      canvas: {
        revision: 4,
        nodes: [{ id: 'node-a', title: '开场', kind: 'image' }],
        selectedNodeIds: ['node-a'],
      },
    })
    const running = runWorkbenchAgent({ ...baseInput, contextSnapshot })
    const command = deps.enqueue.mock.calls[0][0]
    expect(command.request.contextSnapshot).toEqual(contextSnapshot)
    expect(Object.isFrozen(command.request.contextSnapshot)).toBe(true)
    expect(Object.isFrozen(command.request.contextSnapshot.handles[0])).toBe(true)
    finish(command.turnId, 'done', response())
    await expect(running).resolves.toMatchObject({ status: 'finished' })
  })
