import { useWorkbenchStore } from '../../workbenchStore'
import { stableShotId } from '../../generationCanvas/agent/storyboardPlan'

/**
 * 打开分镜编辑器并聚焦方案里的一镜（挂载的表消费一次焦点）。
 * 生成页列表里「还没落画布的方案镜」只能在这里改（第二步账本合一之前，方案只住在编辑器里）。
 */
export function openStoryboardPlanRow(source: { documentId: string; designId: string }, rowId: string): boolean {
  const store = useWorkbenchStore.getState()
  const design = store.storyboardDesignsByDocumentId[source.documentId]?.find((candidate) => candidate.id === source.designId)
  if (!design?.plan.shots.some((shot) => stableShotId(shot) === rowId)) return false
  store.setActiveStoryboardId(source.designId, source.documentId)
  store.setStoryboardRowFocus({ designId: source.designId, rowId })
  store.setWorkspaceMode('storyboard')
  return true
}
