import React, { type JSX } from 'react'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { useGenerationFeedback } from '../observability/useGenerationFeedback'

function NodeFeedback({ node }: { node: GenerationCanvasNode }): JSX.Element | null {
  const feedback = useGenerationFeedback(node)
  if (!feedback) return null
  return <span data-timeline-generation-feedback data-generation-message className="min-w-0 truncate">{feedback.message}</span>
}

/** Existing adopted clips keep their geometry while their source generates again. */
export function TimelineGenerationFeedback({ nodeId }: { nodeId: string }): JSX.Element | null {
  const node = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === nodeId))
  return node ? <NodeFeedback node={node} /> : null
}
