import React from 'react'
import {
  pasteClipboardMediaToGenerationCanvas,
  showClipboardMediaPasteNotes,
} from '../adapters/clipboardImagePaste'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

/**
 * 画布全局快捷键（从 GenerationCanvas 抽出，R9 防巨壳）。
 *
 * 三道前置守卫（缺一即出「快捷键被画布吞」类 bug，2026-06-12 用户复现）：
 * 1. 焦点在输入框/contenteditable → 全部放行（文本编辑自己的快捷键语义）；
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
  cancelConnection: () => void
  deleteSelectedNodes: () => void
  groupSelectedNodes: () => void
  ungroupSelectedNodes: () => void
  copySelectedNodes: () => void
  cutSelectedNodes: () => void
  pasteNodes: (basePosition?: { x: number; y: number }) => void
  getPastePosition: () => { x: number; y: number }
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
    cancelConnection,
    deleteSelectedNodes,
    groupSelectedNodes,
    ungroupSelectedNodes,
    copySelectedNodes,
    cutSelectedNodes,
    pasteNodes,
    getPastePosition,
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
    const shouldIgnoreCanvasShortcut = (target: EventTarget | null): boolean => {
      if (document.querySelector('[data-nomi-whiteboard-modal="true"]')) return true
      const element = target instanceof HTMLElement ? target : null
      if (element?.closest('input, textarea, select, [contenteditable="true"]')) return true
      if (!stageRef.current || stageRef.current.offsetParent === null) return true
      return false
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreCanvasShortcut(event.target)) return
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
        if (!selectedNodeCount) return
        event.preventDefault()
        deleteSelectedNodes()
        return
      }
      if (!mod) return
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
        clearPasteFallback()
        pasteFallbackTimerRef.current = window.setTimeout(() => {
          pasteFallbackTimerRef.current = null
          pasteNodes(getPastePosition())
        }, 120)
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
    const handlePaste = (event: ClipboardEvent) => {
      if (shouldIgnoreCanvasShortcut(event.target)) return
      event.preventDefault()
      clearPasteFallback()
      const pastePosition = getPastePosition()
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
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('paste', handlePaste)
    return () => {
      clearPasteFallback()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('paste', handlePaste)
    }
  }, [
    activeCategoryId,
    cancelConnection,
    copySelectedNodes,
    cutSelectedNodes,
    deleteSelectedNodes,
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
  ])
}
