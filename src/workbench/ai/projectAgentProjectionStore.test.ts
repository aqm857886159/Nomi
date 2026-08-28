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
    store.install('sub-a', state())
    const patch = {
      binding,
      previousRevision: 1,
      hostRevision: 2,
      changes: [],
    } satisfies ProjectAgentPatch
    expect(store.applyPatch(patch)).toBe(false)
    expect(store.getState().snapshot?.hostRevision).toBe(0)
  })

  it('applies an atomic active-thread and assistant append patch', () => {
    const store = createProjectAgentProjectionStore()
    const initial = state()
    store.install('sub-a', initial)
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
})
