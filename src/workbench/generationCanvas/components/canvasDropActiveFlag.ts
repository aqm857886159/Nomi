// 「拖放进行中」这一件事的唯一真相——写在 stage 上的一个 DOM 属性（和 canvasDraggingFlag 的 data-dragging 同一手法）。
//
// 为什么要有：从素材节点的「拖到时间轴」把手 / 素材库拖出一个可接收的载荷时，目标（比如剪辑节点的轴）常被画布上的浮层
// 盖着——选中素材节点后它的参数浮板就在节点正下方，正好挡在去剪辑节点的路上；连接把手的命中区、节点浮条、版本卡动作条同理。
// 浮层吃命中，dragover 就到不了真正的接收目标，落下去没反应（10-09 验收 V-1149 实测）。
//
// 做法：dragstart 带着「可接收的载荷类型」就升旗；旗在期间 stage 上列出的浮层整体不接收命中（视觉不变，只是点不到、
// 事件穿过去落在下面的东西上）。结束 / 取消（dragend、drop、Esc、窗口失焦、页面隐藏）一律摘旗。
// 浮层清单只在这一处（CANVAS_DROP_PASS_THROUGH_SELECTORS）；新增会盖在节点上的浮层，加进清单。
export const CANVAS_DROP_ACTIVE_ATTRIBUTE = 'data-drop-active'

/** 拖放期间不接收命中的画布浮层（选择器）。 */
export const CANVAS_DROP_PASS_THROUGH_SELECTORS = [
  '.generation-canvas-v2-node__composer', // 选中节点的参数浮板 / 生成框
  '[data-node-floating-toolbar]', // 节点浮条
  '[data-version-card-bar]', // 版本卡动作条
  '[data-version-card]', // 版本卡
  '.generation-canvas-react-flow__handle-hit', // 连接把手命中区（会伸到相邻节点上）
  '.generation-canvas-v2__selection-toolbar', // 多选浮条
  '.generation-canvas-v2__group-toolbar', // 组框工具条
] as const

// Tailwind 只认字面量类名，所以这里写成整串（用 String.raw：源码里的反斜杠必须与 DOM 里的类名一致，类名里的 __ 在任意值里要写成 \_\_，否则 _ 会被当成空格）；canvasDropActiveFlag.test.ts 核对它与上面的清单一致。
export const CANVAS_DROP_ACTIVE_CLASS_NAME = String.raw`[&[data-drop-active=true]_:is(.generation-canvas-v2-node\_\_composer,[data-node-floating-toolbar],[data-version-card-bar],[data-version-card],.generation-canvas-react-flow\_\_handle-hit,.generation-canvas-v2\_\_selection-toolbar,.generation-canvas-v2\_\_group-toolbar)]:!pointer-events-none  [&[data-drop-active=true]_:is(.generation-canvas-v2-node\_\_composer,[data-node-floating-toolbar],[data-version-card-bar],[data-version-card],.generation-canvas-react-flow\_\_handle-hit,.generation-canvas-v2\_\_selection-toolbar,.generation-canvas-v2\_\_group-toolbar)_*]:!pointer-events-none`

/**
 * 监听拖放起止，给 stage 升 / 摘旗。acceptsTypes：这次拖放带的类型里有没有「可接收的载荷」（由接收口那一侧定义）。
 * 返回卸载函数（卸载时一并摘旗）。
 */
export function watchCanvasDropActive(stage: HTMLElement, acceptsTypes: (types: readonly string[]) => boolean): () => void {
  let disposed = false
  // 摘旗时换一代：dragstart 的延迟升旗只认自己那一代，dragend 先到（极短的拖放）时不会把旗留在上面。
  let epoch = 0
  const clear = () => { epoch += 1; stage.removeAttribute(CANVAS_DROP_ACTIVE_ATTRIBUTE) }
  const onDragStart = (event: Event) => {
    const dataTransfer = (event as DragEvent).dataTransfer
    const startedAt = epoch
    // 处理函数（写载荷）在捕获之后才跑：等它跑完再读 types。
    window.setTimeout(() => {
      if (!disposed && startedAt === epoch && dataTransfer && acceptsTypes(Array.from(dataTransfer.types))) stage.setAttribute(CANVAS_DROP_ACTIVE_ATTRIBUTE, 'true')
    }, 0)
  }
  const onKeyDown = (event: Event) => { if ((event as KeyboardEvent).key === 'Escape') clear() }
  const onVisibility = () => { if (document.hidden) clear() }
  window.addEventListener('dragstart', onDragStart, true)
  for (const name of ['dragend', 'drop']) window.addEventListener(name, clear, true)
  window.addEventListener('blur', clear)
  window.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    disposed = true
    window.removeEventListener('dragstart', onDragStart, true)
    for (const name of ['dragend', 'drop']) window.removeEventListener(name, clear, true)
    window.removeEventListener('blur', clear)
    window.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('visibilitychange', onVisibility)
    clear()
  }
}
