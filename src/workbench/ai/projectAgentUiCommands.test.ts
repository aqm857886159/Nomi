import { beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  command: vi.fn(),
  install: vi.fn(),
  state: null as null | {
    subscriptionId: string
    snapshot: {
      binding: { projectId: string; immutableProjectUuid: string; projectGeneration: number }
      hostRevision: number
      threads: readonly unknown[]
      items: readonly { threadId: string }[]
      activeThreadId: string | null
    }
  },
}))

vi.mock('./projectAgentClient', () => ({
  projectAgentClient: { command: deps.command },
}))
vi.mock('./projectAgentProjectionStore', () => ({
  projectAgentProjectionStore: {
    getState: () => deps.state,
    applySnapshot: deps.install,
  },
}))

import {
  activateProjectAgentThread,
  createProjectAgentThread,
  removeProjectAgentThread,
} from './projectAgentUiCommands'

const binding = {
  projectId: 'ui-command-project',
  immutableProjectUuid: '44444444-4444-4444-8444-444444444444',
  projectGeneration: 1,
} as const

beforeEach(() => {
  deps.command.mockReset()
  deps.install.mockReset()
  deps.state = {
    subscriptionId: 'subscription-a',
    snapshot: {
      binding,
      hostRevision: 7,
      threads: [],
      items: [],
      activeThreadId: null,
    },
  }
  deps.command.mockResolvedValue({ state: { ...deps.state.snapshot, hostRevision: 8 } })
})

describe('ProjectAgent UI history commands', () => {
  it('creates a canonical active thread with the current revision', async () => {
    await createProjectAgentThread()
    expect(deps.command).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'subscription-a',
        knownRevision: 7,
        type: 'thread.put',
        payload: {
          makeActive: true,
          thread: expect.objectContaining({ threadId: expect.stringMatching(/^thread-/) }),
        },
      }),
    )
    expect(deps.install).toHaveBeenCalledTimes(1)
  })

  it('routes activation and deletion through semantic mutations', async () => {
    await activateProjectAgentThread('thread-archived')
    await removeProjectAgentThread('thread-archived')
    expect(deps.command.mock.calls.map(([input]) => input.type)).toEqual(['thread.activate', 'thread.remove'])
    expect(deps.command.mock.calls.every(([input]) => input.knownRevision === 7)).toBe(true)
  })

  it('reuses an empty canonical active thread instead of creating blank history', async () => {
    deps.state = {
      subscriptionId: 'subscription-a',
      snapshot: {
        binding,
        hostRevision: 7,
        threads: [{ threadId: 'thread-empty' }],
        items: [],
        activeThreadId: 'thread-empty',
      },
    }
    const result = await createProjectAgentThread()
    expect(result.activeThreadId).toBe('thread-empty')
    expect(deps.command).not.toHaveBeenCalled()
  })
})
