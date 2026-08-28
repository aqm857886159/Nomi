import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createCanvasReadSurfaceRegistry,
  createSurfaceOwnerAuthority,
  type SurfaceOwnerEvidence,
  type SurfacePortBinding,
} from './canvasReadSurfaceRegistry'
import { createCapturedCanvasReadSnapshotRegistry } from './canvasReadCapturedSnapshotRegistry'

const IDENTITY = Object.freeze({
  projectId: 'project-a',
  immutableProjectUuid: '00000000-0000-4000-8000-000000000001',
  projectGeneration: 1,
  canonicalRootPath: '/real/project-a',
  canonicalRootDigest: 'root-a',
})

const SNAPSHOT = Object.freeze({
  nodes: [Object.freeze({
    id: 'node-a',
    kind: 'image',
    title: 'Captured A',
    prompt: 'draw A',
    status: 'idle',
    position: Object.freeze({ x: 1, y: 2 }),
    locked: false,
    hasResult: false,
  })],
  edges: Object.freeze([]),
  groups: Object.freeze([]),
  selectedNodeIds: Object.freeze(['node-a']),
})

function ownerDescriptor(live: { value: boolean }, id: number) {
  return {
    contents: {},
    frame: {},
    webContentsId: id,
    processId: id + 1,
    frameRoutingId: id + 2,
    origin: 'file://',
    isLive: () => live.value,
  }
}

async function setup(options: Readonly<{
  maxEntriesPerOwner?: number
  maxEntriesGlobal?: number
  maxSnapshotBytes?: number
  ttlMs?: number
  now?: () => number
}> = {}) {
  const ownerAuthority = createSurfaceOwnerAuthority()
  const live = { value: true }
  const owner = ownerAuthority.capture(ownerDescriptor(live, 1))
  let id = 0
  const surface = createCanvasReadSurfaceRegistry({
    ownerAuthority,
    resolveProjectIdentity: async () => ({ ...IDENTITY }),
    randomId: () => `surface-${++id}`,
  })
  const suspension = surface.suspend(owner, { surfaceInstanceId: 'surface-a' })
  const binding = await surface.commitCanvasRead(owner, { projectId: IDENTITY.projectId, suspension })
  const selection = surface.getCommittedProjectSelection()!
  const snapshots = createCapturedCanvasReadSnapshotRegistry({
    ownerAuthority,
    randomId: () => `snapshot-${++id}`,
    ...options,
  })
  const seal = (snapshot: unknown = SNAPSHOT) => snapshots.seal({ owner, binding, selection, snapshot })
  return { ownerAuthority, owner, live, surface, binding, selection, snapshots, seal }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('main-sealed captured canvas snapshot registry', () => {
  it('seals canonical bytes against the exact full binding and consumes a cloned handle once', async () => {
    const test = await setup()
    const handle = test.seal()
    const captured = test.snapshots.consume({
      owner: test.owner,
      handle: structuredClone(handle),
      projectId: IDENTITY.projectId,
    })
    const resolved = test.snapshots.resolve(captured)

    expect(resolved.binding).toBe(test.binding)
    expect(resolved.canonicalRootDigest).toBe(IDENTITY.canonicalRootDigest)
    expect(resolved.snapshotHash).toMatch(/^[a-f0-9]{64}$/)
    expect(resolved.result).toEqual(SNAPSHOT)
    expect(Object.isFrozen(resolved.result)).toBe(true)
    expect(() => test.snapshots.consume({
      owner: test.owner,
      handle: structuredClone(handle),
      projectId: IDENTITY.projectId,
    })).toThrow(expect.objectContaining({ code: 'surface_port_stale' }))
  })

  it('rejects tamper, another exact owner, and a wrong request project without burning the valid handle', async () => {
    const test = await setup()
    const handle = test.seal()
    expect(() => test.snapshots.consume({
      owner: test.owner,
      handle: { ...handle, nonce: 'tampered' },
      projectId: IDENTITY.projectId,
    })).toThrow(expect.objectContaining({ code: 'surface_port_stale' }))

    const other = test.ownerAuthority.capture(ownerDescriptor({ value: true }, 20))
    expect(() => test.snapshots.consume({
      owner: other,
      handle: structuredClone(handle),
      projectId: IDENTITY.projectId,
    })).toThrow(expect.objectContaining({ code: 'surface_owner_mismatch' }))
    expect(() => test.snapshots.consume({
      owner: test.owner,
      handle: structuredClone(handle),
      projectId: 'project-b',
    })).toThrow(expect.objectContaining({ code: 'surface_port_stale' }))

    expect(test.snapshots.consume({
      owner: test.owner,
      handle: structuredClone(handle),
      projectId: IDENTITY.projectId,
    })).toBeTruthy()
  })

  it('keeps consumed production bytes across Surface release but drops them on Session cleanup or document invalidation', async () => {
    const test = await setup()
    const pending = test.seal()
    const consumedHandle = test.seal()
    const captured = test.snapshots.consume({ owner: test.owner, handle: consumedHandle, projectId: IDENTITY.projectId })

    test.snapshots.revokePendingForOwner(test.owner)
    expect(() => test.snapshots.consume({ owner: test.owner, handle: pending, projectId: IDENTITY.projectId }))
      .toThrow(expect.objectContaining({ code: 'surface_port_stale' }))
    expect(test.snapshots.resolve(captured).result).toEqual(SNAPSHOT)

    test.snapshots.release(captured)
    expect(() => test.snapshots.resolve(captured)).toThrow(expect.objectContaining({ code: 'surface_port_stale' }))

    const capturedAfter = test.snapshots.consume({
      owner: test.owner,
      handle: test.seal(),
      projectId: IDENTITY.projectId,
    })
    test.snapshots.invalidateOwner(test.owner)
    expect(() => test.snapshots.resolve(capturedAfter)).toThrow(expect.objectContaining({ code: 'surface_port_stale' }))
  })

  it('expires abandoned handles and enforces per-owner/global bounds without unbounded pending state', async () => {
    vi.useFakeTimers()
    const test = await setup({ maxEntriesPerOwner: 2, maxEntriesGlobal: 2, ttlMs: 50 })
    const first = test.seal()
    test.seal()
    expect(() => test.seal()).toThrow(expect.objectContaining({ code: 'surface_port_unavailable' }))

    await vi.advanceTimersByTimeAsync(51)
    expect(() => test.snapshots.consume({ owner: test.owner, handle: first, projectId: IDENTITY.projectId }))
      .toThrow(expect.objectContaining({ code: 'surface_port_stale' }))
    expect(() => test.seal()).not.toThrow()
  })

  it('shares the hard per-owner/global cap across pending and consumed snapshots until Session cleanup', async () => {
    const test = await setup({ maxEntriesPerOwner: 2, maxEntriesGlobal: 2 })
    const first = test.snapshots.consume({
      owner: test.owner,
      handle: test.seal(),
      projectId: IDENTITY.projectId,
    })
    const second = test.snapshots.consume({
      owner: test.owner,
      handle: test.seal(),
      projectId: IDENTITY.projectId,
    })

    expect(() => test.seal()).toThrow(expect.objectContaining({ code: 'surface_port_unavailable' }))
    expect(test.snapshots.resolve(first).result).toEqual(SNAPSHOT)
    expect(test.snapshots.resolve(second).result).toEqual(SNAPSHOT)

    test.snapshots.release(first)
    expect(() => test.seal()).not.toThrow()
  })

  it('rejects logical expiry even when the cleanup timer has not fired and frees the reserved slot', async () => {
    let now = 10
    const test = await setup({ maxEntriesPerOwner: 1, maxEntriesGlobal: 1, ttlMs: 50, now: () => now })
    const expired = test.seal()
    now = 60

    expect(() => test.snapshots.consume({
      owner: test.owner,
      handle: expired,
      projectId: IDENTITY.projectId,
    })).toThrow(expect.objectContaining({ code: 'surface_port_stale' }))
    expect(() => test.seal()).not.toThrow()
  })

  it('rejects malformed and oversized canonical snapshots before they consume capacity', async () => {
    const test = await setup({ maxEntriesPerOwner: 1, maxEntriesGlobal: 1, maxSnapshotBytes: 400 })
    expect(() => test.seal({ ...SNAPSHOT, unexpected: true }))
      .toThrow(expect.objectContaining({ code: 'capability_input_invalid' }))
    expect(() => test.seal({
      ...SNAPSHOT,
      nodes: [{ ...SNAPSHOT.nodes[0], title: 'x'.repeat(2_000) }],
    })).toThrow(expect.objectContaining({ code: 'capability_input_invalid' }))

    expect(() => test.seal({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })).not.toThrow()
    expect(() => test.seal()).toThrow(expect.objectContaining({ code: 'surface_port_unavailable' }))
  })

  it('enforces the global bound across distinct exact owners', async () => {
    const test = await setup({ maxEntriesPerOwner: 4, maxEntriesGlobal: 1 })
    const captured = test.snapshots.consume({
      owner: test.owner,
      handle: test.seal(),
      projectId: IDENTITY.projectId,
    })
    test.live.value = false
    const secondLive = { value: true }
    const secondOwner: SurfaceOwnerEvidence = test.ownerAuthority.capture(ownerDescriptor(secondLive, 40))
    const secondSurface = createCanvasReadSurfaceRegistry({
      ownerAuthority: test.ownerAuthority,
      resolveProjectIdentity: async () => ({ ...IDENTITY, projectId: 'project-b', canonicalRootDigest: 'root-b' }),
      randomId: () => 'second-surface',
    })
    const suspension = secondSurface.suspend(secondOwner, { surfaceInstanceId: 'surface-b' })
    const binding: SurfacePortBinding = await secondSurface.commitCanvasRead(secondOwner, {
      projectId: 'project-b',
      suspension,
    })
    const selection = secondSurface.getCommittedProjectSelection()!

    expect(() => test.snapshots.seal({ owner: secondOwner, binding, selection, snapshot: SNAPSHOT }))
      .toThrow(expect.objectContaining({ code: 'surface_port_unavailable' }))

    test.snapshots.release(captured)
    expect(() => test.snapshots.seal({ owner: secondOwner, binding, selection, snapshot: SNAPSHOT }))
      .not.toThrow()
  })
})
