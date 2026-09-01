import { getWorkspaceRepositoryDeps } from '../runtimePaths'
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import {
  ensureWorkspaceProjectIdentity,
  WorkspaceProjectIdentityUnavailableError,
  type WorkspaceProjectIdentity,
} from '../workspace/workspaceProjectIdentity'
import {
  createCanvasReadSurfaceRegistry,
  createSurfaceOwnerAuthority,
  type CommittedSurfaceProjectSelection,
} from './canvasReadSurfaceRegistry'
import { createCapturedCanvasReadSnapshotRegistry } from './canvasReadCapturedSnapshotRegistry'

export function createCanvasReadSurfaceRuntime(input: Readonly<{
  resolveProjectIdentity(projectId: string): Promise<WorkspaceProjectIdentity>
  randomId?: () => string
}>) {
  const ownerAuthority = createSurfaceOwnerAuthority()
  const listeners = new Set<(selection: CommittedSurfaceProjectSelection | null) => void>()
  const registry = createCanvasReadSurfaceRegistry({
    ownerAuthority,
    resolveProjectIdentity: input.resolveProjectIdentity,
    randomId: input.randomId,
    onCommittedProjectChanged: (selection) => {
      for (const listener of listeners) listener(selection)
    },
  })
  const capturedSnapshots = createCapturedCanvasReadSnapshotRegistry({
    ownerAuthority,
    randomId: input.randomId,
  })
  return Object.freeze({
    ownerAuthority,
    registry,
    capturedSnapshots,
    getCommittedProjectSelection: () => registry.getCommittedProjectSelection(),
    subscribeCommittedProject(listener: (selection: CommittedSurfaceProjectSelection | null) => void) {
      listeners.add(listener)
      listener(registry.getCommittedProjectSelection())
      return () => listeners.delete(listener)
    },
  })
}

export const canvasReadSurfaceRuntime = createCanvasReadSurfaceRuntime({
  resolveProjectIdentity: async (projectId) => {
    // Project-location settings can change while the app is running. Resolve
    // repository ownership at commit time instead of freezing a startup root.
    const root = resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps())
    if (!root) throw new WorkspaceProjectIdentityUnavailableError('Workspace project root is unavailable')
    const identity = await ensureWorkspaceProjectIdentity(root)
    if (identity.projectId !== projectId) {
      throw new WorkspaceProjectIdentityUnavailableError('Workspace project root belongs to another project')
    }
    return identity
  },
})
