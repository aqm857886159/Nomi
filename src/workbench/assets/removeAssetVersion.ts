import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { removeNodeResult } from '../generationCanvas/model/nodeResultLifecycle'
import { dropUndoBarriersAfter, getUndoJournalPosition, pushUndoSnapshot } from '../generationCanvas/events/canvasPatchHistory'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import { persistActiveWorkbenchProjectNow } from '../project/workbenchProjectSession'
import { rollbackAppliedPatches, serializeProjectDeletion } from './assetResultMutation'

/** Removing a version changes its card and undo history; the original stays a project asset. */
export function removeAssetVersion(nodeId: string, resultId: string, loaded: ProjectExecutionContext): Promise<number> {
  return serializeProjectDeletion(loaded.binding.projectId, async () => {
    loaded.assertCurrent()
    const store = useGenerationCanvasStore.getState()
    const node = store.nodes.find(candidate => candidate.id === nodeId)
    const patch = node && removeNodeResult(node, resultId)
    if (!node || !patch) return 0
    const barrierAt = getUndoJournalPosition()
    pushUndoSnapshot(store)
    store.updateNode(nodeId, patch)
    try {
      const saved = await persistActiveWorkbenchProjectNow()
      if (!saved || saved.id !== loaded.binding.projectId) throw new Error(`Version removal could not be persisted: ${loaded.binding.projectId}`)
    } catch (error) {
      if (isProjectExecutionContextCurrent(loaded)) {
        rollbackAppliedPatches([{ nodeId, before: { result: node.result, history: node.history, status: node.status, error: node.error }, applied: patch }])
        dropUndoBarriersAfter(barrierAt)
      }
      throw error
    }
    return 1
  })
}
