import { describe, expect, it } from 'vitest'
import { createCapturedCanvasSnapshotRegistry } from './canvasReadCapturedSnapshotLifecycle'

describe('captured canvas snapshot release lifecycle', () => {
  it('settles pending reads on release and never crosses a project boundary', async () => {
    const registry = createCapturedCanvasSnapshotRegistry()
    const sealedA = registry.capture('project-a', { nodes: ['a'] })
    const pending = registry.read(sealedA)
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    registry.release(sealedA)
    await expect(pending).resolves.toEqual({ nodes: ['a'] })
    const sealedB = registry.capture('project-b', { nodes: ['b'] })
    await expect(registry.read({ ...sealedA })).rejects.toThrow('captured_snapshot_stale')
    registry.release(sealedB)
  })
})
