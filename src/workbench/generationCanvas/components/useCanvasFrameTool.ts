/**
 * 「画一个框」这件事的全部：工具就绪状态、F 快捷键、拖出矩形的手势、落笔建框。
 *
 * 为什么是画布工具而不是加号菜单里的一项（2026-09-06 拍板）：加号那一族回答的是
 * 「往画布上**加**点什么」——加完你会去编辑它的内容。框不是内容，是**你摆东西的地方**，
 * 用户对它的动作是「圈起来」而不是「新建一个」。所以它住在左下那簇画布工具里
 * （和缩放/适配同一族：都在调整你怎么看/怎么摆），不进加号（canvasToolbarModel 的意图表）。
 *
 * 手势归属**用声明式开关，不在 capture 阶段偷事件**（2026-09-07 R29 §6.2，
 * docs/research/2026-09-07-react-flow-subflows-vs-frame.md）：工具就绪期间画布传
 * `panOnDrag={false}` + `nodesDraggable={false}`，内核**知道**这次拖动不归它，
 * 于是空白左键自然落到 bubble 阶段的本 hook 手里。
 *
 * 在此之前这里是 `onPointerDownCapture` + `stopPropagation()`——内核以为自己还在管平移，
 * `onMoveStart/onMove/onMoveEnd` 与画框各活各的；React Flow 哪天改事件绑定阶段，
 * 这里会**静默**失效（画不出框，没有任何报错）。R28：能让框架自己拦的，别留给偷袭。
 *
 * 就绪期间平移仍然可用：空格 / 中键 / 右键走的是 useGenerationCanvasReactFlowPointer 的
 * 辅助平移，不经过 React Flow 的 panOnDrag，不会被这颗工具堵死。
 */
import React from 'react'
import i18n from '../../../i18n'
import { showInfoToast } from '../../../utils/showInfoToast'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  drawPreviewRect,
  frameRectsOverlap,
  normalizeDrawnFrameBounds,
  type CanvasFrameRect,
} from '../model/canvasFrameBounds'
import { MIN_NODE_HEIGHT, MIN_NODE_WIDTH } from '../nodes/nodeSizing'
import { isCanvasInteractiveTarget, resolveCanvasPointerDownAction } from './canvasPointerGestureModel'
import type { CanvasGroupBox } from './GroupFrame'

type UseCanvasFrameToolArgs = {
  readOnly: boolean
  activeCategoryId: string
  /** 现有的框，用来判「在框里起画」（第一档不做嵌套框）。 */
  frameBoxes: readonly CanvasGroupBox[]
  getCanvasPointFromClientPoint: (clientX: number, clientY: number) => { x: number; y: number }
}

export type CanvasFrameTool = {
  armed: boolean
  toggle: () => void
  /** 正在拖出来的那个矩形（画布坐标），供画布叠一层预览。 */
  drawPreview: CanvasFrameRect | null
  /**
   * 冒泡阶段的 pointerdown。返回 true = 这次手势归画框，调用方跳过自己的平移记账。
   * **不 stopPropagation**：内核已被 `panOnDrag={false}` 明确停用，不需要瞒着它。
   */
  handlePointerDown: (event: React.PointerEvent<HTMLDivElement>) => boolean
}

export function useCanvasFrameTool({
  readOnly,
  activeCategoryId,
  frameBoxes,
  getCanvasPointFromClientPoint,
}: UseCanvasFrameToolArgs): CanvasFrameTool {
  const [armed, setArmed] = React.useState(false)
  const [drawPreview, setDrawPreview] = React.useState<CanvasFrameRect | null>(null)
  const drawRef = React.useRef<{ pointerId: number; start: { x: number; y: number } } | null>(null)
  // 现有框只在落笔那一刻读一次，不进 effect 依赖——拖动中框可能因为别的原因重算，
  // 让手势中途换掉判据会得出一个「起画时不在框里、松手时在」的诡异结论。
  const frameBoxesRef = React.useRef(frameBoxes)
  frameBoxesRef.current = frameBoxes

  const toggle = React.useCallback(() => {
    if (readOnly) return
    setArmed((current) => !current)
  }, [readOnly])

  React.useEffect(() => {
    if (readOnly && armed) setArmed(false)
  }, [armed, readOnly])

  // F 就绪 / Esc 取消。F 是**裸键**：现有画布快捷键全带 ⌘/Ctrl（useCanvasShortcuts），零冲突。
  React.useEffect(() => {
    if (readOnly) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      // 正在文本框里打字时 F 就是字母 F。
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (event.key === 'Escape') {
        setArmed(false)
        drawRef.current = null
        setDrawPreview(null)
        return
      }
      if (event.key !== 'f' && event.key !== 'F') return
      event.preventDefault()
      setArmed((current) => !current)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [readOnly])

  const finishDraw = React.useCallback((clientX: number, clientY: number) => {
    const draw = drawRef.current
    drawRef.current = null
    setDrawPreview(null)
    // 画一次收一次工具：一个出不去的模式是画布上最容易困住人的东西。要连画就再按一次 F。
    setArmed(false)
    if (!draw) return
    const end = getCanvasPointFromClientPoint(clientX, clientY)
    const bounds = normalizeDrawnFrameBounds(draw.start, end, { width: MIN_NODE_WIDTH, height: MIN_NODE_HEIGHT })
    // 手抖（短边小于误点阈值）→ 什么都不发生，不在画布上留下一个针尖大又难选中的框。
    if (!bounds) return
    // 第一档不做嵌套框：起画点落在已有框里就明说，不静默吞掉这个手势（D4 诚实交付）。
    const overlapped = frameBoxesRef.current.some((box) =>
      frameRectsOverlap({ x: box.left, y: box.top, w: box.width, h: box.height }, bounds),
    )
    if (overlapped) {
      showInfoToast(i18n.t('generationCommon.canvas.group.nestedNotSupported'))
      return
    }
    useGenerationCanvasStore
      .getState()
      .createFrame(activeCategoryId, bounds, i18n.t('generationCommon.canvas.group.untitledFrame'))
  }, [activeCategoryId, getCanvasPointFromClientPoint])

  React.useEffect(() => {
    if (!drawPreview && !drawRef.current) return undefined
    const handleMove = (event: PointerEvent) => {
      const draw = drawRef.current
      if (!draw || draw.pointerId !== event.pointerId) return
      setDrawPreview(drawPreviewRect(draw.start, getCanvasPointFromClientPoint(event.clientX, event.clientY)))
    }
    const handleUp = (event: PointerEvent) => {
      if (drawRef.current && drawRef.current.pointerId !== event.pointerId) return
      finishDraw(event.clientX, event.clientY)
    }
    const handleCancel = () => {
      drawRef.current = null
      setDrawPreview(null)
      setArmed(false)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    window.addEventListener('blur', handleCancel)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      window.removeEventListener('blur', handleCancel)
    }
  }, [drawPreview, finishDraw, getCanvasPointFromClientPoint])

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>): boolean => {
    const action = resolveCanvasPointerDownAction({
      button: event.button,
      spaceHeld: false,
      shiftKey: event.shiftKey,
      interactiveTarget: isCanvasInteractiveTarget(event.target),
      readOnly,
      frameToolArmed: armed,
    })
    if (action !== 'frame') return false
    // preventDefault 只挡浏览器默认（选文本 / 拖图），不影响 React Flow——
    // 它此刻的 panOnDrag 已经是 false，这次拖动本来就不归它。
    event.preventDefault()
    const start = getCanvasPointFromClientPoint(event.clientX, event.clientY)
    drawRef.current = { pointerId: event.pointerId, start }
    setDrawPreview({ x: start.x, y: start.y, w: 0, h: 0 })
    return true
  }, [armed, getCanvasPointFromClientPoint, readOnly])

  return { armed, toggle, drawPreview, handlePointerDown }
}
