import type { StoryboardShotTableDocument } from '../../../../electron/shared/canvas/shotTable'
import { useWorkbenchStore } from '../../workbenchStore'
import { stableShotId } from '../../generationCanvas/agent/storyboardPlan'

/** Navigate through the existing full-page editor; the mounted table consumes focus once. */
export function openShotTableRow(source: StoryboardShotTableDocument['source'], rowId: string): boolean {
  const store = useWorkbenchStore.getState()
  const design = store.storyboardDesignsByDocumentId[source.documentId]?.find((candidate) => candidate.id === source.designId)
  if (!design?.plan.shots.some((shot) => stableShotId(shot) === rowId)) return false
  store.setActiveStoryboardId(source.designId, source.documentId)
  store.setStoryboardRowFocus({ designId: source.designId, rowId })
  store.setWorkspaceMode('storyboard')
  return true
}
