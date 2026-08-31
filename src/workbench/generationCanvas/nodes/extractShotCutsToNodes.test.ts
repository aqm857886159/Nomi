import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeProjectId: 'project-a',
  resolveFrame: null as null | ((value: { url: string }) => void),
  addNode: vi.fn(),
  updateNode: vi.fn(),
  createGroup: vi.fn(),
  moveNodeToGroup: vi.fn(),
  selectNodes: vi.fn(),
  persist: vi.fn(),
}))

vi.mock('../../project/workbenchProjectSession', () => ({
  getActiveWorkbenchProjectId: () => mocks.activeProjectId,
  persistActiveWorkbenchProjectNow: mocks.persist,
}))

vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({
    video: {
      extractFrame: () => new Promise<{ url: string }>((resolve) => { mocks.resolveFrame = resolve }),
    },
  }),
}))

vi.mock('../store/generationCanvasStore', () => ({
  useGenerationCanvasStore: {
    getState: () => ({
      addNode: mocks.addNode,
      updateNode: mocks.updateNode,
      createGroup: mocks.createGroup,
      moveNodeToGroup: mocks.moveNodeToGroup,
      selectNodes: mocks.selectNodes,
    }),
  },
}))

vi.mock('../../../ui/toast', () => ({ toast: vi.fn() }))

import { extractShotCutsToNodes } from './extractShotCutsToNodes'

describe('shot extraction project isolation', () => {
  beforeEach(() => {
    mocks.activeProjectId = 'project-a'
    mocks.resolveFrame = null
    vi.clearAllMocks()
  })

  it('does not write an old-project frame after the active project changes', async () => {
    const extraction = extractShotCutsToNodes({
      projectId: 'project-a',
      node: {
        id: 'video-a',
        kind: 'video',
        title: 'Reference',
        position: { x: 0, y: 0 },
        result: { id: 'result-a', type: 'video', url: 'nomi-local://asset/project-a/assets/reference.mp4', createdAt: 1 },
      },
      seconds: [1],
    })
    await vi.waitFor(() => expect(mocks.resolveFrame).not.toBeNull())
    mocks.activeProjectId = 'project-b'
    mocks.resolveFrame?.({ url: 'nomi-local://asset/project-a/assets/frame.jpg' })

    await expect(extraction).resolves.toEqual({ created: 0, failed: 0 })
    expect(mocks.addNode).not.toHaveBeenCalled()
    expect(mocks.persist).not.toHaveBeenCalled()
  })
})
