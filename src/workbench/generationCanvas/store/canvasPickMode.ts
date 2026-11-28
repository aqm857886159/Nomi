import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationViewStore } from '../../generation/list/generationViewStore'
import { create } from 'zustand'
import { declareStoreLifetime } from '../../project/storeLifetime'

/**
 * 「在画布上点选」——画布的一个**共享能力**（2026-10-08 拍板 ②）：调用方说清哪些卡能点、点中了做什么，
 * 画布负责其余一切：变暗、可点的卡描边（悬停加粗）、其余变灰（含正在编辑的那张）、顶部一条「选择要引用的节点 · Esc」、
 * Esc / 点空白取消。现在的调用方：左「+」菜单「在画布上点选」、剪辑卡空态；下一条自动引用线的 @ → 画布节点
 * 也调这一个（一次 `enterCanvasPickMode(...)` 即可）。
 *
 * 只是一份界面状态：不写画布文档、不建边——点中之后建不建边、建哪条，是 `onPick` 自己的事（建边仍过连线总闸）。
 * 外观在 GenerationFlowNodeView（卡的描边 / 变灰）、CanvasPickModeLayer（顶栏 + 指针接管）、Viewport（变暗）。
 */
export type CanvasPickRequest = {
  /** 这张卡能不能点（每次渲染都会问；保持纯、便宜）。 */
  eligible: (nodeId: string) => boolean
  /** 点中一张 eligible 的卡：恰好调一次，随后退出点选。 */
  onPick: (nodeId: string) => void
  /** Esc / 点空白 / 被下一次点选顶掉：调一次。 */
  onCancel?: () => void
  /** 常驻壳（如右侧 Agent 面板）发起的点选不会因列表切画布卸载，其 disposer 始终立即生效。 */
  resident?: boolean
}

export type CanvasPickReturnToList = Readonly<{ inspectorKey: string | null }>

type CanvasPickModeState = {
  request: CanvasPickRequest | null
  returnToList: CanvasPickReturnToList | null
  /** 列表视图切去画布点选时，列表节点生成框会立即卸载一次；仅豁免这一次预期卸载，不影响后续取消。 */
  listUnmountGrace: boolean
}

export const useCanvasPickModeStore = create<CanvasPickModeState>(() => ({
  request: null,
  returnToList: null,
  listUnmountGrace: false,
}))

/**
 * 寿命（切项目要不要清它）：`request` 是 project——它的 `eligible` / `onPick` 是调用方捕获了**当前项目里某张卡的 id**的闭包
 * （「给这张卡加输入」），切项目后留着，画布上会按上一个项目的卡去判能不能点、点中还会往新项目里写边。
 * 切项目 / 关项目时清回 null（不调 onCancel：那是上一个项目的回调，切走之后不该再往新项目发任何东西）。
 */
export const canvasPickModeStoreLifetime = declareStoreLifetime({
  store: 'useCanvasPickModeStore',
  fields: { request: 'project', returnToList: 'project', listUnmountGrace: 'project' },
  releaseProject: () => useCanvasPickModeStore.setState({ request: null, returnToList: null, listUnmountGrace: false }),
})

function cancelPickOnExternalNavigation(): void {
  const { request } = useCanvasPickModeStore.getState()
  if (!request) return
  useCanvasPickModeStore.setState({ request: null, returnToList: null, listUnmountGrace: false })
  request.onCancel?.()
}

// 用户手动点顶栏切回列表或切离生成页时，自动退出活跃点选（不把视图再拉回），避免再次进画布残留点选遮罩。
useGenerationViewStore.subscribe((state, prev) => {
  if (prev.view === 'canvas' && state.view !== 'canvas') cancelPickOnExternalNavigation()
})
useWorkbenchStore.subscribe((state, prev) => {
  if (prev.workspaceMode === 'generation' && state.workspaceMode !== 'generation') cancelPickOnExternalNavigation()
})

function restoreListViewIfNeeded(returnToList: CanvasPickReturnToList | null): void {
  if (!returnToList) return
  useGenerationViewStore.setState({ view: 'list', inspectorKey: returnToList.inspectorKey })
}

/** 本次点选是否从列表视图暂切而来（列表视图因此预期卸载，生成框清理函数据此保留本次点选）。 */
export function isCanvasPickReturningToList(): boolean {
  return useCanvasPickModeStore.getState().returnToList !== null
}

/** 进入点选。若从列表视图发起，自动暂切到可见画布并在点选成功或取消后回到列表原详情。 */
export function enterCanvasPickMode(request: CanvasPickRequest): () => void {
  const prevState = useCanvasPickModeStore.getState()
  const currentView = useGenerationViewStore.getState()
  const cameFromList = currentView.view === 'list'
  const returnToList: CanvasPickReturnToList | null = cameFromList
    ? { inspectorKey: currentView.inspectorKey }
    : (prevState.request ? prevState.returnToList : null)
  const listUnmountGrace = cameFromList && !request.resident
  useCanvasPickModeStore.setState({ request, returnToList, listUnmountGrace })
  useWorkbenchStore.getState().setWorkspaceMode('generation')
  useGenerationViewStore.getState().setView('canvas')
  prevState.request?.onCancel?.()
  return () => {
    const current = useCanvasPickModeStore.getState()
    if (current.request !== request) return
    if (current.listUnmountGrace) {
      useCanvasPickModeStore.setState({ listUnmountGrace: false })
      return
    }
    useCanvasPickModeStore.setState({ request: null, returnToList: null, listUnmountGrace: false })
  }
}

export function isCanvasPickModeActive(): boolean {
  return useCanvasPickModeStore.getState().request !== null
}

/** 点选中这张卡能不能点：true 可点 / false 不可点；不在点选里 → null。 */
export function canvasPickNodeState(nodeId: string, request = useCanvasPickModeStore.getState().request): boolean | null {
  if (!request) return null
  return request.eligible(nodeId)
}

/** 每张卡订阅自己那一格（不在点选时恒为 null，卡不重渲）。 */
export function useCanvasPickNodeState(nodeId: string): boolean | null {
  return useCanvasPickModeStore((state) => canvasPickNodeState(nodeId, state.request))
}

/** 点了一张卡：可点 → 退出并回调一次（若从列表来则自动切回列表），返回 true；不可点 / 没在点选 → false。 */
export function pickCanvasNode(nodeId: string): boolean {
  const { request, returnToList } = useCanvasPickModeStore.getState()
  if (!request || !request.eligible(nodeId)) return false
  useCanvasPickModeStore.setState({ request: null, returnToList: null, listUnmountGrace: false })
  request.onPick(nodeId)
  restoreListViewIfNeeded(returnToList)
  return true
}

/** 取消点选（Esc / 点空白）。若从列表发起则自动切回列表并保留原详情。没在点选 → false。 */
export function cancelCanvasPickMode(): boolean {
  const { request, returnToList } = useCanvasPickModeStore.getState()
  if (!request) return false
  useCanvasPickModeStore.setState({ request: null, returnToList: null, listUnmountGrace: false })
  request.onCancel?.()
  restoreListViewIfNeeded(returnToList)
  return true
}

/** 键盘：Esc 取消。返回 true = 这一下归点选（调用方吞掉事件）。 */
export function handleCanvasPickModeKeyDown(event: Pick<KeyboardEvent, 'key'>): boolean {
  return event.key === 'Escape' ? cancelCanvasPickMode() : false
}
