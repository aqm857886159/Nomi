import crypto from 'node:crypto'

export interface CapturedCanvasSnapshotHandle { handleId: string; projectId: string; snapshotHash: string }
export interface CapturedCanvasSnapshotRegistry {
  capture(projectId: string, snapshot: unknown): CapturedCanvasSnapshotHandle
  read(handle: CapturedCanvasSnapshotHandle): Promise<unknown>
  release(handle: CapturedCanvasSnapshotHandle): void
  invalidateProject(projectId: string): void
}

type Entry = { handle: CapturedCanvasSnapshotHandle; snapshot: unknown; waiters: Array<(value: unknown) => void>; released: boolean }

/** Sealed canvas snapshots have an explicit release barrier; project switches cannot leak a prior capture. */
export function createCapturedCanvasSnapshotRegistry(): CapturedCanvasSnapshotRegistry {
  const entries = new Map<string, Entry>()
  const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const release = (entry: Entry) => {
    if (entry.released) return
    entry.released = true
    for (const resolve of entry.waiters.splice(0)) resolve(entry.snapshot)
    entries.delete(entry.handle.handleId)
  }
  return {
    capture(projectId, snapshot) {
      const handle = Object.freeze({ handleId: crypto.randomUUID(), projectId, snapshotHash: hash(snapshot) })
      entries.set(handle.handleId, { handle, snapshot, waiters: [], released: false })
      return handle
    },
    read(handle) {
      const entry = entries.get(handle.handleId)
      if (!entry || entry.handle.projectId !== handle.projectId || entry.handle.snapshotHash !== handle.snapshotHash) return Promise.reject(new Error('captured_snapshot_stale'))
      return new Promise((resolve) => {
        if (entry.released) resolve(entry.snapshot)
        else entry.waiters.push(resolve)
      })
    },
    release(handle) { const entry = entries.get(handle.handleId); if (entry) release(entry) },
    invalidateProject(projectId) { for (const entry of entries.values()) if (entry.handle.projectId === projectId) release(entry) },
  }
}
