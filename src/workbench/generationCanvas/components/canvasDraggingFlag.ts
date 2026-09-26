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
// 和光标那次栽的是同一个坑（见 reactFlow/useGenerationCanvasReactFlowPointer 的 data-panning 那段注释）。
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

export type CanvasDragLease = { activate: () => void; release: () => void; cancel: () => void }
/** 这次手势最后一次已知的指针位置（收尾时用来补发松手）。 */
export type CanvasDragPoint = { clientX: number; clientY: number }
const draggingOwnersByStage = new WeakMap<Element, Set<symbol>>()

/**
 * 还没结束的那些租约。**只为「宿主把画布藏起来了」这一件事存在**。
 *
 * 2026-09-21：这里原来是给每一次手势装一个 MutationObserver，观测整条祖先链的
 * `attributes` + `childList`，回调里对十几层祖先逐个 `getComputedStyle()`。
 * React Flow 在拖动过程中持续增删 `.react-flow__viewport` 的子节点，于是那个回调**每帧**都触发，
 * 每帧强制一轮同步样式重算——正好落在团队把拖图从 49.3ms 压到 12.9ms 的那条热路径上。
 *
 * 而它要解决的问题（「工作区槽位隐藏时租约不释放」）根本不需要观测：**槽位隐藏是宿主自己知道的事**。
 * 所以改成宿主在隐藏路径上显式喊一声（`cancelCanvasDraggingWithin`），热路径上一个观察者都不装。
 */
const liveLeases = new Set<{ origin: Element; stage: Element | null | undefined; pointerId?: number; cancel: () => void }>()

/**
 * 标志的寿命上限 = 这一次指针手势。**租约模型的最后一道闸**。
 *
 * 升起标志的每一位 owner（拖节点 / 拖选区 / 拖框 / 平移）都是**按着指针**才会发生的动作，所以
 * 指针一松开（pointerup / pointercancel / 窗口失焦），这张画布上就不该再有任何租约。
 * 各租约自己的 `release()` 照旧走；这里只保证：哪位 owner 的收尾因为时序没走到，标志也**不会活过这次手势**。
 *
 * 为什么必须在这一层兜（main #836 / 2026-09-22 用户报「选中节点浮框整个没了 / 点『2 版』没反应」）：
 * 视口平移的收尾被 React Flow 推迟 150ms（`panOnScroll` 时 `createPanZoomEndHandler` 用 setTimeout 防抖），
 * 这 150ms 里任何一次画布内按下都会把「这次平移动过没」重置掉，收尾于是跳过，`data-dragging` 永远留在 true，
 * 浮框 / 浮条 / 版本托盘全部 `invisible`。触发它的是 owner 之间的时序，不是某一位 owner 写错了一行——
 * 只要释放还靠 owner 各自记账，下一位 owner 就能用另一种时序再漏一次。
 *
 * 注意它和 `pointercancel`/`blur` 的**每租约**监听不是两份规则：那一路带 `pointerId`、只收得掉自己这一条，
 * 且要求 owner 传了 pointerId；这一路按 stage 收全部，兜的正是「没人来收」那一格。
 */
const gestureEndGuardByStage = new WeakMap<Element, () => void>()
/** 每次升旗 +1：兜底收尾只收「手势结束那一刻」的租约，不误伤紧接着开始的下一次手势。 */
const activateEpochByStage = new WeakMap<Element, number>()

function scheduleAfterFrame(callback: FrameRequestCallback): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback)
    return
  }
  // Non-browser hosts (Vitest and headless DOM shims) may expose `window` without RAF.
  // Keep the deferred ordering that lets each lease release itself before the guard runs.
  setTimeout(() => callback(typeof performance === 'undefined' ? 0 : performance.now()), 0)
}

function armGestureEndGuard(stage: Element): void {
  activateEpochByStage.set(stage, (activateEpochByStage.get(stage) ?? 0) + 1)
  if (gestureEndGuardByStage.has(stage) || typeof window === 'undefined') return
  const events = ['pointerup', 'pointercancel', 'blur'] as const
  const onGestureEnd = (event: Event) => {
    // 捕获阶段也看得到后代元素的 blur（焦点在控件间移动）；只有窗口本身失焦才算手势被打断。
    if (event.type === 'blur' && event.target !== window) return
    if (event.type !== 'blur' && 'pointerId' in event && typeof event.pointerId === 'number') {
      const hasMatchingLease = [...liveLeases].some(lease =>
        lease.stage === stage && lease.pointerId === event.pointerId,
      )
      if (!hasMatchingLease) return
    }
    disarm()
    const epoch = activateEpochByStage.get(stage)
    // 等一帧再收：正常路径上各租约自己的 `release()`（React 的 pointerup、React Flow 0ms 的 move-end）
    // 先走完，属性只摘一次、和它们的状态更新落在同一轮布局里；只有漏收的那位才轮到这里。
    scheduleAfterFrame(() => {
      if (activateEpochByStage.get(stage) !== epoch || !draggingOwnersByStage.has(stage)) return
      for (const lease of [...liveLeases]) if (lease.stage === stage) lease.cancel()
      if (!draggingOwnersByStage.has(stage)) return
      draggingOwnersByStage.delete(stage)
      stage.removeAttribute(CANVAS_DRAGGING_ATTRIBUTE)
    })
  }
  const disarm = () => {
    for (const name of events) window.removeEventListener(name, onGestureEnd, true)
    gestureEndGuardByStage.delete(stage)
  }
  for (const name of events) window.addEventListener(name, onGestureEnd, true)
  gestureEndGuardByStage.set(stage, disarm)
}

/**
 * 把这个容器里所有还没结束的手势**当作被打断**收掉（宿主隐藏/卸载画布时调）。
 *
 * 与 pointercancel 走同一条 `cancel()`：属性摘掉、`onCancel` 照常回调，
 * 于是「藏起来」和「手指被系统抢走」在画布看来是同一件事——不需要第二套收尾语义。
 */
export function cancelCanvasDraggingWithin(container: Element | null | undefined): void {
  if (!container) return
  for (const lease of [...liveLeases]) {
    if (container.contains(lease.origin) || (lease.stage && container.contains(lease.stage))) lease.cancel()
  }
}

/** One lease captures one stage and one gesture. Late cleanup never looks up a new stage. */
export function beginCanvasDragging(
  origin: Element | null | undefined,
  owner: CanvasDraggingOwner,
  options: {
    onCancel?: (lastPoint: CanvasDragPoint | null) => void
    /**
     * 按着鼠标键的手势才传（拖节点）：松手事件丢了——鼠标键已经松开还在移动，或者浏览器接管成了原生拖放
     * （原生拖放期间不派发 pointerup / mouseup）——就把这次手势当作「在这里松手」收尾。
     * 0.21 的自研拖动有这条保护（「按键已松仍收到移动就清掉拖动状态」），换成 React Flow 时丢了，
     * 于是一次丢失的 mouseup 就让节点粘在光标上（2026-09-25 用户报：导入视频后单击拖动，一直跟着鼠标）。
     */
    onReleaseLost?: (lastPoint: CanvasDragPoint) => void
    pointerId?: number
    active?: boolean
  } = {},
): CanvasDragLease {
  const stage = origin?.closest(STAGE_SELECTOR)
  const token = Symbol(owner)
  let released = false
  let lastPoint: CanvasDragPoint | null = null
  const cleanup: Array<() => void> = []
  const activate = () => {
    if (!stage || released) return
    const owners = draggingOwnersByStage.get(stage) ?? new Set<symbol>()
    draggingOwnersByStage.set(stage, owners)
    owners.add(token)
    stage.setAttribute(CANVAS_DRAGGING_ATTRIBUTE, 'true')
    armGestureEndGuard(stage)
  }
  if (options.active !== false) activate()
  const release = () => {
    if (released) return
    released = true
    cleanup.forEach(dispose => dispose())
    const owners = stage && draggingOwnersByStage.get(stage)
    if (!owners?.delete(token) || owners.size) return
    draggingOwnersByStage.delete(stage!)
    gestureEndGuardByStage.get(stage!)?.()
    stage!.removeAttribute(CANVAS_DRAGGING_ATTRIBUTE)
  }
  const cancel = () => {
    if (released) return
    release()
    options.onCancel?.(lastPoint)
  }
  if (origin && typeof window !== 'undefined') {
    const interrupted = (event: Event) => {
      // Capture also sees descendant focus changes; only window blur interrupts a gesture.
      if (event.type === 'blur' && event.target !== window) return
      if (event.type !== 'blur') {
        if ('pointerId' in event && options.pointerId !== undefined) {
          if (event.pointerId !== options.pointerId) return
        } else if (!(typeof Node !== 'undefined' && event.target instanceof Node && (origin.contains(event.target) || stage?.contains(event.target)))) return
      }
      cancel()
    }
    for (const name of ['blur', 'pointercancel', 'lostpointercapture']) {
      window.addEventListener(name, interrupted, true)
      cleanup.push(() => window.removeEventListener(name, interrupted, true))
    }
    if (options.onReleaseLost) {
      const onReleaseLost = options.onReleaseLost
      const releaseLost = (event: Event) => {
        if (released) return
        const pointer = event as PointerEvent
        if (typeof pointer.clientX === 'number') lastPoint = { clientX: pointer.clientX, clientY: pointer.clientY }
        if (event.type === 'pointermove' && (pointer.pointerType !== 'mouse' || pointer.buttons !== 0)) return
        release()
        onReleaseLost(lastPoint ?? { clientX: 0, clientY: 0 })
      }
      for (const name of ['pointermove', 'dragstart']) {
        window.addEventListener(name, releaseLost, true)
        cleanup.push(() => window.removeEventListener(name, releaseLost, true))
      }
    }
    const visibility = () => { if (document.hidden) cancel() }
    document.addEventListener('visibilitychange', visibility)
    cleanup.push(() => document.removeEventListener('visibilitychange', visibility))
    // 工作区槽位隐藏时仍然挂着（`hidden` 不卸载），所以「藏起来了」要由宿主显式喊一声，
    // 见 `cancelCanvasDraggingWithin`。登记只是一次 Set.add，热路径上零观察者、零 getComputedStyle。
    const record = { origin, stage, pointerId: options.pointerId, cancel: () => cancel() }
    liveLeases.add(record)
    cleanup.push(() => liveLeases.delete(record))
  }
  return { activate, release, cancel }
}
