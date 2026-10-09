import { create } from 'zustand'

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
}

type CanvasPickModeState = { request: CanvasPickRequest | null }

export const useCanvasPickModeStore = create<CanvasPickModeState>(() => ({ request: null }))

/** 进入点选。返回的函数只退出**这一次**点选（被后来者顶掉之后再调是空操作）。 */
export function enterCanvasPickMode(request: CanvasPickRequest): () => void {
  const previous = useCanvasPickModeStore.getState().request
  useCanvasPickModeStore.setState({ request })
  previous?.onCancel?.()
  return () => {
    if (useCanvasPickModeStore.getState().request === request) useCanvasPickModeStore.setState({ request: null })
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

/** 点了一张卡：可点 → 退出并回调一次，返回 true；不可点 / 没在点选 → false（不可点时留在点选里）。 */
export function pickCanvasNode(nodeId: string): boolean {
  const request = useCanvasPickModeStore.getState().request
  if (!request || !request.eligible(nodeId)) return false
  useCanvasPickModeStore.setState({ request: null })
  request.onPick(nodeId)
  return true
}

/** 取消点选（Esc / 点空白）。没在点选 → false。 */
export function cancelCanvasPickMode(): boolean {
  const request = useCanvasPickModeStore.getState().request
  if (!request) return false
  useCanvasPickModeStore.setState({ request: null })
  request.onCancel?.()
  return true
}

/** 键盘：Esc 取消。返回 true = 这一下归点选（调用方吞掉事件）。 */
export function handleCanvasPickModeKeyDown(event: Pick<KeyboardEvent, 'key'>): boolean {
  return event.key === 'Escape' ? cancelCanvasPickMode() : false
}
