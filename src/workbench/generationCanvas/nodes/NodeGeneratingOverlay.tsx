import React from 'react'
import type { ImageGenerationPreset } from 'img-fx'
import { useWorkbenchStore } from '../../workbenchStore'
import { GenerationTimingHint } from './GenerationTimingHint'
import { GeneratingOverlay, GeneratingCancelButton } from './render/CardCommon'
import { GenerationWaitingSurface } from './GenerationWaitingSurface'
import { useGenerationFeedback } from '../../observability/useGenerationFeedback'
import { useNodeLivePreviewStore } from '../store/nodeLivePreviewStore'
import { requestTaskCancel } from '../runner/localTaskControl'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { canInterruptGenerationTask } from '../model/taskCancellation'
import { isVideoDepthProgressPhase } from '../videoDepth/videoDepthProgressPhase'

export function NodeGeneratingOverlay({ node, motion, preset, reportFeedback }: { reportFeedback: (message: string) => void; node: GenerationCanvasNode; motion?: 'reduced'; preset?: ImageGenerationPreset }): JSX.Element | null {
  const feedback = useGenerationFeedback(node)
  const previewUrl = useNodeLivePreviewStore((state) => state.byNode[node.id])
  const zoom = useWorkbenchStore((state) => state.categoryViewports[state.activeCategoryId]?.zoom ?? 1)
  const [waiting, setWaiting] = React.useState(Boolean(feedback?.active))
  const finish = React.useCallback(() => setWaiting(false), [])
  React.useEffect(() => { if (feedback?.active) setWaiting(true) }, [feedback?.active])
  const completed = !feedback?.active && node.status === 'success'
  // 完成那一帧渐显的也是画布预览（与节点最终挂的同一张），不为 4K 原图多解一次码。
  const finalUrl = node.result?.type === 'image' ? node.result.thumbnailUrl || node.result.url : node.result?.thumbnailUrl || previewUrl
  const handleCancel = React.useCallback(() => requestTaskCancel(node, reportFeedback), [node, reportFeedback])
  // Local depth processing has its separately approved top bar; it is not a model generation stage.
  if (isVideoDepthProgressPhase(node.progress?.phase)) return <GeneratingOverlay
    percent={node.progress?.percent} message={node.progress?.message} previewUrl={previewUrl} onCancel={handleCancel} placement="top" />
  if (!feedback?.active && !(waiting && completed)) return null
  return <div className="absolute inset-0 z-[3] pointer-events-none" data-generating-placement="surface">
    <GenerationWaitingSurface audio={node.kind === 'audio'} previewUrl={previewUrl} previewLabel={feedback?.previewLabel ?? ''} percent={feedback?.percent} finalUrl={finalUrl} completed={completed} onComplete={finish} zoom={zoom} motion={motion} preset={preset} />
    {feedback?.active && node.kind === 'video' && !previewUrl ? <GenerationTimingHint node={node} /> : null}
    {feedback?.active && canInterruptGenerationTask(node) ? <div className="absolute right-3 bottom-3"><GeneratingCancelButton onCancel={handleCancel} /></div> : null}
  </div>
}
