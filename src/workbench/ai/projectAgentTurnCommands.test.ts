import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectAgentExecutionEvent, ProjectAgentHostState } from '../../../electron/shared/projectAgentContracts'
import { createInitialProjectAgentState } from '../../../electron/projectAgentHost/projectAgentState'

const deps = vi.hoisted(() => ({
  command: vi.fn(),
  onEvent: vi.fn(() => () => undefined),
  state: null as null | { subscriptionId: string; subscriptionEpoch: number; snapshot: ProjectAgentHostState },
  applySnapshot: vi.fn(),
}))

vi.mock('./projectAgentClient', () => ({
  projectAgentClient: {
    command: deps.command,
    onEvent: deps.onEvent,
  },
}))
vi.mock('./projectAgentProjectionStore', () => ({
  projectAgentProjectionStore: {
    getState: () => deps.state,
    applySnapshot: deps.applySnapshot,
  },
}))

import {
  decideProjectAgentTool,
  enqueueProjectAgentTurn,
  stopProjectAgentTurn,
  subscribeProjectAgentEvents,
} from './projectAgentTurnCommands'
import * as projectAgentTurnCommands from './projectAgentTurnCommands'

const binding = {
  projectId: 'turn-command-project',
  immutableProjectUuid: '11111111-1111-4111-8111-111111111111',
  projectGeneration: 1,
} as const

beforeEach(() => {
  deps.command.mockReset()
  deps.onEvent.mockClear()
  deps.applySnapshot.mockReset()
  const snapshot = createInitialProjectAgentState(binding)
  deps.state = { subscriptionId: 'subscription-a', subscriptionEpoch: 1, snapshot }
  deps.command.mockImplementation(async (command: { type: string }) => ({
    state: { ...snapshot, hostRevision: snapshot.hostRevision + 1 },
    patch: null,
    replayed: false,
    command,
  }))
})

describe('ProjectAgent turn commands', () => {
  it('enqueues a canonical turn with an explicit target and ephemeral model history', async () => {
    const result = await enqueueProjectAgentTurn({
      turnId: 'turn-from-caller',
      request: {
        prompt: 'rewrite this',
        capability: 'creation-editor',
        history: { kind: 'ephemeral' },
        projectId: binding.projectId,
        skillKey: 'workbench.creation.general',
      },
      displayPrompt: 'rewrite this',
      attachmentClaims: [
        {
          assetId: 'asset-a',
          version: 1,
        },
      ],
      target: { kind: 'document', documentId: 'document-1', anchor: { kind: 'whole-document' } },
      originSurface: { surfaceId: 'creation-ai-panel', kind: 'document' },
    })

    const command = deps.command.mock.calls[0][0]
    expect(command.type).toBe('turn.enqueue')
    expect(command.payload.request.history).toEqual({ kind: 'ephemeral' })
    expect(command.payload.thread.threadId).toMatch(/^thread-/)
    expect(command.payload.queueItem.target).toEqual({
      kind: 'document',
      documentId: 'document-1',
      anchor: { kind: 'whole-document' },
    })
    expect(command.payload.queueItem.attachmentRefs).toEqual([])
    expect(command.payload.attachmentClaims).toEqual([{ assetId: 'asset-a', version: 1 }])
    expect(result.turnId).toBe('turn-from-caller')
    expect(command.payload.turn.turnId).toBe('turn-from-caller')
    expect(deps.applySnapshot).toHaveBeenCalledTimes(1)
  })

  it('routes tool decisions and stop through semantic Host mutations', async () => {
    await decideProjectAgentTool({ turnId: 'turn-a', toolCallId: 'call-a', decision: { ok: false, message: 'no' } })
    await stopProjectAgentTurn('turn-a')
    expect(deps.command.mock.calls.map(([command]) => command.type)).toEqual(['tool.decision', 'turn.transition'])
    expect(deps.command.mock.calls[1][0].payload).toMatchObject({ turnId: 'turn-a', status: 'stopped' })
  })

  it('installs one filtered execution-event adapter without creating a second state owner', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeProjectAgentEvents(listener)
    expect(deps.onEvent).toHaveBeenCalledTimes(1)
    expect((deps.onEvent.mock.calls as unknown[][])[0]?.[0]).not.toBe(listener)
    unsubscribe()
  })

  it('P2B-EVENT-001 accepts only the current epoch, active thread, and execution token', () => {
    const timestamp = '2026-08-29T00:00:00.000Z'
    const thread = { threadId: 'thread-a', createdAt: timestamp, updatedAt: timestamp } as const
    const snapshot = {
      ...createInitialProjectAgentState(binding),
      activeThreadId: thread.threadId,
      threads: [thread],
      turns: [
        {
          turnId: 'turn-same',
          threadId: thread.threadId,
          executionToken: 'execution-current',
          model: { id: 'model-a', version: 1 },
          skillVersions: [],
          capabilityVersions: [],
          contextRef: {
            binding: {
              project: binding,
              threadId: thread.threadId,
              sessionKey: 'nomi:project-agent:11111111-1111-4111-8111-111111111111:g1' as const,
            },
            contextRevision: 0,
            recordId: 'context-a',
          },
          status: 'running' as const,
          retryable: false,
          deviated: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }
    deps.state = { subscriptionId: 'subscription-current', subscriptionEpoch: 7, snapshot } as never
    const listener = vi.fn()
    subscribeProjectAgentEvents(listener)
    const transportListener = (deps.onEvent.mock.calls as unknown[][])[0]?.[0] as
      | ((event: ProjectAgentExecutionEvent) => void)
      | undefined
    expect(transportListener).toBeTypeOf('function')
    if (!transportListener) throw new Error('event transport listener was not installed')
    const event = {
      type: 'tool-call' as const,
      subscriptionId: 'subscription-current',
      subscriptionEpoch: 7,
      binding,
      turnId: 'turn-same',
      executionToken: 'execution-current',
      toolCallId: 'tool-a',
      toolName: 'read_full_text',
      args: {},
    }

    transportListener({ ...event, subscriptionEpoch: 6 })
    transportListener({ ...event, executionToken: 'execution-old' })
    transportListener({ ...event, subscriptionId: 'subscription-old' })
    expect(listener).not.toHaveBeenCalled()

    transportListener(event)
    expect(listener).toHaveBeenCalledExactlyOnceWith(event)
  })

  it('P2B-THREAD-001/002 hides another thread without deciding it and restores only a live Host turn', () => {
    const createRegistry = (
      projectAgentTurnCommands as unknown as {
        createProjectAgentPendingToolRegistry?: <T>() => {
          install(event: unknown, value: T): void
          select(state: unknown, surfaceKind: 'document' | 'canvas'): readonly T[]
        }
      }
    ).createProjectAgentPendingToolRegistry
    expect(createRegistry).toBeTypeOf('function')
    const registry = createRegistry!<{ turnId: string; toolCallId: string }>()
    const timestamp = '2026-08-29T00:00:00.000Z'
    const thread = (threadId: string) => ({ threadId, createdAt: timestamp, updatedAt: timestamp })
    const turn = (threadId: string, status: 'running' | 'done') => ({
      turnId: 'turn-a',
      threadId,
      executionToken: 'execution-a',
      model: { id: 'model-a', version: 1 },
      skillVersions: [],
      capabilityVersions: [],
      contextRef: {
        binding: {
          project: binding,
          threadId,
          sessionKey: 'nomi:project-agent:11111111-1111-4111-8111-111111111111:g1' as const,
        },
        contextRevision: 0,
        recordId: `context-${threadId}`,
      },
      status,
      retryable: false,
      deviated: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const projection = (activeThreadId: string, status: 'running' | 'done') => ({
      binding,
      subscriptionId: 'subscription-a',
      subscriptionEpoch: 3,
      lastError: null,
      snapshot: {
        ...createInitialProjectAgentState(binding),
        activeThreadId,
        threads: [thread('thread-a'), thread('thread-b')],
        turns: [turn('thread-a', status)],
        queue: [
          {
            queueItemId: 'queue-a',
            threadId: 'thread-a',
            turnId: 'turn-a',
            binding,
            target: { kind: 'document', documentId: 'document-a', anchor: { kind: 'whole-document' } },
            preconditions: {},
            contextRef: turn('thread-a', status).contextRef,
            model: { id: 'model-a', version: 1 },
            skillVersions: [],
            capabilityVersions: [],
            policyRevision: 1,
            attachmentRefs: [],
            originSurface: { surfaceId: 'creation-ai-panel', kind: 'document' },
            enqueuedAt: timestamp,
            status,
            retryable: false,
            deviated: false,
            updatedAt: timestamp,
          },
        ],
      },
    })
    const event = {
      type: 'tool-call',
      subscriptionId: 'subscription-a',
      subscriptionEpoch: 3,
      binding,
      turnId: 'turn-a',
      executionToken: 'execution-a',
      toolCallId: 'tool-a',
      toolName: 'append_to_end',
      args: {},
    }
    const pending = { turnId: 'turn-a', toolCallId: 'tool-a' }
    registry.install(event, pending)

    expect(registry.select(projection('thread-a', 'running'), 'document')).toEqual([pending])
    expect(registry.select(projection('thread-b', 'running'), 'document')).toEqual([])
    expect(registry.select(projection('thread-a', 'running'), 'document')).toEqual([pending])
    expect(registry.select(projection('thread-a', 'done'), 'document')).toEqual([])
  })
})
