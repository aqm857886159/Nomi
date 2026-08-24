import React from 'react'
import type { ModelOption } from '../../../config/models'
import i18n from '../../../i18n'
import { showInfoToast } from '../../../utils/showInfoToast'
import { showUndoToast } from '../../../utils/showUndoToast'
import { findModelOptionByIdentifier, useGenerationModelOptionsState } from '../adapters/modelOptionsAdapter'
import { getGenerationNodeCatalogKind, getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { buildNodeModelChangePatch } from '../nodes/buildNodeModelChangePatch'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { confirmAndRunPlan } from './batchPlanPreview'
import {
  eligibleGenerationNodeIds,
  groupGenerationNodesByExecutionKind,
  readCanvasBatchConcurrency,
  writeCanvasBatchConcurrency,
} from './canvasProductionScope'
import { nodeSelectedModelAddress } from '../nodes/controls/parameterControlModel'
import { estimateBatchGenerationCost } from '../spend/generationCost'

export function useCanvasProductionActions(params: {
  activeCategoryId: string
  selectedNodeIds: readonly string[]
}) {
  const { activeCategoryId, selectedNodeIds } = params
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const updateNodes = useGenerationCanvasStore((state) => state.updateNodes)
  const undo = useGenerationCanvasStore((state) => state.undo)
  const [concurrency, setConcurrencyState] = React.useState(readCanvasBatchConcurrency)
  const selectedSet = React.useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const selectedNodes = React.useMemo(
    () => nodes.filter((node) => selectedSet.has(node.id)),
    [nodes, selectedSet],
  )
  const textOptions = useGenerationModelOptionsState('text').options
  const imageOptions = useGenerationModelOptionsState('image').options
  const videoOptions = useGenerationModelOptionsState('video').options
  const audioOptions = useGenerationModelOptionsState('audio').options
  const model3dOptions = useGenerationModelOptionsState('model3d').options
  const modelOptionsByKind = React.useMemo(
    () => ({ text: textOptions, image: imageOptions, video: videoOptions, audio: audioOptions, model3d: model3dOptions }),
    [audioOptions, imageOptions, model3dOptions, textOptions, videoOptions],
  )
  const eligibleIds = React.useMemo(
    () => eligibleGenerationNodeIds(
      nodes,
      selectedNodeIds.length > 0 ? { nodeIds: selectedNodeIds } : { categoryId: activeCategoryId },
    ),
    [activeCategoryId, nodes, selectedNodeIds],
  )
  const executionGroups = React.useMemo(
    () => groupGenerationNodesByExecutionKind(selectedNodes.filter((node) => !node.locked)),
    [selectedNodes],
  )
  const costEstimate = React.useMemo(() => {
    const inputs = eligibleIds.map((id) => {
      const node = nodes.find((candidate) => candidate.id === id)
      if (!node) return { option: undefined, params: undefined }
      const catalogKind = getGenerationNodeCatalogKind(node.kind)
      const options = modelOptionsByKind[catalogKind as keyof typeof modelOptionsByKind]
      const address = nodeSelectedModelAddress(node.meta || {})
      return {
        option: findModelOptionByIdentifier(options, address.modelKey, address.vendorKey),
        params: node.meta,
      }
    })
    return estimateBatchGenerationCost(inputs)
  }, [eligibleIds, modelOptionsByKind, nodes])

  const setConcurrency = React.useCallback((value: number) => {
    setConcurrencyState(writeCanvasBatchConcurrency(value))
  }, [])

  const generate = React.useCallback(() => {
    if (eligibleIds.length === 0) return
    const state = useGenerationCanvasStore.getState()
    void confirmAndRunPlan(
      buildDependencyWaves(eligibleIds, { nodes: state.nodes, edges: state.edges }),
      { concurrency },
    )
  }, [concurrency, eligibleIds])

  const applyModel = React.useCallback((input: {
    executionKind: string
    value: string
    vendor?: string
    modelOptions: readonly ModelOption[]
  }) => {
    const state = useGenerationCanvasStore.getState()
    const selectedIds = new Set(selectedNodeIds)
    const targets = state.nodes.filter((node) =>
      selectedIds.has(node.id)
      && !node.locked
      && getGenerationNodeExecutionKind(node.kind) === input.executionKind)
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
  }, [selectedNodeIds, undo, updateNodes])

  return {
    concurrency,
    setConcurrency,
    eligibleIds,
    executionGroups,
    costEstimate,
    generate,
    applyModel,
  }
}
