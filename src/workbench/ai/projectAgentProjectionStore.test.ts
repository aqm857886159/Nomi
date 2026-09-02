import { describe, expect, it } from 'vitest'

import type { ProjectAgentHostState, ProjectAgentPatch } from '../../../electron/shared/projectAgentContracts'
import { createInitialProjectAgentState } from '../../../electron/projectAgentHost/projectAgentState'
import { createProjectAgentProjectionStore } from './projectAgentProjectionStore'
import { projectAgentThreadMessages } from './projectAgentUiProjection'

const binding = {
  projectId: 'projection-project',
  immutableProjectUuid: '11111111-1111-4111-8111-111111111111',
  projectGeneration: 1,
} as const
const now = '2026-08-28T00:00:00.000Z'

function state(): ProjectAgentHostState {
  return createInitialProjectAgentState(binding)
}

describe('ProjectAgent shared projection', () => {
  it('rejects a binding or revision gap and lets the caller fetch a snapshot', () => {
    const store = createProjectAgentProjectionStore()
    store.install('sub-a', 1, state())
    const patch = {
      binding,
      previousRevision: 1,
      hostRevision: 2,
      changes: [],
    } satisfies ProjectAgentPatch
    expect(store.applyPatch(patch)).toBe(false)
    expect(store.getState().snapshot?.hostRevision).toBe(0)
  })

  it('does not let an older command snapshot roll back newer host patches', () => {
    const store = createProjectAgentProjectionStore()
    const initial = state()
    store.install('sub-a', 1, initial)
    const newer = { ...initial, hostRevision: 2, commandLedgerHighWater: 2 }
    expect(store.applyPatch({ binding, previousRevision: 0, hostRevision: 2, changes: [] })).toBe(true)

    store.applySnapshot({ ...newer, hostRevision: 1, commandLedgerHighWater: 1 })

    expect(store.getState().snapshot?.hostRevision).toBe(2)
  })

  it('applies an atomic active-thread and assistant append patch', () => {
    const store = createProjectAgentProjectionStore()
    const initial = state()
    store.install('sub-a', 1, initial)
    const thread = { threadId: 'thread-a', createdAt: now, updatedAt: now } as const
    const turn = {
      turnId: 'turn-a',
      threadId: 'thread-a',
      status: 'running' as const,
      retryable: false,
      deviated: false,
      executionToken: 'execution-a',
      model: { id: 'model-a', version: 1 },
      skillVersions: [],
      capabilityVersions: [],
      contextRef: {
        binding: {
          project: binding,
          threadId: 'thread-a',
          sessionKey: 'nomi:project-agent:11111111-1111-4111-8111-111111111111:g1',
        },
        contextRevision: 0,
        recordId: 'context-a',
      },
      createdAt: now,
      updatedAt: now,
    } as const
    const assistant = {
      kind: 'assistant' as const,
      itemId: 'assistant-a',
      threadId: 'thread-a',
      turnId: 'turn-a',
      status: 'running' as const,
      retryable: false,
      deviated: false,
      text: 'hello',
      textRevision: 1,
      createdAt: now,
      updatedAt: now,
    } as const
    expect(store.applyPatch({
      binding,
      previousRevision: 0,
      hostRevision: 1,
      changes: [
        { kind: 'thread-upserted', thread },
        { kind: 'turn-upserted', turn },
        { kind: 'item-upserted', item: assistant },
        { kind: 'active-thread-changed', activeThreadId: 'thread-a' },
      ],
    })).toBe(true)
    const snapshot = store.getState().snapshot!
    expect(snapshot.hostRevision).toBe(1)
    expect(projectAgentThreadMessages(snapshot)).toMatchObject([
      { id: 'assistant-a', role: 'assistant', content: 'hello', status: 'streaming' },
    ])
  })

  it('derives attachment display and storyboard ownership from the canonical turn and queue', () => {
    const thread = { threadId: 'thread-a', createdAt: now, updatedAt: now } as const
    const contextRef = {
      binding: {
        project: binding,
        threadId: thread.threadId,
        sessionKey: 'nomi:project-agent:11111111-1111-4111-8111-111111111111:g1' as const,
      },
      contextRevision: 0,
      recordId: 'context-a',
    }
    const turn = {
      turnId: 'turn-a', threadId: thread.threadId, executionToken: 'execution-a',
      model: { id: 'model-a', version: 1 },
      skillVersions: [{ id: 'workbench.storyboard.planner', version: 1 }],
      capabilityVersions: [{ id: 'storyboard', version: 1 }], contextRef,
      status: 'done' as const, retryable: false, deviated: false, createdAt: now, updatedAt: now,
    }
    const user = {
      kind: 'user' as const, itemId: 'user-a', threadId: thread.threadId, turnId: turn.turnId,
      text: '拆成镜头', status: 'done' as const, retryable: false, deviated: false, createdAt: now, updatedAt: now,
    }
    const assistant = {
      kind: 'assistant' as const, itemId: 'assistant-a', threadId: thread.threadId, turnId: turn.turnId,
      text: '方案已生成', textRevision: 1, status: 'done' as const, retryable: false, deviated: false,
      createdAt: now, updatedAt: now,
    }
    const queue = {
      queueItemId: 'queue-a', threadId: thread.threadId, turnId: turn.turnId, binding,
      target: { kind: 'canvas' as const, nodeIds: [] }, preconditions: {}, contextRef,
      model: turn.model, skillVersions: turn.skillVersions, capabilityVersions: turn.capabilityVersions,
      policyRevision: 1,
      attachmentRefs: [{
        assetId: 'asset-a', contentHash: 'a'.repeat(64), version: 1,
        display: {
          url: 'nomi-local://asset/projection-project/assets/imported/reference.png',
          fileName: 'reference.png', contentType: 'image/png', sizeBytes: 42, kind: 'image' as const,
        },
      }],
      originSurface: { surfaceId: 'canvas-panel', kind: 'canvas' as const }, enqueuedAt: now,
      status: 'done' as const, retryable: false, deviated: false, updatedAt: now,
    }
    const snapshot = {
      ...state(), activeThreadId: thread.threadId, threads: [thread], turns: [turn], items: [user, assistant], queue: [queue],
    } satisfies ProjectAgentHostState

    expect(projectAgentThreadMessages(snapshot)).toMatchObject([
      { id: 'user-a', turnId: 'turn-a', attachments: [{ assetId: 'asset-a', fileName: 'reference.png' }] },
      { id: 'assistant-a', turnId: 'turn-a', storyboardPlan: true },
    ])
  })

  it('shows one failure card instead of a partially streamed failed assistant plus a duplicate failure', () => {
    const thread = { threadId: 'thread-a', createdAt: now, updatedAt: now } as const
    const snapshot = {
      ...state(), activeThreadId: thread.threadId, threads: [thread],
      items: [
        {
          kind: 'assistant' as const, itemId: 'assistant-a', threadId: thread.threadId, turnId: 'turn-a',
          text: 'I started this answer', textRevision: 1, status: 'failed' as const, retryable: true, deviated: false,
          createdAt: now, updatedAt: now,
        },
        {
          kind: 'failure' as const, itemId: 'failure-a', threadId: thread.threadId, turnId: 'turn-a',
          code: 'runtime_error', message: 'provider offline', status: 'failed' as const, retryable: true,
          deviated: false, createdAt: now, updatedAt: now,
        },
      ],
    } as ProjectAgentHostState
    expect(projectAgentThreadMessages(snapshot)).toMatchObject([
      { id: 'failure-a', role: 'assistant', content: 'provider offline', status: 'error' },
    ])
  })
})
