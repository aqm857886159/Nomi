// 画布指针仲裁的**唯一真相表**（纯函数，靠单测锁真值表；hook 只负责临时状态与副作用）。
//
// 2026-08-08 用户真机拍板，反转 08-07 的 selection-first：画布的主导作用是**看图**，
// 平移是每分钟都在做的高频动作、框选是低频批量动作。高频动作必须占默认手势，
// 低频动作退到修饰键后（Shift）——这是 ComfyUI / Figma / Miro 的最大公约数。
export const CANVAS_DRAG_THRESHOLD = 4

// 「画布空白」的反向定义：命中这些元素就不是空白，指针归它们自己（节点、工具条、边命中区、菜单、表单控件）。
// 收在模型层是为了让「谁算空白」只有一处定义——平移与框选共用同一张表，语义不会漂移。
export const CANVAS_INTERACTIVE_TARGET_SELECTOR =
  '.generation-canvas-v2-node, .generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__minimap, .generation-canvas-v2__selection-toolbar, .generation-canvas-v2__edge-hit, .generation-canvas-v2__edge-cut, .generation-canvas-v2__edge-control, button, input, textarea, select, [role="menu"], [role="menuitem"]'

export function isCanvasInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element ? Boolean(target.closest(CANVAS_INTERACTIVE_TARGET_SELECTOR)) : false
}

// 「浮层菜单」的单一判据。菜单（节点右键菜单、边菜单）都渲染在 stage 里，而收起菜单发生在
// capture 阶段——子项的 stopPropagation 来不及拦。谁都必须先问过这张表再收菜单，否则
// pointerdown 先卸载菜单、后续 click 无目标，表现为「点了没反应」。
export const CANVAS_MENU_TARGET_SELECTOR = '[role="menu"], [role="menuitem"], [role="menuitemradio"]'

export function isCanvasMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element ? Boolean(target.closest(CANVAS_MENU_TARGET_SELECTOR)) : false
}

export type CanvasPointerDownAction = 'frame' | 'pan' | 'marquee' | 'ignore'

type CanvasPointerDownInput = {
  button: number
  spaceHeld: boolean
  shiftKey: boolean
  interactiveTarget: boolean
  readOnly: boolean
  /** 框工具已就绪（左下工具簇那颗「框」钮按下，或按过 F）。 */
  frameToolArmed?: boolean
}

/**
 * 一次 pointerdown 该干嘛。只读事件事实，不碰 DOM：
 *   · 空格 / 中键 / 右键 → 平移（压在节点上也生效，capture 阶段就抢）
 *   · 框工具就绪 + 左键（空白）→ 画框。**排在平移前面**：工具就绪是用户刚刚做出的显式选择，
 *     此刻他要的是画一个框，不是挪画布；平移随时可用（空格/中键/右键都通），不会被堵死。
 *   · Shift + 左键（空白）→ 框选（追加；只读态没有选区可改，忽略）
 *   · 左键（空白）→ 平移。只读态同样放行——看图的人更需要能拖。
 */
export function resolveCanvasPointerDownAction(input: CanvasPointerDownInput): CanvasPointerDownAction {
  if (input.spaceHeld || input.button === 1 || input.button === 2) return 'pan'
  if (input.button !== 0 || input.interactiveTarget) return 'ignore'
  if (input.frameToolArmed) return input.readOnly ? 'ignore' : 'frame'
  if (!input.shiftKey) return 'pan'
  return input.readOnly ? 'ignore' : 'marquee'
}

/**
 * capture 阶段只接「压在节点上也要平移」的三个入口。空白左键平移**必须**留到 bubble 阶段——
 * capture 抢在节点/控件的 pointerdown 之前，在那里接左键等于把节点拖拽和按钮点击一起吞掉。
 */
export function isCanvasCapturePanPointer(input: { button: number; spaceHeld: boolean }): boolean {
  return input.spaceHeld || input.button === 1 || input.button === 2
}

/**
 * 主指针已经按下后才形成的平移和弦（指针从别处滑进 stage、或按下左键后再补按空格/中键）。
 * **不含裸左键**：裸左键此刻可能正在框选或拖节点，在 move 里认领它会把那两件事劫走。
 */
export function resolveCanvasPanButtonFromMove(input: {
  buttons: number
  spaceHeld: boolean
}): 0 | 1 | 2 | null {
  if ((input.buttons & 2) !== 0) return 2
  if ((input.buttons & 4) !== 0) return 1
  if (input.spaceHeld && (input.buttons & 1) !== 0) return 0
  return null
}

/** 平移是否还该继续：只问发起它的那颗键还按着没。空格中途松开由 keyup 单独收尾（见 useCanvasViewportGestures）。 */
export function isCanvasPanButtonHeld(button: 0 | 1 | 2, input: { buttons: number }): boolean {
  if (button === 2) return (input.buttons & 2) !== 0
  if (button === 1) return (input.buttons & 4) !== 0
  return (input.buttons & 1) !== 0
}

export function canvasDragExceededThreshold(startX: number, startY: number, x: number, y: number): boolean {
  return Math.abs(x - startX) >= CANVAS_DRAG_THRESHOLD || Math.abs(y - startY) >= CANVAS_DRAG_THRESHOLD
}

export function shouldFinishCanvasConnection(button: number, pointerUpConsumed = false): boolean {
  return button === 0 && !pointerUpConsumed
}

export function shouldPreventDefaultForCanvasPanStart(button: number): boolean {
  return button !== 2
}

export function isMacCanvasPlatform(platform: string): boolean {
  return /(Mac|iPhone|iPad|iPod)/i.test(platform)
}

export function isCanvasContextMenuPointer(button: number, ctrlKey: boolean, platform: string): boolean {
  return button === 2 || (button === 0 && ctrlKey && isMacCanvasPlatform(platform))
}

// ─────────────────────────────────────────────────────────────────────────────
// 右键落点判定（2026-09-06 真机取证：tests/ux/shots/group-frame-now/00b2、00b3）
//
// 「空白」原先是**反向定义**的：命中 `.generation-canvas-v2-node` 才算节点，其余一律当空白。
// 可画布上还有第三种东西——**代表当前选中集的罩子**：shift 拖框选完成后，React Flow 会在整片
// 选中节点之上铺一层 `nodesselection-rect`（本仓在 generationCanvasReactFlow.css 里给它上了中性皮肤，
// 拖它 = 拖整批）。右键落在这层上取不到 data-node-id，于是被反向定义吞成「空白」→
// 清掉刚框好的选择 + 弹「添加节点」菜单 →「建组」当场不可达（实测 nodeMenu 0 / addMenu 1）。
//
// 所以落点必须**正向**分三类，且这张表只此一份：谁想知道「这次右键点的是什么」都问它。
// ─────────────────────────────────────────────────────────────────────────────

/** 框选完成后 React Flow 铺在选中节点之上的罩子。语义上它**就是当前选中集**，不是画布空白。 */
export const CANVAS_SELECTION_OVERLAY_SELECTOR = '.react-flow__nodesselection, .react-flow__nodesselection-rect'

export function isCanvasSelectionOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element ? Boolean(target.closest(CANVAS_SELECTION_OVERLAY_SELECTOR)) : false
}

/**
 * 右键落在什么上：
 *   · 'node'      某个节点 —— 先确保它在选中集里，再弹「节点操作」菜单
 *   · 'selection' 当前选中集的罩子 —— 已经选好了，**原样保留**，同样弹「节点操作」菜单
 *   · 'frame'     某个框的框体 —— 弹这个框自己的菜单（与头部 ⋯ 同一份）
 *   · 'blank'     真空白 —— 清掉选择，弹「添加节点」菜单
 *
 * 2026-09-06 从三分扩到四分：在此之前框体上右键取不到 data-node-id，被反向定义吞成
 * 「空白」→ 弹的是「添加节点」，框的改名/解散/整框动作一个都不可达（实拍 d、d2）。
 */
export type CanvasContextMenuTarget = 'node' | 'selection' | 'frame' | 'blank'

/**
 * 只有 'blank' 才允许清选择。命中罩子/框体却判成 'blank' 就是这张表要防的那类 bug，
 * 真值表由 canvasPointerGestureModel.test.ts 钉死。
 *
 * 顺序有语义：节点压在框上面，所以先问节点；选中罩子又压在两者之上，但它只在框选之后存在，
 * 而框选出来的一定是节点集 —— 罩子在，就以罩子为准。
 */
export function resolveCanvasContextMenuTarget(input: {
  nodeId: string | null
  selectionOverlay: boolean
  frameId?: string | null
}): CanvasContextMenuTarget {
  if (input.nodeId) return 'node'
  if (input.selectionOverlay) return 'selection'
  return input.frameId ? 'frame' : 'blank'
}

// ─────────────────────────────────────────────────────────────────────────────
// 拖进 = 入组，拖出 = 退组（2026-09-06 框工具第一档）
//
// 修的是实拍里最伤的那一下（tests/ux/shots/group-frame-now/README.md 的 e、e2）：
// 把成员拖到框外松手，框会**追着长大把它重新包住**，成员没退组，拖动中也没有任何提示。
// 用户的动作是「把这张图移出这一组」，画布的回应是「我把这一组变大了」——两件相反的事。
//
// 判据是**中心点**：拖动中的节点中心落在框内 = 属于这个框。
//   · 「任意重叠」太松：卡片挨着框边就被吸进去；
//   · 「完全包含」太苛：一张比框还大的卡永远进不去。
// 中心点是 Figma / Miro 的最大公约数，也是用户唯一能一眼预判的那条线。
// ─────────────────────────────────────────────────────────────────────────────

export type CanvasFrameMembershipChange = 'join' | 'leave' | 'none'

/** 节点中心是否落在这个框的渲染矩形里（含边界：正好压在边上算在里面，宽容一侧）。 */
export function frameContainsNodeCenter(
  frame: { x: number; y: number; w: number; h: number },
  node: { x: number; y: number; width: number; height: number },
): boolean {
  const centerX = node.x + node.width / 2
  const centerY = node.y + node.height / 2
  return centerX >= frame.x && centerX <= frame.x + frame.w && centerY >= frame.y && centerY <= frame.y + frame.h
}

/**
 * 松手时这个节点相对这个框会发生什么。纯真值表，两个布尔决定一切：
 *   在框内 + 还不是成员 → 'join'
 *   不在框内 + 已是成员 → 'leave'
 *   其余 → 'none'（拖动中一直在框里挪 = 什么都不该发生）
 */
export function resolveCanvasFrameMembership(input: {
  inside: boolean
  isMember: boolean
}): CanvasFrameMembershipChange {
  if (input.inside) return input.isMember ? 'none' : 'join'
  return input.isMember ? 'leave' : 'none'
}
