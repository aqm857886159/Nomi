import type { WorkspaceSyncStatus } from '../../../electron/shared/workspaceSyncContracts'

/**
 * A manifest with missing assets is still readable: the workbench can open it
 * and let the user continue with the assets that are present while the badge
 * keeps the missing-file warning visible. Only states that make the manifest
 * itself unsafe to read stay blocked at the library boundary.
 */
export function canOpenProjectWithSyncStatus(status: WorkspaceSyncStatus | undefined): boolean {
  return status === undefined || status === 'ready' || status === 'missing-assets'
}
