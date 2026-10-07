import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { FocusScope } from '@radix-ui/react-focus-scope'
import { NOMI_OVERLAY_Z_INDEX, hasOpenDialogAbove, hasOpenPopupAbove, isInsidePopupAbove } from './overlayLayers'
import { resolveAnchoredPopoverPlacement, type AnchoredPopoverAlign, type AnchoredPopoverSide } from './anchoredPopoverPlacement'

/**
 * 锚点浮层：Portal 到 body + fixed 贴锚点，**逃出祖先 overflow 的裁切**。
 *
 * ## 什么时候用它、什么时候用别的（按**浮层里放的是什么**分，不按组件名分）
 *
 * | 浮层里是 | 用谁 | 判据 |
 * |---|---|---|
 * | **一列可执行的动作** | `src/design/menu.tsx` 的 `WorkbenchMenu`（Radix） | 内容是 `menuitem` / `menuitemcheckbox` / `menuitemradio` 的列表，选一项就发生一件事并（默认）收起 |
 * | **一块要读、要填、要拖的内容** | **本组件** | 里面有输入框、滑块、画布、缩略图预览这类多焦点富内容 |
 * | 居中模态 | `DesignModal`（Mantine） | 不锚点，自带遮罩 |
 * | 纯提示文字 | Radix Tooltip（`src/design/tooltip.tsx`） | 只读一句话，hover 出现 |
 *
 * **为什么按内容分而不是按名字分**：`role="menu"` 不等于菜单。三个活生生的反例——它们名字里带
 * menu、role 也写着 menu，但都属于上表第二行（要读/要填的内容），该走本组件而不是 `WorkbenchMenu`：
 *   · `workbench/ai/ProjectAgentResidentShell.tsx:514` 会话列表——每行两个可聚焦按钮（切换 + 删除）、
 *     头部还有「新会话」动作；菜单项的语义是「一项一动作」；
 *   · `workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:179` 提示词选择器——hover 出图文
 *     预览副面板、`max-h-[310px]` 滚动长列表，是 listbox/picker；
 *   · `ui/onboarding/workflowPage/WorkflowNodeMenu.tsx:101` ——头部有 ✕ 关闭钮、字段行是 mono 值预览，
 *     是节点属性面板。
 * 上一版这里写的是「本组件是全站唯一的浮层定位机制」，那句话从来不是真的（当时就有 8 个反例）；
 * 别再写一句新的「全站唯一」，写清楚**判据**。
 *
 * 焦点（打开聚焦 / 浮层内 Tab 循环 / 关闭还焦点）不属于这四套定位：归 Radix `FocusScope`（本组件对带 onClose 的浮层套它）。
 *
 * ## 全仓浮层定位现有四套（2026-09-08 复核）
 *   ① 本组件 —— 生产侧 4 个消费者（`workbench/timeline/TimelineTransitionPicker.tsx`、
 *      `workbench/assets/AssetPickerPopover.tsx`、`workbench/library/ProjectSyncBadge.tsx`、
 *      `workbench/creation/storyboard/shotRow/ShotComposerBar.tsx`
 *      ——后两个分别是 2026-09-12 与 2026-09-17 从 ④ 那类「原地 absolute」收编过来的；
 *      2026-09-21 又收编了 `generationCanvas/components/CanvasControlsHelpPopover.tsx`：它在画布导航竖列里
 *      原地 absolute，被困在竖列 z-8 的层叠上下文里，底部浮着的 Agent 收起坞与批量生成条都盖得住它），
 *      外加设计实验室的 3 处陈列；2026-10-05 又收编了分镜表里四个原地 absolute 的行内浮层
 *      （行 ⋯ 菜单、「用作…」菜单、提示词片段菜单、参考悬停预览——后者用 `passThrough`）：
 *      行在表格的 overflow-hidden 里，最后一行的菜单被裁成一条边；
 *   ② Radix —— `src/design/tooltip.tsx`（tooltip 一族）**与 `src/design/menu.tsx`（菜单一族，
 *      2026-09-08 刀 1 起：`timeline/TimelineContextMenu.tsx`、
 *      `generationCanvas/components/NodeContextMenu.tsx`）**。刀 1 没有引进第五套定位库，
 *      是让已经在用的这一套多担一个用途；
 *   ③ Mantine —— `src/design/overlays.tsx` 的 `DesignModal`（Modal 自带定位与遮罩）；
 *   ④ 手写 `getBoundingClientRect()` + `createPortal` —— **8 个文件**：
 *      `generationCanvas/nodes/{NodeGenerationComposer,InlineParameterBar,ClipNode,PanoramaViewer}.tsx`、
 *      `generationCanvas/components/{SelectionPromptSaveController,ScreenshotCropOverlay}.tsx`、
 *      `creation/DocumentListSidebar.tsx`、`assets/AssetTile.tsx`。
 *
 * **这个 8 是要被改的数，不是装饰**：④ 每收一处，就把这里的数字和名单当场改掉；
 * 数对不上就是这段注释又过期了（下一步是把名单交给 `check:` 脚本数，注释只留规则）。
 * ② 不收（Radix 的 a11y / 键盘 / 避让是它自带的，重写一遍不划算）；③ 不收（居中模态不是锚点浮层）。
 *
 * 为什么必须 Portal 而不是在原地写 absolute：只要浮层与它的定位祖先之间夹着一个
 * `overflow: hidden`（时间轴的轨道格、composer 卡、属性面板的分组…），浮层就会被裁成一条边。
 * 这一族最阴的地方在于**三样常用证据全都看不出来**：
 *   · DOM 里在（count>0、toBeVisible 都绿）；
 *   · getBoundingClientRect 照样报完整尺寸——**裁切不改 rect**；
 *   · Playwright 的 click 会先 scrollIntoViewIfNeeded 把那个容器滚一下再点，所以脚本点得动。
 * 唯独真人看不见、也点不到。2026-09-06 的转场选择器就是这么绿了一整轮走查
 * （49 个采样点只有 7 个命中，8 颗按钮里 7 颗 elementFromPoint 落到别的轨道上）。
 *
 * 判据别再用 rect，用 `tests/ux/_assert.mjs` 的 measureOverlayReach / expectOverlayReachable。
 */

export type AnchoredPopoverProps = {
  /** 贴谁。不给就贴「浮层原本在流里的那个位置」（组件会就地留一个 0 尺寸锚点）。 */
  anchorRef?: React.RefObject<HTMLElement | null>
  /**
   * 「不许盖住」的那块比锚点元素大时给（节点浮条的下拉：触发钮连同它所在的那一排，见 `ToolbarActionMenu`）。
   * 只管放哪儿；「点在锚点上不算点外面」仍按 `anchorRef`。
   */
  anchorRect?: () => DOMRect
  /** 相对锚点的横向对齐。 */
  align?: AnchoredPopoverAlign
  /** 先往哪边放（默认下方；放不下自动翻边）。 */
  side?: AnchoredPopoverSide
  /** 锚点与浮层之间的缝。 */
  gap?: number
  /** 层级。默认走 overlayLayers 的 popover 档；调用方要压低（例如让位给更高的模态）才传。 */
  zIndex?: number
  /** 传了就接管「点外面 / Esc 关闭」。不传则由调用方自己管开合。 */
  onClose?: () => void
  /** 纯展示浮层（悬停预览）：不接鼠标事件，指针穿过它去碰下面的东西。 */
  passThrough?: boolean
  children: React.ReactNode
}

type Placement = { top: number; left: number; maxHeight?: number }


/** 浮层内容在流里的自然高度：直接子元素的布局高度之和（不受外壳 maxHeight 影响，也不算绝对定位的后代）。 */
function naturalContentHeight(pop: HTMLElement | null): number {
  if (!pop) return 0
  let total = 0
  for (const child of Array.from(pop.children)) {
    if (child instanceof HTMLElement && getComputedStyle(child).position !== 'absolute' && getComputedStyle(child).position !== 'fixed') total += child.offsetHeight
  }
  return total || pop.offsetHeight
}

export function AnchoredPopover({
  anchorRef,
  anchorRect,
  align = 'start',
  side = 'bottom',
  gap = 4,
  zIndex,
  onClose,
  passThrough = false,
  children,
}: AnchoredPopoverProps): JSX.Element {
  const fallbackAnchorRef = React.useRef<HTMLSpanElement>(null)
  const popRef = React.useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = React.useState<Placement | null>(null)
  // 打开前谁有焦点。渲染期读：此时子树的 autoFocus 还没跑，读到的才是触发器；
  // FocusScope 自己在挂载 effect 里记「之前的焦点」，那时子树里的输入框已经 autoFocus 了，记到的是输入框（关闭后它被卸载，焦点落空）。
  const [openerBeforeOpen] = React.useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement))
  // 只有「会被关掉的交互浮层」管焦点；悬停预览（passThrough）与自己管开合的浮层（没传 onClose）不碰。
  const managesFocus = Boolean(onClose) && !passThrough

  // 调用方常写成内联函数：放进 ref，身份变了不重建 reposition（否则每次渲染都重算 → setState → 再渲染）。
  const anchorRectRef = React.useRef(anchorRect)
  React.useLayoutEffect(() => { anchorRectRef.current = anchorRect })
  const reposition = React.useCallback(() => {
    const anchor = anchorRef?.current ?? fallbackAnchorRef.current
    const pop = popRef.current
    if (!anchor || !anchor.isConnected) return
    setPlacement(resolveAnchoredPopoverPlacement(
      anchorRectRef.current ? anchorRectRef.current() : anchor.getBoundingClientRect(),
      // 高度量内容的自然高：被 maxHeight 收过的外壳高度会让下一次判成「放得下」，来回抖；
      // 也不能用外壳的 scrollHeight——浮层里自己挂出来的下拉（NomiSelect 的 portalTarget 指回浮层）是绝对定位的，
      // 会把 scrollHeight 撑高，于是一打开子下拉就误判成「放不下」、收高度滚动，子下拉被裁掉（composerLifecycle 那条）。
      { width: pop?.offsetWidth || 300, height: naturalContentHeight(pop) || 360 },
      align,
      gap,
      { width: window.innerWidth, height: window.innerHeight },
      side,
    ))
  }, [align, anchorRef, gap, side])

  // 两段式：先按估计尺寸放一次，渲染后按实测尺寸修正（修正前 visibility:hidden，不闪）。
  React.useLayoutEffect(reposition, [reposition])

  // 锚点会动：时间轴横向滚动、面板拖宽、窗口缩放。跟着重算，别让浮层停在原地指着空气。
  // 浮层自己也会变高（转场选择器换成「硬切」就少一行时长）——向上翻转时高度是位置的输入，
  // 不跟着重算就会把长高的那一截顶出视口，于是又变回「露不全」。
  React.useEffect(() => {
    const onMove = () => reposition()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onMove)
    if (observer && popRef.current) observer.observe(popRef.current)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
      observer?.disconnect()
    }
  }, [reposition])

  const dismissOnEscape = React.useCallback((event: KeyboardEvent) => {
    if (!onClose || event.key !== 'Escape') return false
    const pop = popRef.current
    if (!pop || hasOpenPopupAbove(pop)) return false
    // The content may declare this popover's own dialog; it is not a layer above us.
    if (hasOpenDialogAbove(pop.querySelector<HTMLElement>('[role="dialog"]') ?? pop)) return false
    if (event.isComposing || event.defaultPrevented) return true
    event.preventDefault()
    event.stopPropagation()
    onClose()
    return true
  }, [onClose])

  React.useEffect(() => {
    if (!onClose) return undefined
    // 「关掉我」这件事有两条路（Esc / 点外面），两条都必须给**我自己弹出来的那一层**让位：
    // 下拉和菜单 Portal 到 body，DOM 上不在我里面，不让位就会出现「浮层里的选择器改不了值」
    // 和「Esc 本想收下拉却把整个浮层关了」。判据走 overlayLayers 那一份，两条路同一套。
    const onKey = (event: KeyboardEvent) => {
      // Internal controls receive Escape first, then the portal's React bubble handler.
      // External focus (e.g. the trigger) still needs capture before React Flow unselects it.
      if (event.target instanceof Node && popRef.current?.contains(event.target)) return
      dismissOnEscape(event)
    }
    const onDown = (event: MouseEvent) => {
      const target = event.target as globalThis.Node
      const anchor = anchorRef?.current ?? fallbackAnchorRef.current
      if (popRef.current?.contains(target) || anchor?.contains(target)) return
      if (popRef.current && isInsidePopupAbove(popRef.current, event.target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [anchorRef, dismissOnEscape, onClose])

  const body = (
    <div
      ref={popRef}
      // 浮层让位给自己弹出的下拉/菜单时不会 stopPropagation，那一下 Escape 会继续走到
      // React Flow 的 NodeWrapper 并取消选中 —— 节点的 composer 连同这张浮层一起消失。
      // `.nokey` 是 @xyflow/system `isInputDOMNode` 认的排除边界：声明在**自己**的 Portal
      // 根上（不写进调用方锚点的 className，那会被调用方下一次渲染冲掉）。
      className="nokey"
      style={{
        position: 'fixed',
        top: placement?.top ?? -9999,
        left: placement?.left ?? -9999,
        zIndex: zIndex ?? NOMI_OVERLAY_Z_INDEX.popover,
        // 放好位置前用 opacity 0 而不是 visibility:hidden——FocusScope 在挂载时就要聚焦，hidden 的元素聚焦不上。
        opacity: placement ? 1 : 0,
        ...(placement?.maxHeight !== undefined ? { maxHeight: placement.maxHeight, overflowY: 'auto' as const } : {}),
        outline: 'none',
        ...(passThrough ? { pointerEvents: 'none' as const } : {}),
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (!onClose || event.key !== 'Escape' || !event.currentTarget.contains(event.target as Node)) return
        // A child may prevent dismissal without stopping propagation. Keep even that
        // Escape inside this portal; it must not cancel the ancestor node's selection.
        if (dismissOnEscape(event.nativeEvent)) event.stopPropagation()
      }}
    >
      {children}
    </div>
  )
  // 焦点归 Radix FocusScope（已在依赖树里，菜单 / tooltip 同一家）：打开时进浮层（子树自己 autoFocus 的输入框不被抢）、
  // 浮层内 Tab 循环、关闭还给打开前的元素。不自写 tabbable 查询。悬停预览与自己管开合的浮层不套。
  const layer = managesFocus ? (
    <FocusScope
      asChild
      loop
      onUnmountAutoFocus={(event) => {
        // 还给「打开前」的元素（见上），不用 FocusScope 默认记的那个；用户已把焦点挪到别处（点了另一个输入框）就不抢回来。
        event.preventDefault()
        const active = document.activeElement
        if ((!active || active === document.body) && openerBeforeOpen instanceof HTMLElement && openerBeforeOpen.isConnected) {
          openerBeforeOpen.focus({ preventScroll: true })
        }
      }}
    >
      {body}
    </FocusScope>
  ) : body

  return (
    <>
      {/* 0 尺寸锚点：不给 anchorRef 时用它代表「浮层原本该待的位置」。 */}
      {anchorRef ? null : <span ref={fallbackAnchorRef} className="inline-block h-0 w-0 align-bottom" aria-hidden="true" />}
      {typeof document === 'undefined' ? layer : createPortal(layer, document.body)}
    </>
  )
}
