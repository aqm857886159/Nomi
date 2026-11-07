import { generationFailureActions } from '../../observability/generationFailureActions'
import React, { type JSX } from 'react'
import { isLocalProcessingProgressPhase } from '../model/localProcessingPhase'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationFeedback } from '../../observability/useGenerationFeedback'
import { GenerationStatusBar } from './GenerationStatusBar'

export function NodeGenerationStatus({ node, keyframeNode, summaryInCard }: { summaryInCard?: boolean; node?: GenerationCanvasNode | null; keyframeNode?: GenerationCanvasNode | null }): JSX.Element | null {
  const cardNode = keyframeNode?.status === 'error' ? keyframeNode : node
  const inCard = summaryInCard && (cardNode?.status === 'recoverable' || (cardNode?.status === 'error' && generationFailureActions(cardNode.error ?? '').primary === 'release-regenerate'))
  const feedback = useGenerationFeedback(node, keyframeNode)
  if (inCard) return null
  if (isLocalProcessingProgressPhase(node?.progress?.phase) || !feedback) return null
  return <span className="inline-flex min-w-0 max-w-full [&_[data-generation-message]]:min-w-0 [&_[data-generation-message]]:[overflow-wrap:anywhere] [&_[data-generation-status]]:text-[length:inherit] [&_[data-generation-status]]:font-normal"><GenerationStatusBar feedback={feedback} /></span>
}
