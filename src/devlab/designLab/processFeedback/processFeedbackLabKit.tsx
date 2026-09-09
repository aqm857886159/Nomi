import React from 'react'
import type { ImageGenerationPreset } from 'img-fx'
import BaseGenerationNode from '../../../workbench/generationCanvas/nodes/BaseGenerationNode'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useGenerationQueueStore } from '../../../workbench/generationCanvas/runner/generationQueueStore'
import { useNodeLivePreviewStore } from '../../../workbench/generationCanvas/store/nodeLivePreviewStore'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { TaskRow } from '../../../workbench/taskCenter/TaskCenterPanel'
import { buildTaskCenterView } from '../../../workbench/taskCenter/taskCenterEntries'
import TimelineClip from '../../../workbench/timeline/TimelineClip'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { useGenerationFeedbackClock } from '../../../workbench/observability/useGenerationFeedback'
import type { GenerationProgressPhase } from '../../../workbench/observability/narrate'
import type { TimelineClip as Clip } from '../../../workbench/timeline/timelineTypes'

export const PF_NODE_ID = 'process-feedback-node'
const FRAME = '/fixtures/process-feedback-frame.svg'
export type ProcessFixture = { kind: 'image' | 'video' | 'audio'; stage: GenerationProgressPhase | 'failed' | 'saved'; preview?: boolean; reduced?: boolean; preset?: ImageGenerationPreset; percent?: number; zoom?: number }

/** Laboratory automation drives the same mounted host without creating a second store instance. */
export function advanceProcessFeedback(stage: ProcessFixture['stage']): void {
  window.dispatchEvent(new CustomEvent('nomi-pf-stage', { detail: stage }))
}

export function setProcessFeedbackZoom(zoom: number): void {
  window.dispatchEvent(new CustomEvent('nomi-pf-zoom', { detail: zoom }))
}

function fixtureNode(fixture: ProcessFixture): GenerationCanvasNode {
  const startedAt = Date.now() - (fixture.stage === 'still-generating' ? 360000 : 18000)
  return {
    id: PF_NODE_ID, kind: fixture.kind, title: '镜 1', categoryId: fixture.kind === 'audio' ? 'audio' : 'shots',
    position: { x: 0, y: 0 }, size: { width: 340, height: 240 },
    status: fixture.stage === 'failed' ? 'error' : fixture.stage === 'saved' ? 'success' : fixture.stage === 'queued' ? 'queued' : 'running',
    error: fixture.stage === 'failed' ? 'model not enabled' : undefined,
    meta: { modelKey: 'fixture-model', modelVendor: 'fixture-provider' },
    progress: fixture.stage === 'saved' || fixture.stage === 'failed' ? undefined : {
      phase: fixture.stage, updatedAt: startedAt, percent: fixture.percent,
      narrationContext: fixture.preview ? { startedNodes: 12, totalNodes: 20 } : undefined,
    },
    runs: [{ id: 'pf-run', status: fixture.stage === 'failed' ? 'error' : 'running', startedAt, updatedAt: startedAt }],
    ...(fixture.stage === 'saved' ? { result: { id: 'pf-result', type: 'image' as const, url: FRAME, createdAt: Date.now() } } : {}),
  }
}
const clip: Clip = { id: 'pf-clip', type: 'image', sourceNodeId: PF_NODE_ID, label: '镜 1', startFrame: 0, endFrame: 150, frameCount: 150, offsetStartFrame: 0, offsetEndFrame: 0 }

function Surfaces({ zoom, reduced, preset }: { zoom: number; reduced?: boolean; preset?: ImageGenerationPreset }): JSX.Element | null {
  const node = useGenerationCanvasStore((state) => state.nodes.find((item) => item.id === PF_NODE_ID))
  const entries = useGenerationQueueStore((state) => state.entries)
  const now = useGenerationFeedbackClock()
  if (!node) return null
  const row = buildTaskCenterView({ nodes: [node], entries, batches: {}, now, fallbackTitle: '镜 1' }).rows[0]
  return <div data-process-lab-ready className="grid gap-6 p-6 pt-24" style={{ width: 800, height: 632, gridTemplateRows: '240px 104px 64px' }}>
    <div className="relative" style={{ width: 340, height: 240, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
      <BaseGenerationNode node={node} selected={false} readOnly waitingMotion={reduced ? 'reduced' : undefined} waitingPreset={preset} />
    </div>
    <div data-process-task className="w-full rounded-nomi border border-nomi-line bg-nomi-paper">{row ? <TaskRow row={row} /> : null}</div>
    <div data-process-timeline className="relative h-16"><TimelineClip clip={clip} /></div>
  </div>
}

/** Host stores drive the real node, task row and timeline clip; no imitation status markup. */
export function ProcessFeedbackStage(fixture: ProcessFixture): JSX.Element {
  const [ready, setReady] = React.useState(false)
  const batchId = React.useRef('')
  React.useEffect(() => {
    const update = (event: Event) => {
      const stage = (event as CustomEvent<ProcessFixture['stage']>).detail
      const store = useGenerationCanvasStore.getState()
      if (stage === 'saved') {
        store.addNodeResult(PF_NODE_ID, { id: 'pf-completed', type: 'image', url: '/fixtures/process-feedback-result.svg', createdAt: Date.now() })
        useGenerationQueueStore.getState().markSettled(batchId.current, PF_NODE_ID, 'success')
      }
      else if (stage === 'failed') {
        store.setNodeStatus(PF_NODE_ID, 'error', 'model not enabled')
        useGenerationQueueStore.getState().markSettled(batchId.current, PF_NODE_ID, 'error', { error: 'model not enabled' })
      }
      else {
        if (stage !== 'queued') useGenerationQueueStore.getState().markRunning(batchId.current, PF_NODE_ID)
        store.setNodeProgress(PF_NODE_ID, { phase: stage })
      }
    }
    const zoom = (event: Event) => {
      const s = useWorkbenchStore.getState()
      s.rememberCategoryViewport(s.activeCategoryId, { zoom: (event as CustomEvent<number>).detail, offset: { x: 0, y: 0 } })
    }
    window.addEventListener('nomi-pf-stage', update)
    window.addEventListener('nomi-pf-zoom', zoom)
    return () => { window.removeEventListener('nomi-pf-stage', update); window.removeEventListener('nomi-pf-zoom', zoom) }
  }, [])
  React.useLayoutEffect(() => {
    useWorkbenchStore.setState({ activeCategoryId: fixture.kind === 'audio' ? 'audio' : 'shots' })
    const workbench = useWorkbenchStore.getState()
    workbench.rememberCategoryViewport(workbench.activeCategoryId, { zoom: fixture.zoom ?? 1, offset: { x: 0, y: 0 } })
    const node = fixtureNode(fixture)
    useGenerationCanvasStore.setState({ nodes: [node], edges: [], selectedNodeIds: [] })
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    const queue = useGenerationQueueStore.getState()
    batchId.current = queue.enqueueBatch([[PF_NODE_ID]])
    if (fixture.stage !== 'queued') queue.markRunning(batchId.current, PF_NODE_ID)
    if (fixture.stage === 'failed' || fixture.stage === 'saved') queue.markSettled(batchId.current, PF_NODE_ID, fixture.stage === 'saved' ? 'success' : 'error', { error: node.error })
    useWorkbenchStore.getState().setTimeline({ version: 1, fps: 30, scale: 4, playheadFrame: 0, tracks: [{ id: 'pf-track', type: 'image', label: '', clips: [clip] }], textClips: [] })
    if (fixture.preview) useNodeLivePreviewStore.getState().setPreview(PF_NODE_ID, FRAME)
    else useNodeLivePreviewStore.getState().clearPreview(PF_NODE_ID)
    setReady(true)
  }, [fixture.kind, fixture.stage, fixture.percent, fixture.preview, fixture.zoom])
  return ready ? <Surfaces zoom={fixture.zoom ?? 1} reduced={fixture.reduced} preset={fixture.preset} /> : <div />
}

/** Transition screenshots use the mounted production host and real preview/result stores. */
export function ProcessFeedbackFxStage({ transition, reduced = false, preset }: { preset?: ImageGenerationPreset; transition?: 'preview' | 'saved'; reduced?: boolean }): JSX.Element {
  React.useEffect(() => {
    if (!transition) return
    let advanced = false
    const advance = () => {
      if (advanced || !document.querySelector('[data-process-fx]')) return
      advanced = true
      if (transition === 'preview') useNodeLivePreviewStore.getState().setPreview(PF_NODE_ID, FRAME)
      else advanceProcessFeedback('saved')
    }
    const observer = new MutationObserver(advance)
    observer.observe(document.body, { childList: true, subtree: true })
    advance()
    return () => observer.disconnect()
  }, [transition])
  return <div data-pf-fx-state data-pf-reduced={reduced || undefined}><ProcessFeedbackStage kind="image" stage="generating" reduced={reduced} preset={preset} /></div>
}
