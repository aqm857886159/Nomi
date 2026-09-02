import React from 'react'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  toGenerationFlowEdges,
  toGenerationFlowNodes,
  type GenerationFlowEdge,
  type GenerationFlowNode,
} from './generationCanvasReactFlowAdapter'

type ProjectionOptions = {
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  /** Optional endpoint map for synthetic/collapsed group edge projections. */
  edgeNodeById?: ReadonlyMap<string, GenerationCanvasNode>
  aggregateByEdgeId?: ReadonlyMap<string, { groupId: string; direction: 'input' | 'output' }>
  selectedNodeIds: readonly string[]
  selectedEdgeId: string | null
  readOnly: boolean
  appearingNodeIds?: ReadonlySet<string>
  focusFlashNodeId?: string | null
}

export function useGenerationCanvasReactFlowProjection({
  nodes,
  edges,
  edgeNodeById,
  aggregateByEdgeId,
  selectedNodeIds,
  selectedEdgeId,
  readOnly,
  appearingNodeIds,
  focusFlashNodeId,
}: ProjectionOptions): {
  selectedSet: Set<string>
  nodeById: Map<string, GenerationCanvasNode>
  flowNodes: GenerationFlowNode[]
  flowEdges: GenerationFlowEdge[]
} {
  const selectedSet = React.useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const nodeById = React.useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const edgeNodes = edgeNodeById ?? nodeById
  const previousFlowNodesRef = React.useRef<GenerationFlowNode[]>([])
  const flowNodes = React.useMemo(() => {
    const next = toGenerationFlowNodes(nodes, readOnly, previousFlowNodesRef.current, {
      appearingNodeIds,
      focusFlashNodeId,
    }, selectedSet)
    previousFlowNodesRef.current = next
    return next
  }, [appearingNodeIds, focusFlashNodeId, nodes, readOnly, selectedSet])
  const previousFlowEdgesRef = React.useRef<GenerationFlowEdge[]>([])
  const flowEdges = React.useMemo(() => {
    const next = toGenerationFlowEdges(edges, edgeNodes, {
      readOnly,
      selectedEdgeId,
      selectedNodeIds: selectedSet,
      aggregateByEdgeId,
      previousEdges: previousFlowEdgesRef.current,
    })
    previousFlowEdgesRef.current = next
    return next
  }, [aggregateByEdgeId, edgeNodes, edges, readOnly, selectedEdgeId, selectedSet])

  return { selectedSet, nodeById, flowNodes, flowEdges }
}
