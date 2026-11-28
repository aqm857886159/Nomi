import React, { type JSX } from 'react'
import { useWorkbenchStore } from '../../workbenchStore'
import { GenerationTimingHint } from './GenerationTimingHint'
import { GeneratingOverlay, GeneratingCancelButton } from './render/CardCommon'
import { GenerationWaitingSurface } from './GenerationWaitingSurface'
import { useGenerationFeedback } from '../../observability/useGenerationFeedback'
import { useNodeLivePreviewStore } from '../store/nodeLivePreviewStore'
import { requestTaskCancel } from '../runner/localTaskControl'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { canInterruptGenerationTask } from '../model/taskCancellation'
import { isLocalProcessingProgressPhase } from '../model/localProcessingPhase'
import { NodeImportingOverlay } from './NodeImportingOverlay'
import { useDeferredNodeMediaVisibility } from './deferredNodeMediaQueue'
import { sampleRowOwnsProgress } from '../model/sampleFacts'

export function NodeGeneratingOverlay({ node, reportFeedback }: { reportFeedback: (message: string) => void; node: GenerationCanvasNode }): JSX.Element | null {
  const feedback = useGenerationFeedback(node)
  const previewUrl = useNodeLivePreviewStore((state) => state.byNode[node.id])
  const zoom = useWorkbenchStore((state) => state.categoryViewports[state.activeCategoryId]?.zoom ?? 1)
  // 「视口外不跑 WebGL」那道准入门此前恒 true（这个参数从没传过）；复用媒体队列的可见性观察器接上真值。
  const viewport = useDeferredNodeMediaVisibility()
  // 出高清在路上归节点下方那一行（「高清生成中」）：样片照常能看能播，不盖等待面，落地也不放收尾动画。
  const sampleRowOwns = sampleRowOwnsProgress(node)
  const [waiting, setWaiting] = React.useState(Boolean(feedback?.active) && !sampleRowOwns)
  const finish = React.useCallback(() => setWaiting(false), [])
  React.useEffect(() => { if (feedback?.active && !sampleRowOwns) setWaiting(true) }, [feedback?.active, sampleRowOwns])
  const completed = !feedback?.active && node.status === 'success'
  const finalUrl = node.result?.type === 'image' ? node.result.url : node.result?.thumbnailUrl || previewUrl
  const handleCancel = React.useCallback(() => requestTaskCancel(node, reportFeedback), [node, reportFeedback])
  // Local depth processing has its separately approved top bar; it is not a model generation stage.
  if (isLocalProcessingProgressPhase(node.progress?.phase)) return <GeneratingOverlay
    percent={node.progress?.percent} message={node.progress?.message} previewUrl={previewUrl} onCancel={handleCancel} />
  // 导入不是生成：正在拷文件的节点交给 NodeImportingOverlay（同一个等待层组件的进度驱动形态），
  // 不套生成等待层——它会连带把生成的状态语义一起带上来。
  if (node.meta?.uploadStatus === 'uploading') return <NodeImportingOverlay node={node} />
  if (sampleRowOwns || (!feedback?.active && !(waiting && completed))) return null
  const archetypeMeta = (node.meta as Record<string, unknown> | undefined)?.archetype as { modeId?: unknown } | undefined
  const boardAnchor = archetypeMeta?.modeId === 'layers' ? 'layers.running' : undefined
  return <div ref={viewport.ref} className="absolute inset-0 z-[3] pointer-events-none" data-generating-placement="surface">
    <GenerationWaitingSurface audio={node.kind === 'audio'} previewUrl={previewUrl} previewLabel={feedback?.previewLabel ?? ''} percent={feedback?.percent} finalUrl={finalUrl} completed={completed} onComplete={finish} zoom={zoom} inViewport={viewport.visible} boardAnchor={boardAnchor} />
    {feedback?.active && node.kind === 'video' && !previewUrl ? <GenerationTimingHint node={node} /> : null}
    {feedback?.active && canInterruptGenerationTask(node) ? <div className="absolute right-3 bottom-3"><GeneratingCancelButton onCancel={handleCancel} /></div> : null}
  </div>
}
