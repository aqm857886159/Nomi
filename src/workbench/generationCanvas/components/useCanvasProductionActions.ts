import React from 'react'
import type { ModelOption } from '../../../config/models'
import i18n from '../../../i18n'
import { showInfoToast } from '../../../utils/showInfoToast'
import { showUndoToast } from '../../../utils/showUndoToast'
import { findModelOptionByIdentifier, requiredModeForGenerationNode } from '../adapters/modelOptionsAdapter'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { buildNodeModelChangePatch } from '../nodes/buildNodeModelChangePatch'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { confirmAndRunPlan } from './batchPlanPreview'
import {
  eligibleGenerationNodeIds,
  groupGenerationNodesByExecutionKind,
  nodesInCanvasProductionScope,
  readCanvasBatchConcurrency,
  resolveCanvasGenerationScope,
  writeCanvasBatchConcurrency,
  type CanvasGenerationExecutionGroup,
} from './canvasProductionScope'

export function useCanvasProductionActions(params: { activeCategoryId: string; selectedNodeIds: readonly string[] }) {
  const { activeCategoryId, selectedNodeIds } = params
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const updateNodes = useGenerationCanvasStore((state) => state.updateNodes)
  const undo = useGenerationCanvasStore((state) => state.undo)
  const [concurrency, setConcurrencyState] = React.useState(readCanvasBatchConcurrency)
  const productionScope = React.useMemo(
    () => resolveCanvasGenerationScope(activeCategoryId, selectedNodeIds),
    [activeCategoryId, selectedNodeIds],
  )
  const scopedNodes = React.useMemo(
    () => nodesInCanvasProductionScope(nodes, productionScope),
    [nodes, productionScope],
  )
  const eligibleIds = React.useMemo(() => eligibleGenerationNodeIds(nodes, productionScope), [nodes, productionScope])
  const executionGroups = React.useMemo(
    () => groupGenerationNodesByExecutionKind(scopedNodes.filter((node) => !node.locked), edges, nodes),
    [edges, nodes, scopedNodes],
  )

  const setConcurrency = React.useCallback((value: number) => {
    setConcurrencyState(writeCanvasBatchConcurrency(value))
  }, [])

  const generate = React.useCallback(() => {
    if (eligibleIds.length === 0) return
    const state = useGenerationCanvasStore.getState()
    void confirmAndRunPlan(buildDependencyWaves(eligibleIds, { nodes: state.nodes, edges: state.edges }), {
      concurrency,
    })
  }, [concurrency, eligibleIds])

  const applyModel = React.useCallback(
    (input: { executionKind: string; requiredMode: CanvasGenerationExecutionGroup['requiredMode']; value: string; vendor?: string; modelOptions: readonly ModelOption[] }) => {
      const state = useGenerationCanvasStore.getState()
      const targets = nodesInCanvasProductionScope(state.nodes, productionScope).filter(
        (node) => !node.locked &&
          getGenerationNodeExecutionKind(node.kind) === input.executionKind &&
          requiredModeForGenerationNode(node, { nodes: state.nodes, edges: state.edges }) === input.requiredMode,
      )
      if (targets.length === 0) {
        showInfoToast(i18n.t('generationCommon.production.lockedModelChange'))
        return
      }
      const updates = targets.map((node) => ({
        nodeId: node.id,
        patch: buildNodeModelChangePatch({
          node,
          nodes: state.nodes,
          edges: state.edges,
          modelOptions: input.modelOptions,
          value: input.value,
          vendor: input.vendor,
        }),
      }))
      updateNodes(updates)
      const option = findModelOptionByIdentifier(input.modelOptions, input.value, input.vendor)
      showUndoToast({
        message: i18n.t('generationCommon.production.modelChanged', {
          count: updates.length,
          model: option?.label || input.value,
        }),
        onUndo: undo,
      })
    },
    [productionScope, undo, updateNodes],
  )

  return {
    concurrency,
    setConcurrency,
    eligibleIds,
    executionGroups,
    generate,
    applyModel,
  }
}
