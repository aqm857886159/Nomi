import React from 'react'
import { useReactFlow, useStoreApi, getViewportForBounds, type Viewport } from '@xyflow/react'
import { unionCanvasFitBounds } from '../model/canvasFitBounds'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { CanvasGroupBox } from '../components/GroupFrame'
import { useAutoFitOnLoad } from '../components/useAutoFitOnLoad'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { nodeSelectedModelAddress } from '../nodes/controls/parameterControlModel'
import { editingView, fitEditingBounds, revealEditor, selectedEditor, selectionRevealMode } from './selectionComposerViewport'

/** One reveal per selection change. Viewport motion, node edits and drag frames do not trigger reveals. */
export function useSelectionComposerPan(
  hostRef: React.RefObject<HTMLDivElement | null>,
  renderedNodesRef: React.MutableRefObject<readonly Pick<GenerationCanvasNode, 'id'>[]>,
  dragging: React.RefObject<boolean>,
  getViewport: () => Viewport,
  animate: (zoom: number, offset: { x: number; y: number }, duration: number, settled: () => void) => void,
  cancel: () => void,
  readOnly: boolean,
) {
  const frame = React.useRef(0)
  const cancelPending = React.useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
  }, [])
  const takeViewport = React.useCallback(() => {
    cancelPending()
    cancel()
  }, [cancelPending, cancel])
  React.useEffect(() => {
    if (readOnly) return
    let animating = false
    const stop = () => {
      cancelPending()
      if (animating) cancel()
      animating = false
    }
    const host = hostRef.current
    host?.addEventListener('pointerdown', stop, true)
    host?.addEventListener('wheel', stop, { capture: true, passive: true })
    const unsubscribe = useGenerationCanvasStore.subscribe((state, previous) => {
      const [id] = state.selectedNodeIds
      if (state.selectedNodeIds === previous.selectedNodeIds ||
        (state.selectedNodeIds.length === 1 && previous.selectedNodeIds.length === 1 && previous.selectedNodeIds[0] === id)) return
      stop()
      if (!id || state.selectedNodeIds.length !== 1 || dragging.current) return
      const previousNodes = renderedNodesRef.current
      const deadline = performance.now() + 500
      const reveal = (derived: boolean) => {
        const host = hostRef.current
        const latest = useGenerationCanvasStore.getState()
        if (!host || dragging.current || host.dataset.dragging === 'true' ||
          latest.selectedNodeIds.length !== 1 || latest.selectedNodeIds[0] !== id) return
        const node = latest.nodes.find(candidate => candidate.id === id)
        if (!node || (node.categoryId || 'shots') !== useWorkbenchStore.getState().activeCategoryId) return
        // A new video acquires its first-frame aspect with its model. An unavailable model or a virtualized
        // card must still be reachable, so waiting for the initial layout has a bounded lifetime.
        if (derived && node.kind === 'video' && !nodeSelectedModelAddress(node.meta).modelKey && performance.now() < deadline) {
          frame.current = requestAnimationFrame(() => reveal(derived))
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
      frame.current = requestAnimationFrame(() => {
        // A derivation adds and connects the card in separate synchronous store writes.
        // Use the graph at the first frame, before waiting for the editor or model.
        const mode = selectionRevealMode(id, previousNodes, useGenerationCanvasStore.getState().edges)
        if (mode) frame.current = requestAnimationFrame(() => reveal(mode === 'fit'))
      })
    })
    return () => {
      host?.removeEventListener('pointerdown', stop, true)
      host?.removeEventListener('wheel', stop, true)
      unsubscribe()
      stop()
    }
  }, [hostRef, renderedNodesRef, dragging, getViewport, animate, cancel, cancelPending, readOnly])
  return takeViewport
}

type OpenFit = Pick<Parameters<typeof useAutoFitOnLoad>[0], 'nodes' | 'activeCategoryId' | 'hasRememberedViewport' | 'ready' | 'zoomRef' | 'offsetRef'>

export function useCanvasEditingFit({
  hostRef, nodes, nodeById, groupBoxes, activeCategoryId, hasRememberedViewport, ready, readOnly, zoomRange: [minZoom, maxZoom],
  draggingRef, zoomRef, offsetRef, animateViewportTo, cancelViewportAnimation,
}: OpenFit & {
  hostRef: React.RefObject<HTMLDivElement | null>
  nodeById: ReadonlyMap<string, GenerationCanvasNode>
  groupBoxes: readonly CanvasGroupBox[]
  readOnly: boolean
  zoomRange: readonly [min: number, max: number]
  draggingRef: React.RefObject<boolean>
  animateViewportTo: (zoom: number, offset: Viewport, duration: number) => void
  cancelViewportAnimation: () => void
}) {
  const flow = useReactFlow()
  const flowStore = useStoreApi()
  // 「适应视图」框住的是**节点 ∪ 框**，不只是节点：框的标签带比成员外接盒高 52px，
  // 只按节点 fit 会把用户刚起的框名切在舞台外（裁决与理由见 model/canvasFitBounds.ts）。
  // 首进与选中编辑时给生成框留位；其余手动全览沿用内核的完整缩放范围。
  const fitView = React.useCallback((animate = false, opening = false) => {
    if (!nodes.length) return
    const host = hostRef.current
    if (!host) return
    const stage = host.getBoundingClientRect()
    if (!stage.width || !stage.height) return
    const bounds = unionCanvasFitBounds([
      flow.getNodesBounds(flow.getNodes()),
      ...groupBoxes.map((box) => ({ x: box.left, y: box.top, width: box.width, height: box.height })),
    ])
    if (!bounds) return
    const ids = opening ? useGenerationCanvasStore.getState().selectedNodeIds : []
    const editor = ids.length === 1 ? selectedEditor(host, nodeById.get(ids[0]!), flow.getViewport().zoom) : null
    const next = opening
      ? fitEditingBounds(bounds, editingView(host), editor)
      : getViewportForBounds(bounds, stage.width, stage.height, minZoom, maxZoom, 0.12)
    if (![next.x, next.y, next.zoom].every((value) => Number.isFinite(value))) return
    cancelViewportAnimation()
    if (animate) {
      animateViewportTo(next.zoom, next, 200)
      return
    }
    void flow.setViewport(next, { duration: 0 })
  }, [animateViewportTo, cancelViewportAnimation, flow, groupBoxes, hostRef, maxZoom, minZoom, nodeById, nodes.length])
  useAutoFitOnLoad({
    ready,
    nodes,
    activeCategoryId,
    hasRememberedViewport,
    fitView,
    revealRememberedSelection: () => {
      const host = hostRef.current
      const ids = useGenerationCanvasStore.getState().selectedNodeIds
      if (!host || ids.length !== 1 || readOnly || draggingRef.current) return
      const current = flow.getViewport()
      const editor = selectedEditor(host, nodeById.get(ids[0]!), current.zoom)
      if (!editor) return
      const view = editingView(host)
      const next = revealEditor(current, view, editor, true, ids.length, draggingRef.current)
      if (next) animateViewportTo(next.zoom, next, 200)
    },
    stageRef: hostRef,
    zoomRef,
    offsetRef,
    hasFlowNode: (id) => flowStore.getState().nodeLookup.has(id),
  })
  return fitView
}
