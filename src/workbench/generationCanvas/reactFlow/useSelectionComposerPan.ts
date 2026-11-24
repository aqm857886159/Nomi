import React from 'react'
import type { Viewport } from '@xyflow/react'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { nodeSelectedModelAddress } from '../nodes/controls/parameterControlModel'
import { editingView, revealEditor, selectedEditor } from './selectionComposerViewport'

/** One reveal per selection change. Viewport motion, node edits and drag frames do not trigger reveals. */
export function useSelectionComposerPan(
  hostRef: React.RefObject<HTMLDivElement | null>,
  dragging: React.RefObject<boolean>,
  getViewport: () => Viewport,
  animate: (zoom: number, offset: { x: number; y: number }, duration: number, settled: () => void) => void,
  cancel: () => void,
  readOnly: boolean,
) {
  React.useEffect(() => {
    if (readOnly) return
    let frame = 0
    let animating = false
    const stop = () => {
      cancelAnimationFrame(frame)
      if (animating) cancel()
      animating = false
    }
    const unsubscribe = useGenerationCanvasStore.subscribe((state, previous) => {
      const [id] = state.selectedNodeIds
      if (state.selectedNodeIds === previous.selectedNodeIds ||
        (state.selectedNodeIds.length === 1 && previous.selectedNodeIds.length === 1 && previous.selectedNodeIds[0] === id)) return
      stop()
      if (state.selectedNodeIds.length !== 1 || dragging.current) return
      const added = state.nodes !== previous.nodes && !previous.nodes.some(node => node.id === id)
      const deadline = performance.now() + 500
      const reveal = () => {
        const host = hostRef.current
        const latest = useGenerationCanvasStore.getState()
        if (!host || !id || dragging.current || host.dataset.dragging === 'true' ||
          latest.selectedNodeIds.length !== 1 || latest.selectedNodeIds[0] !== id) return
        const node = latest.nodes.find(candidate => candidate.id === id)
        if (!node || (node.categoryId || 'shots') !== useWorkbenchStore.getState().activeCategoryId) return
        const derived = added && latest.edges.some(edge => edge.target === id)
        // A new video acquires its first-frame aspect with its model. An unavailable model or a virtualized
        // card must still be reachable, so waiting for the initial layout has a bounded lifetime.
        if (derived && node.kind === 'video' && !nodeSelectedModelAddress(node.meta).modelKey && performance.now() < deadline) {
          frame = requestAnimationFrame(reveal)
          return
        }
        const viewport = getViewport()
        const editor = selectedEditor(host, node, viewport.zoom)
        if (!editor) return
        const next = revealEditor(viewport, editingView(host), editor, derived, latest.selectedNodeIds.length, dragging.current)
        if (next) {
          animating = true
          animate(next.zoom, next, 200, () => { animating = false })
        }
      }
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(reveal) })
    })
    return () => { unsubscribe(); stop() }
  }, [hostRef, dragging, getViewport, animate, cancel, readOnly])
}
