// 「画布上正在进行拖动」这一件事的唯一真相 —— 写在 stage 上的一个 DOM 属性。
//
// 谁会升起它：拖单个节点、拖选区框、拖组框（都是在摆节点位置），以及**拖画布本身**（平移）。
// 谁会看它：节点的浮动工具条 / 提示词面板 / 图片版本控件条——拖动期间统统隐身
// （2026-08-08 用户提「拖节点时浮层跟着飞很脏」，08-09 两次扩围：先扩到全部节点、再扩到平移）。
//
// 为什么是画布级而不是节点级：用户选中 A 展开了输入框，再去拖 B——A 那块大面板还杵在画布上。
// 「我正在摆位置/找位置」是一个**画布态**，不是某个节点的私事，所以标志挂 stage、浮层各自声明隐身，
// 天然覆盖全部节点，也不用把状态一层层传下去。
//
// 为什么不进 React：它只驱动可见性（CSS），进 state 就等于每次拖动开始/结束让节点树重渲一轮——
// 和光标那次栽的是同一个坑（见 useCanvasViewportGestures 头部注释）。
//
// 时机纪律：**跨过拖拽阈值才升**，不是按下就升。否则「点一下空白」也会写两次属性，
// 每次都让整棵 stage 子树重算样式——那正是 2026-08-08 用户报的「点空白也在刷新」。
const STAGE_SELECTOR = '.generation-canvas-v2__stage'

export const CANVAS_DRAGGING_ATTRIBUTE = 'data-dragging'

export const CANVAS_DRAGGING_OWNER = {
  node: 'node',
  selection: 'selection',
  group: 'group',
  viewport: 'viewport',
  reactFlowNode: 'react-flow-node',
  reactFlowPan: 'react-flow-pan',
  reactFlowViewport: 'react-flow-viewport',
} as const

export type CanvasDraggingOwner = (typeof CANVAS_DRAGGING_OWNER)[keyof typeof CANVAS_DRAGGING_OWNER]

const draggingOwnersByStage = new WeakMap<Element, Set<CanvasDraggingOwner>>()

/**
 * @param origin 拖动发起处的元素（节点/组框/stage）。用它 closest 到自己那张画布——
 *               多画布并存时不会误伤别的 stage；取不到就退回文档里的第一张。
 */
export function setCanvasDragging(
  origin: Element | null | undefined,
  dragging: boolean,
  owner: CanvasDraggingOwner,
): void {
  if (typeof document === 'undefined') return
  const stage = origin?.closest(STAGE_SELECTOR) ?? document.querySelector(STAGE_SELECTOR)
  if (!stage) return
  let owners = draggingOwnersByStage.get(stage)
  if (dragging) {
    if (!owners) {
      owners = new Set()
      draggingOwnersByStage.set(stage, owners)
    }
    owners.add(owner)
    if (!stage.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)) {
      stage.setAttribute(CANVAS_DRAGGING_ATTRIBUTE, 'true')
    }
    return
  }
  if (!owners?.delete(owner) || owners.size > 0) return
  draggingOwnersByStage.delete(stage)
  stage.removeAttribute(CANVAS_DRAGGING_ATTRIBUTE)
}
