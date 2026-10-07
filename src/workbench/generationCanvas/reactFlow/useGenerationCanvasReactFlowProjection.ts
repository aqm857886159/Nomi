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
  // React Flow recomputes edge anchors from its node internals. During a drag the
  // node positions change every frame, but edge identity, labels and modes do not.
  // Keep those structural inputs referentially stable so the edge layer does not
  // rebuild every SVG path on each pointer sample.
  const edgeStructureKey = React.useMemo(
    () => edges.map((edge) => [edge.id, edge.source, edge.target, edge.mode, edge.viaGroupId, edge.order].join(':')).join('|'),
    [edges],
  )
  const stableEdgesRef = React.useRef<{ key: string; value: readonly GenerationCanvasEdge[] }>({ key: '', value: [] })
  const stableEdges = React.useMemo(() => {
    if (stableEdgesRef.current.key === edgeStructureKey) return stableEdgesRef.current.value
    stableEdgesRef.current = { key: edgeStructureKey, value: edges }
    return edges
  }, [edgeStructureKey, edges])
  const edgeNodesValue = edgeNodeById ?? nodeById
  const edgeNodeStructureKey = React.useMemo(
    () => Array.from(edgeNodesValue.values())
      .map((node) => [node.id, node.kind, node.title, node.status, node.typeId, node.result?.type].join(':'))
      .join('|'),
    [edgeNodesValue],
  )
  const stableEdgeNodesRef = React.useRef<{ key: string; value: ReadonlyMap<string, GenerationCanvasNode> }>({ key: '', value: new Map() })
  const stableEdgeNodes = React.useMemo(() => {
    if (stableEdgeNodesRef.current.key === edgeNodeStructureKey) return stableEdgeNodesRef.current.value
    stableEdgeNodesRef.current = { key: edgeNodeStructureKey, value: edgeNodesValue }
    return edgeNodesValue
  }, [edgeNodeStructureKey, edgeNodesValue])
  const aggregateStructureKey = React.useMemo(
    () => Array.from((aggregateByEdgeId ?? new Map()).entries())
      .map(([edgeId, aggregate]) => [edgeId, aggregate.groupId, aggregate.direction].join(':'))
      .join('|'),
    [aggregateByEdgeId],
  )
  const stableAggregateRef = React.useRef<{ key: string; value?: ReadonlyMap<string, { groupId: string; direction: 'input' | 'output' }> }>({ key: '' })
  const stableAggregateByEdgeId = React.useMemo(() => {
    if (stableAggregateRef.current.key === aggregateStructureKey) return stableAggregateRef.current.value
    stableAggregateRef.current = { key: aggregateStructureKey, value: aggregateByEdgeId }
    return aggregateByEdgeId
  }, [aggregateByEdgeId, aggregateStructureKey])
  const previousFlowNodesRef = React.useRef<GenerationFlowNode[]>([])
  const flowNodes = React.useMemo(() => {
    const next = toGenerationFlowNodes(nodes, selectedSet, readOnly, previousFlowNodesRef.current, {
      appearingNodeIds,
      focusFlashNodeId,
    })
    previousFlowNodesRef.current = next
    return next
  }, [appearingNodeIds, focusFlashNodeId, nodes, readOnly, selectedSet])
  const previousFlowEdgesRef = React.useRef<GenerationFlowEdge[]>([])
  const flowEdges = React.useMemo(() => {
    const next = toGenerationFlowEdges(stableEdges, stableEdgeNodes, {
      readOnly,
      selectedEdgeId,
      selectedNodeIds: selectedSet,
      aggregateByEdgeId: stableAggregateByEdgeId,
      previousEdges: previousFlowEdgesRef.current,
    })
    previousFlowEdgesRef.current = next
    return next
  }, [readOnly, selectedEdgeId, selectedSet, stableAggregateByEdgeId, stableEdgeNodes, stableEdges])

  return { selectedSet, nodeById, flowNodes, flowEdges }
}
