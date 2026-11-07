import { getDesktopBridge } from '../../desktop/bridge'
import type { DeleteAssetResultOutcome } from './deleteAssetResult'

/** Physical trash is private to the asset deletion domain, after reference/undo planning. */
export async function trashProjectFiles(projectId: string, relativePaths: string[]): Promise<{ ok: boolean; deletedCount: number; failedCount: number }> {
  const trash = getDesktopBridge()?.workspace?.deleteFiles
  if (!trash) return { ok: false, deletedCount: 0, failedCount: relativePaths.length }
  return trash({ projectId, relativePaths })
}

/** A child UI owns no project stores: ask the main renderer's existing domain command. */
export async function requestProjectAssetDeletion(projectId: string, relativePaths: string[]): Promise<DeleteAssetResultOutcome[]> {
  const command = getDesktopBridge()?.workspace?.deleteAssets
  if (!command) throw new Error('Asset deletion is unavailable')
  return command({ projectId, relativePaths })
}
