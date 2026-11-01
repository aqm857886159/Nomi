import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { confirmAndRunNode } from '../runner/generationRunController'
import { dismissRecoverableNode, recoverNodeResult } from '../runner/recoverTaskActions'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { localStepRedoOf } from './localStepRedo'
import { useProductionNodeRetry } from './useProductionNodeRetry'
import { NodeErrorReport } from './NodeErrorReport'
import { NodeRecoverableReport } from './NodeRecoverableReport'

/** The canvas and list inspector host the same recovery surface and retry route. */
export function NodeFailureReport({ node, onFeedback, summaryVisible = true }: {
  node: GenerationCanvasNode
  onFeedback: (message: string) => void
  summaryVisible?: boolean
}) {
  const productionRetry = useProductionNodeRetry(node, onFeedback)
  if (node.status === 'error' && node.error) return <NodeErrorReport
    summaryVisible={summaryVisible} message={node.error} meta={node.meta} nodeId={node.id} run={node.runs?.[0]}
    onDismiss={() => useGenerationCanvasStore.getState().dismissNodeError(node.id)}
    onRetry={node.kind === 'asset' && node.meta?.source === 'clipboard-url' ? undefined
      : productionRetry ?? localStepRedoOf(node, onFeedback) ?? (() => { void confirmAndRunNode(node.id, { initiator: 'user' }) })}
  />
  if (node.status === 'recoverable') return <NodeRecoverableReport node={node}
    onRecover={() => { withProjectAction((project) => { void recoverNodeResult(node.id, project) }) }}
    onDismiss={() => dismissRecoverableNode(node.id)} />
  return null
}
