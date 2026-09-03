import React from 'react'
import {
  pasteClipboardMediaToGenerationCanvas,
  extractClipboardMediaFiles,
  extractClipboardMediaUrl,
  showClipboardMediaPasteNotes,
} from '../adapters/clipboardImagePaste'
import { hasClipboardContent } from '../store/canvasClipboard'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { showUndoToast } from '../../../utils/showUndoToast'
import i18n from '../../../i18n'

type CanvasZoomShortcutInput = {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

const CANVAS_TEXT_EDITING_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

type ClosestTarget = {
  closest?: (selector: string) => unknown
  parentElement?: ClosestTarget | null
}

function editableAncestor(target: EventTarget | null): EventTarget | null {
  const candidate = target as unknown as ClosestTarget | null
  const element = typeof candidate?.closest === 'function' ? candidate : candidate?.parentElement
  return (element?.closest?.(CANVAS_TEXT_EDITING_SELECTOR) as EventTarget | null) || null
}

export function isCanvasTextEditingContext(
  eventTarget: EventTarget | null,
  activeElement: EventTarget | null,
): boolean {
  const eventEditor = editableAncestor(eventTarget)
  const activeEditor = editableAncestor(activeElement)
  // The event target is the actual source of the keystroke. A stale textarea in activeElement
  // must not swallow a canvas command emitted by a model picker; a real key from that textarea
  // still resolves to the editor. When both are editable, require the same root so two editors
  // cannot leak each other's shortcut ownership.
  return Boolean(eventEditor && (!activeEditor || eventEditor === activeEditor))
}

export function canvasZoomShortcutDirection(input: CanvasZoomShortcutInput): -1 | 0 | 1 {
  if ((!input.ctrlKey && !input.metaKey) || input.altKey) return 0
  if (input.code === 'Equal' || input.code === 'NumpadAdd' || input.key === '+' || input.key === '=') return 1
  if (input.code === 'Minus' || input.code === 'NumpadSubtract' || input.key === '-' || input.key === '_') return -1
  return 0
}

type CanvasKeydownHandlerOptions = {
  stageRef: React.RefObject<HTMLDivElement>
  selectedNodeCount: number
  selectedGroupCount: number
  activeCategoryId: string
  setActiveEdge: (edge: null) => void
  deleteActiveEdge?: () => void
  cancelConnection: () => void
  deleteSelectedNodes: () => void
  groupSelectedNodes: () => void
  ungroupSelectedNodes: () => void
  copySelectedNodes: () => void
  cutSelectedNodes: () => void
  pasteNodes: (basePosition?: { x: number; y: number }) => void
  zoomByStep: (direction: -1 | 1) => void
  undo: () => void
  redo: () => void
}

function shouldIgnoreCanvasShortcut(target: EventTarget | null, stageRef: React.RefObject<HTMLDivElement>): boolean {
  if (document.querySelector('[data-nomi-whiteboard-modal="true"]')) return true
  if (isCanvasTextEditingContext(target, document.activeElement)) return true
  if (!stageRef.current || stageRef.current.offsetParent === null) return true
  return false
}

export function createCanvasKeydownHandler(opts: CanvasKeydownHandlerOptions): (event: KeyboardEvent) => void {
  const {
    stageRef,
    selectedNodeCount,
    selectedGroupCount,
    activeCategoryId,
    setActiveEdge,
    deleteActiveEdge,
    cancelConnection,
    deleteSelectedNodes,
    groupSelectedNodes,
    ungroupSelectedNodes,
    copySelectedNodes,
    cutSelectedNodes,
    pasteNodes,
    zoomByStep,
    undo,
    redo,
  } = opts
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    if (shouldIgnoreCanvasShortcut(event.target, stageRef)) return
    const key = event.key.toLowerCase()
    const mod = event.metaKey || event.ctrlKey
    const hasTextSelection = !(window.getSelection()?.isCollapsed ?? true)
    if (mod && hasTextSelection && (key === 'c' || key === 'x')) return
    if (event.key === 'Escape') {
      setActiveEdge(null)
      cancelConnection()
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (!selectedNodeCount) {
        if (deleteActiveEdge) {
          event.preventDefault()
          deleteActiveEdge()
        }
        return
      }
      event.preventDefault()
      const removedCount = selectedNodeCount
      deleteSelectedNodes()
      // 误删安全网（fb-20260724：画板衍生截图与原图在画布上无区分，框选一键 del 把原图也删了）。
      // 删除照常发生，但删**多个**时给可点撤销的 toast（复用画布 undo）——单个删除很明确、不打扰；
      // 多选才是批量误删的入口。这是通用护栏，覆盖所有多选误删，不止画板场景（P2 整类不复发）。
      if (removedCount > 1) {
        showUndoToast({
          message: i18n.t('generationCommon.canvas.deletedNodesUndo', { count: removedCount }),
          onUndo: undo,
        })
      }
      return
    }
    if (!mod) return
    const zoomDirection = canvasZoomShortcutDirection(event)
    if (zoomDirection !== 0) {
      event.preventDefault()
      zoomByStep(zoomDirection)
      return
    }
    if (key === 'g' && event.shiftKey) {
      if (!selectedGroupCount) return
      event.preventDefault()
      ungroupSelectedNodes()
      return
    }
    if (key === 'g') {
      if (selectedNodeCount < 2) return
      event.preventDefault()
      groupSelectedNodes()
      return
    }
    // v0.7.5: Cmd+A 全选当前分类
    if (key === 'a') {
      event.preventDefault()
      useGenerationCanvasStore.getState().selectAllNodes(activeCategoryId)
      return
    }
    if (key === 'c') {
      event.preventDefault()
      copySelectedNodes()
      return
    }
    if (key === 'x') {
      event.preventDefault()
      cutSelectedNodes()
      return
    }
    if (key === 'v') {
      pasteNodes()
      return
    }
    if (key === 'z' && event.shiftKey) {
      event.preventDefault()
      redo()
      return
    }
    if (key === 'z') {
      event.preventDefault()
      undo()
      return
    }
    if (key === 'y') {
      event.preventDefault()
      redo()
    }
  }
  return handleKeyDown
}

/**
 * Decide which clipboard owns a canvas paste before any remote-media work starts.
 * Nomi's node clipboard is intentionally in-memory, so the OS clipboard can still
 * contain a URL copied from a browser. Only unambiguous external media may preempt
 * an existing in-app node clipboard; an ordinary URL or unknown text must not start
 * a download as a side effect of pasting a node.
 */
export function shouldPreferCanvasClipboard(
  data: DataTransfer | null | undefined,
  internalClipboardAvailable = hasClipboardContent(),
): boolean {
  if (!internalClipboardAvailable) return false
  if (extractClipboardMediaFiles(data).length > 0) return false
  const candidate = extractClipboardMediaUrl(data)
  if (!candidate) return true
  return candidate.source !== 'html' && candidate.source !== 'uri-list' && !candidate.trustAsMedia
}

/**
 * 画布全局快捷键（从 GenerationCanvas 抽出，R9 防巨壳）。
 *
 * 三道前置守卫（缺一即出「快捷键被画布吞」类 bug，2026-06-12 用户复现）：
 * 1. 实际 keydown 事件来自输入框/contenteditable → 放行（文本编辑自己的快捷键语义）；
 *    仅 activeElement 残留输入框不算编辑态，避免模型选择后 Cmd/Ctrl+Z 被吞；
 * 2. 画布隐藏时不抢——三个工作区共存挂载（WorkspaceSlot hidden 切换），
 *    否则创作/预览区按 Cmd+C/Z 会被隐藏画布劫持；
 * 3. 用户划选了非可编辑文本（助手消息/计划卡/节点提示词）→ Cmd+C/X 还给系统原生复制。
 */
export function useCanvasShortcuts(opts: {
  readOnly: boolean
  stageRef: React.RefObject<HTMLDivElement>
  selectedNodeCount: number
  selectedGroupCount: number
  activeCategoryId: string
  /** 只用于清空（Escape）；签名收窄到 null 以兼容任意 ActiveEdge setState。 */
  setActiveEdge: (edge: null) => void
  deleteActiveEdge?: () => void
  cancelConnection: () => void
  deleteSelectedNodes: () => void
  groupSelectedNodes: () => void
  ungroupSelectedNodes: () => void
  copySelectedNodes: () => void
  cutSelectedNodes: () => void
  pasteNodes: (basePosition?: { x: number; y: number }) => void
  getPastePosition: () => { x: number; y: number }
  zoomByStep: (direction: -1 | 1) => void
  undo: () => void
  redo: () => void
}): void {
  const {
    readOnly,
    stageRef,
    selectedNodeCount,
    selectedGroupCount,
    activeCategoryId,
    setActiveEdge,
    deleteActiveEdge,
    cancelConnection,
    deleteSelectedNodes,
    groupSelectedNodes,
    ungroupSelectedNodes,
    copySelectedNodes,
    cutSelectedNodes,
    pasteNodes,
    getPastePosition,
    zoomByStep,
    undo,
    redo,
  } = opts
  const pasteFallbackTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (readOnly) return undefined
    const clearPasteFallback = () => {
      if (pasteFallbackTimerRef.current === null) return
      window.clearTimeout(pasteFallbackTimerRef.current)
      pasteFallbackTimerRef.current = null
    }
    const handleKeyDown = createCanvasKeydownHandler({
      stageRef,
      selectedNodeCount,
      selectedGroupCount,
      activeCategoryId,
      setActiveEdge,
      deleteActiveEdge,
      cancelConnection,
      deleteSelectedNodes,
      groupSelectedNodes,
      ungroupSelectedNodes,
      copySelectedNodes,
      cutSelectedNodes,
      pasteNodes: (basePosition) => {
        if (basePosition) {
          pasteNodes(basePosition)
          return
        }
        clearPasteFallback()
        pasteFallbackTimerRef.current = window.setTimeout(() => {
          pasteFallbackTimerRef.current = null
          pasteNodes(getPastePosition())
        }, 120)
      },
      zoomByStep,
      undo,
      redo,
    })
    const handlePaste = (event: ClipboardEvent) => {
      // A real paste owns this keystroke even when it belongs to an editor. Cancel the keydown
      // fallback before the editing guard so stale canvas clipboard nodes cannot appear later.
      clearPasteFallback()
      if (shouldIgnoreCanvasShortcut(event.target, stageRef)) return
      const pastePosition = getPastePosition()
      if (shouldPreferCanvasClipboard(event.clipboardData)) {
        event.preventDefault()
        pasteNodes(pastePosition)
        return
      }
      event.preventDefault()
      void pasteClipboardMediaToGenerationCanvas({
        clipboardData: event.clipboardData,
        basePosition: pastePosition,
        categoryId: activeCategoryId,
      }).then((result) => {
        if (!result.handled) {
          pasteNodes(pastePosition)
          return
        }
        showClipboardMediaPasteNotes(result)
      }).catch(() => {
        pasteNodes(pastePosition)
      })
    }
    const offDesktopZoom = window.nomiDesktop?.window?.onCanvasZoomShortcut?.((direction) => {
      if (!stageRef.current || stageRef.current.offsetParent === null) return
      zoomByStep(direction)
    })
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('paste', handlePaste)
    return () => {
      clearPasteFallback()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('paste', handlePaste)
      offDesktopZoom?.()
    }
  }, [
    activeCategoryId,
    cancelConnection,
    copySelectedNodes,
    cutSelectedNodes,
    deleteSelectedNodes,
    deleteActiveEdge,
    getPastePosition,
    groupSelectedNodes,
    pasteNodes,
    readOnly,
    redo,
    selectedGroupCount,
    selectedNodeCount,
    setActiveEdge,
    stageRef,
    undo,
    ungroupSelectedNodes,
    zoomByStep,
  ])
}
