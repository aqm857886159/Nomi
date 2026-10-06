/**
 * [INPUT]: 依赖 ./model/directorStore、./model/directorShotFocus、./model/directorShotSummaries、./model/directorPreviewState 的 readDirectorPlanMeta、画布 store
 * [OUTPUT]: 对外提供 createEditorShotFocusSession：一个开着的导演台的「正在改：镜头 N」读口（读 / 订阅 / 清除），交给会话登记处
 * [POS]: 镜头焦点的 owner 是编辑器 store 的 selection（cameraId + multiCameraIds）；这里只投影成计划镜头，并按
 *        （工程引用、选中、修订号）缓存——播放时 store 每帧都变，读口照样返回同一个对象，输入框上的标签不跟着重渲。
 *        实测（景别 / 运镜）与镜头条同一份 summarizeDirectorShots，只在工程变时重算。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import type { DirectorStore } from './model/directorStore'
import { directorShotFocusFrom, type DirectorShotFocus } from './model/directorShotFocus'
import { readDirectorPlanMeta } from './model/directorPreviewState'
import { summarizeDirectorShots, type DirectorShotSummary } from './model/directorShotSummaries'
import type { DirectorProject } from './model/directorTypes'

export type EditorShotFocusSession = Readonly<{
  shotFocus: () => DirectorShotFocus | null
  clearShotFocus: () => void
  subscribe: (listener: () => void) => () => void
}>

function planShotIdsOf(plan: unknown): string[] {
  const shots = (plan as { shots?: unknown } | null)?.shots
  return Array.isArray(shots) ? shots.flatMap((shot) => (shot && typeof (shot as { id?: unknown }).id === 'string' ? [(shot as { id: string }).id] : [])) : []
}

export function createEditorShotFocusSession(nodeId: string, store: DirectorStore): EditorShotFocusSession {
  let cuts: { project: DirectorProject; value: DirectorShotSummary[] } | null = null
  let cached: { key: string; project: DirectorProject; value: DirectorShotFocus | null } | null = null
  const selectedOf = (state: ReturnType<DirectorStore['getState']>) =>
    state.selection.multiCameraIds.length ? state.selection.multiCameraIds : state.selection.cameraId ? [state.selection.cameraId] : []
  return {
    shotFocus: () => {
      const state = store.getState()
      const selected = selectedOf(state)
      const planMeta = readDirectorPlanMeta(useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId))
      const key = `${planMeta?.revision ?? ''}\u0000${selected.join('\u0001')}`
      if (cached && cached.key === key && cached.project === state.project) return cached.value
      let value: DirectorShotFocus | null = null
      if (planMeta && selected.length) {
        if (!cuts || cuts.project !== state.project) cuts = { project: state.project, value: summarizeDirectorShots(state.project) }
        value = directorShotFocusFrom({ directorNodeId: nodeId, revision: planMeta.revision, planShotIds: planShotIdsOf(planMeta.plan), cuts: cuts.value, selectedCameraIds: selected })
      }
      cached = { key, project: state.project, value }
      return value
    },
    clearShotFocus: () => store.getState().select({ cameraId: null, multiCameraIds: [] }),
    subscribe: (listener) => {
      const offStore = store.subscribe(listener)
      // 修订号住在画布节点上（stage_shot 写）：它变了标签上的实测也可能变
      const offCanvas = useGenerationCanvasStore.subscribe((state, previous) => {
        if (state.nodes === previous.nodes) return
        const now = state.nodes.find((node) => node.id === nodeId)
        const before = previous.nodes.find((node) => node.id === nodeId)
        if (now?.meta !== before?.meta) listener()
      })
      return () => { offStore(); offCanvas() }
    },
  }
}
