import { describe, expect, it, vi } from 'vitest'

import { createCanvasReadSurfaceRuntime } from './canvasReadSurfaceRuntime'

describe('Canvas read Surface runtime projection', () => {
  it('replays the current full committed identity to a late subscriber and never exposes an id-only authority', async () => {
    const runtime = createCanvasReadSurfaceRuntime({
      resolveProjectIdentity: async () => ({
        projectId: 'project-a',
        immutableProjectUuid: '00000000-0000-4000-8000-000000000001',
        projectGeneration: 3,
        canonicalRootPath: '/real/project-a',
        canonicalRootDigest: 'root-a',
      }),
      randomId: (() => { let id = 0; return () => `id-${++id}` })(),
    })
    const owner = runtime.ownerAuthority.capture({
      contents: {}, frame: {}, webContentsId: 1, processId: 2, frameRoutingId: 3,
      origin: 'file://', isLive: () => true,
    })
    const suspension = runtime.registry.suspend(owner, { surfaceInstanceId: 'surface-1' })
    await runtime.registry.commitCanvasRead(owner, { projectId: 'project-a', suspension })
    const late = vi.fn()

    const unsubscribe = runtime.subscribeCommittedProject(late)

    expect(late).toHaveBeenCalledOnce()
    expect(late).toHaveBeenCalledWith({
      projectId: 'project-a',
      immutableProjectUuid: '00000000-0000-4000-8000-000000000001',
      projectGeneration: 3,
      canonicalRootDigest: 'root-a',
    })
    expect(runtime.getCommittedProjectSelection()).toBe(late.mock.calls[0][0])
    unsubscribe()
    runtime.registry.suspend(owner, { surfaceInstanceId: 'surface-1' })
    expect(late).toHaveBeenCalledOnce()
  })
})
