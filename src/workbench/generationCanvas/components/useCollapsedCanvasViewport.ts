import React from 'react'
import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import { projectCollapsedGroups } from '../model/canvasCardStackModel'
import { getCanvasGroupBoxes } from './generationCanvasGeometry'
import { useCanvasViewport } from './useCanvasViewport'

export function useCollapsedCanvasViewport({
  activeCategoryId,
  nodes,
  edges,
  groups,
  readOnly,
}: {
  activeCategoryId: string
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  groups: NodeGroup[]
  readOnly: boolean
}) {
  // 只读画布必须仍能看见组内节点；不提供会偷偷持久化的“临时展开”。
  const projectedGroups = React.useMemo(
    () => readOnly ? groups.map((group) => group.collapsed ? { ...group, collapsed: false } : group) : groups,
    [groups, readOnly],
  )
  const projection = React.useMemo(
    () => projectCollapsedGroups(nodes, edges, projectedGroups),
    [edges, nodes, projectedGroups],
  )
  const groupBoxes = React.useMemo(
    () => getCanvasGroupBoxes(projectedGroups.filter((group) => !group.collapsed), nodes),
    [nodes, projectedGroups],
  )
  const viewport = useCanvasViewport(activeCategoryId, projection.visibleNodes)
  const edgeVisibleNodeIds = React.useMemo(() => {
    if (!viewport.visibleEdgeNodeIds) return null
    return new Set([...viewport.visibleEdgeNodeIds, ...projection.collapsedNodeIds])
  }, [projection.collapsedNodeIds, viewport.visibleEdgeNodeIds])
  const edgesForRender = React.useMemo(() => {
    if (!edgeVisibleNodeIds) return projection.visibleEdges
    return projection.visibleEdges.filter(
      (edge) => edgeVisibleNodeIds.has(edge.source) || edgeVisibleNodeIds.has(edge.target),
    )
  }, [edgeVisibleNodeIds, projection.visibleEdges])
  return { projection, groupBoxes, edgeVisibleNodeIds, edgesForRender, viewport }
}
