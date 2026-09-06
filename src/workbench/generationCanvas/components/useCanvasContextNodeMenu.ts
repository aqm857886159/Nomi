import React from 'react'
import { clampNumber } from './generationCanvasGeometry'
import {
  canvasDragExceededThreshold,
  isCanvasContextMenuPointer,
  isCanvasSelectionOverlayTarget,
  resolveCanvasContextMenuTarget,
} from './canvasPointerGestureModel'
import type { CanvasContextMenuTarget } from './canvasPointerGestureModel'

type Offset = { x: number; y: number }

export type CanvasContextNodeMenu = {
  stageX: number
  stageY: number
  canvasX: number
  canvasY: number
  /**
   * 右键落在什么上（唯一判据，见 canvasPointerGestureModel.resolveCanvasContextMenuTarget）：
   * 'node' / 'selection' 都弹「节点操作」菜单，只有 'blank' 弹「添加节点」菜单并清选择。
   */
  target: CanvasContextMenuTarget
  /** target === 'node' 时命中的节点 id；'selection' / 'blank' 为 null。 */
  nodeId: string | null
}

type PendingContextNodeMenu = {
  menu: CanvasContextNodeMenu
  pointerId: number
  button: number
  startX: number
  startY: number
  moved: boolean
  contextMenuSeen: boolean
}

type ActiveContextPointer = {
  pointerId: number
  button: number
  contextMenuSeen: boolean
  suppressContextMenu: boolean
}

type UseCanvasContextNodeMenuArgs = {
  readOnly: boolean
  stageRef: React.RefObject<HTMLDivElement>
  offsetRef: React.MutableRefObject<Offset>
  zoomRef: React.MutableRefObject<number>
  pendingConnectionSourceId: string | null
  clearSelection: () => void
  /**
   * 右键落在节点上时保证它是被选中的——菜单里的复制/剪切/删除都作用于「选中项」，
   * 不先选中就会点了没反应（§1.6 C1）。已在多选里的节点要**保留整个多选**，
   * 否则右键会把批量选择打断成单选。
   */
  ensureNodeSelected: (nodeId: string) => void
}

// 这里**不再包含** `.generation-canvas-v2-node`（2026-08-20）：节点原先被一并排除，于是右键节点
// 什么都不弹 = 死路，而复制/剪切/删除只有键盘一条路、没有任何可见入口（群反馈「copy 键是啥呢」）。
// 现在节点改为分流到「节点操作」菜单，空白仍是「添加节点」菜单。
// 仍然排除的是：工具条/浮条/边、以及所有可交互控件——它们有自己的语义，右键不该被画布接管。
const CONTEXT_TARGET_GUARD =
  '.generation-canvas-v2-toolbar, .generation-canvas-v2__zoom-bar, .generation-canvas-v2__selection-toolbar, .generation-canvas-v2__edge, .generation-canvas-v2__edge-preview, button, input, textarea, select, [role="menu"], [role="menuitem"]'
/** 节点根元素上带 data-node-id；右键命中它就把 id 记进 pending 菜单。 */
const NODE_SELECTOR = '.generation-canvas-v2-node'
const MENU_WIDTH = 148
const MENU_HEIGHT = 330
/** 节点操作菜单只有 5 项 + 1 条分隔线，比添加菜单矮得多。 */
const NODE_MENU_HEIGHT = 196
const MENU_EDGE_GAP = 8

/**
 * Blank-canvas context menu lifecycle.
 *
 * Chromium on macOS can dispatch `contextmenu` as soon as the secondary button
 * goes down. Opening the custom menu from that event would therefore interrupt
 * a live primary-button connection or a right-button pan before the gesture is
 * resolved. Queue the candidate on secondary pointer-down, always suppress the
 * browser menu immediately, and only commit the custom menu on pointer-up.
 */
export function useCanvasContextNodeMenu({
  readOnly,
  stageRef,
  offsetRef,
  zoomRef,
  pendingConnectionSourceId,
  clearSelection,
  ensureNodeSelected,
}: UseCanvasContextNodeMenuArgs) {
  const [contextNodeMenu, setContextNodeMenu] = React.useState<CanvasContextNodeMenu | null>(null)
  const pendingMenuRef = React.useRef<PendingContextNodeMenu | null>(null)
  const suppressNextContextMenuRef = React.useRef(false)
  const activeContextPointerRef = React.useRef<ActiveContextPointer | null>(null)

  const prepareContextMenuPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    pendingMenuRef.current = null
    const contextMenuPointer = isCanvasContextMenuPointer(event.button, event.ctrlKey, navigator.platform)
    activeContextPointerRef.current = contextMenuPointer
      ? { pointerId: event.pointerId, button: event.button, contextMenuSeen: false, suppressContextMenu: false }
      : null
    if (!contextMenuPointer || pendingConnectionSourceId) return false
    if (readOnly || !stageRef.current) return false
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(CONTEXT_TARGET_GUARD)) return false

    const rect = stageRef.current.getBoundingClientRect()
    const stageX = event.clientX - rect.left
    const stageY = event.clientY - rect.top
    const zoom = zoomRef.current || 1
    const nodeId = target?.closest(NODE_SELECTOR)?.getAttribute('data-node-id') || null
    const menuTarget = resolveCanvasContextMenuTarget({
      nodeId,
      selectionOverlay: isCanvasSelectionOverlayTarget(target),
    })
    // 节点菜单比添加菜单矮：按各自高度夹边，免得贴着视口下缘弹出时被切掉。
    const menuHeight = menuTarget === 'blank' ? MENU_HEIGHT : NODE_MENU_HEIGHT
    pendingMenuRef.current = {
      pointerId: event.pointerId,
      button: event.button,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      contextMenuSeen: false,
      menu: {
        stageX: clampNumber(stageX, MENU_EDGE_GAP, Math.max(MENU_EDGE_GAP, rect.width - MENU_WIDTH - MENU_EDGE_GAP)),
        stageY: clampNumber(stageY, MENU_EDGE_GAP, Math.max(MENU_EDGE_GAP, rect.height - menuHeight - MENU_EDGE_GAP)),
        canvasX: Math.round((stageX - offsetRef.current.x) / zoom),
        canvasY: Math.round((stageY - offsetRef.current.y) / zoom),
        target: menuTarget,
        nodeId,
      },
    }
    return event.button === 0
  }, [offsetRef, pendingConnectionSourceId, readOnly, stageRef, zoomRef])

  const handleContextMenuPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const secondaryChord = (event.buttons & 3) === 3
    if (secondaryChord) {
      const active = activeContextPointerRef.current
      if (active?.pointerId === event.pointerId) {
        active.suppressContextMenu = true
      } else {
        activeContextPointerRef.current = {
          pointerId: event.pointerId,
          button: 2,
          contextMenuSeen: false,
          suppressContextMenu: true,
        }
      }
    }
    const pending = pendingMenuRef.current
    if (!pending || pending.pointerId !== event.pointerId || pending.moved) return
    pending.moved = canvasDragExceededThreshold(pending.startX, pending.startY, event.clientX, event.clientY)
  }, [])

  const finishContextMenuPointerUp = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    suppressMenu: boolean,
  ) => {
    const pending = pendingMenuRef.current
    if (!pending) {
      if (suppressMenu && !activeContextPointerRef.current?.contextMenuSeen) {
        suppressNextContextMenuRef.current = true
      }
      activeContextPointerRef.current = null
      return
    }
    if (pending.pointerId !== event.pointerId || pending.button !== event.button) return
    suppressNextContextMenuRef.current = !(
      pending.contextMenuSeen || activeContextPointerRef.current?.contextMenuSeen
    )
    if (!suppressMenu && pendingMenuRef.current) {
      if (!pending.moved) {
        // 节点上：先确保它选中（菜单动作都作用于选中项）。
        // 选中集罩子上：选择已经是对的，**碰都别碰**——清一下就等于把刚框好的一批扔掉。
        // 只有真空白才清选择，再弹添加菜单。
        if (pending.menu.target === 'node' && pending.menu.nodeId) ensureNodeSelected(pending.menu.nodeId)
        else if (pending.menu.target === 'blank') clearSelection()
        setContextNodeMenu(pending.menu)
      }
    }
    pendingMenuRef.current = null
    activeContextPointerRef.current = null
  }, [clearSelection, ensureNodeSelected])

  const handleStageContextMenu = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const pending = pendingMenuRef.current
    const active = activeContextPointerRef.current
    if (activeContextPointerRef.current) activeContextPointerRef.current.contextMenuSeen = true
    if (!pending && !suppressNextContextMenuRef.current && !active?.suppressContextMenu) return
    if (pending) pending.contextMenuSeen = true
    suppressNextContextMenuRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  React.useEffect(() => {
    const cancelPendingMenu = () => {
      pendingMenuRef.current = null
      suppressNextContextMenuRef.current = false
      activeContextPointerRef.current = null
    }
    window.addEventListener('pointercancel', cancelPendingMenu)
    window.addEventListener('blur', cancelPendingMenu)
    return () => {
      window.removeEventListener('pointercancel', cancelPendingMenu)
      window.removeEventListener('blur', cancelPendingMenu)
    }
  }, [])

  return {
    contextNodeMenu,
    setContextNodeMenu,
    prepareContextMenuPointerDown,
    handleContextMenuPointerMove,
    finishContextMenuPointerUp,
    handleStageContextMenu,
  }
}
