import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  events: vi.fn(async () => []),
}))

vi.mock('./productionRunApi', () => ({
  productionRunApi: {
    list: mocks.list,
    read: mocks.read,
    events: mocks.events,
  },
}))

import { useProductionRunStore } from './productionRunStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function run(runId: string) {
  return { runId, projectId: 'project-1', status: 'running', snapshotCursor: 1, revision: 1, artifacts: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  useProductionRunStore.getState().reset()
})

describe('production run navigation target', () => {
  it('keeps an explicit deep-link target when an older generic load finishes later', async () => {
    const listResult = deferred<Array<{ runId: string; status: string }>>()
    mocks.list.mockReturnValueOnce(listResult.promise)
    mocks.read.mockImplementation(async (_projectId: string, runId: string) => run(runId))

    const generic = useProductionRunStore.getState().load('project-1')
    await useProductionRunStore.getState().navigateTo('project-1', 'run-target', 'artifact-target')
    listResult.resolve([{ runId: 'run-other', status: 'running' }])
    await generic

    const state = useProductionRunStore.getState()
    expect(state.run?.runId).toBe('run-target')
    expect(state.navigationTarget).toEqual({ projectId: 'project-1', runId: 'run-target', artifactId: 'artifact-target' })
  })

  it('makes a later generic mount load honor the pinned run instead of selecting another active run', async () => {
    mocks.list.mockResolvedValueOnce([
      { runId: 'run-other', status: 'running' },
      { runId: 'run-target', status: 'completed' },
    ])
    mocks.read.mockImplementation(async (_projectId: string, runId: string) => run(runId))

    await useProductionRunStore.getState().navigateTo('project-1', 'run-target', 'artifact-target')
    await useProductionRunStore.getState().load('project-1')

    expect(useProductionRunStore.getState().run?.runId).toBe('run-target')
    expect(mocks.read).toHaveBeenLastCalledWith('project-1', 'run-target')
  })
})
