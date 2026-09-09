import React from 'react'
import { isVideoDepthProgressPhase } from '../videoDepth/videoDepthProgressPhase'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationFeedback } from '../../observability/useGenerationFeedback'
import { GenerationStatusBar } from './GenerationStatusBar'

export function NodeGenerationStatus({ node, keyframeNode }: { node?: GenerationCanvasNode | null; keyframeNode?: GenerationCanvasNode | null }): JSX.Element | null {
  const feedback = useGenerationFeedback(node, keyframeNode)
  if (isVideoDepthProgressPhase(node?.progress?.phase) || !feedback) return null
  return <span className="inline-flex min-w-0 max-w-full [&_[data-generation-message]]:min-w-0 [&_[data-generation-message]]:[overflow-wrap:anywhere] [&_[data-generation-status]]:text-[length:inherit] [&_[data-generation-status]]:font-normal"><GenerationStatusBar feedback={feedback} /></span>
}
