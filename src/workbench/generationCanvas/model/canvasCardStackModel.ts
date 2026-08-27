import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from './generationCanvasTypes'

export type CollapsedGroupCardProjection = {
  groupId: string
  name: string
  memberCount: number
  position: { x: number; y: number }
  coverNode?: GenerationCanvasNode
  color?: string
}

export type CollapsedCanvasProjection = {
  visibleNodes: GenerationCanvasNode[]
  visibleEdges: GenerationCanvasEdge[]
  edgeNodeById: Map<string, GenerationCanvasNode>
  cards: readonly CollapsedGroupCardProjection[]
  collapsedNodeIds: ReadonlySet<string>
}

export function getCardStackRearLayerCount(entryCount: number): 0 | 1 | 2 {
  if (entryCount <= 1) return 0
  return entryCount === 2 ? 1 : 2
}

function coverNodeForGroup(members: readonly GenerationCanvasNode[]): GenerationCanvasNode | undefined {
  for (let index = members.length - 1; index >= 0; index -= 1) {
    const node = members[index]
    if (node?.result?.type === 'image' || node?.result?.type === 'video') return node
  }
  return members.at(-1)
}

export function projectCollapsedGroups(
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
  groups: readonly NodeGroup[],
): CollapsedCanvasProjection {
  const collapsedGroups = groups.filter((group) => group.collapsed && group.nodeIds.length > 0)
  const baseNodeById = new Map(nodes.map((node) => [node.id, node]))
  if (collapsedGroups.length === 0) {
    return {
      visibleNodes: [...nodes],
      visibleEdges: [...edges],
      edgeNodeById: baseNodeById,
      cards: [],
      collapsedNodeIds: new Set(),
    }
  }

  const groupByMemberId = new Map<string, string>()
  const cards: CollapsedGroupCardProjection[] = []
  const projectedNodeById = new Map(baseNodeById)

  for (const group of collapsedGroups) {
    const members = group.nodeIds.flatMap((nodeId) => {
      const node = baseNodeById.get(nodeId)
      return node && (node.categoryId || 'shots') === group.categoryId ? [node] : []
    })
    if (members.length === 0) continue
    const position = {
      x: Math.min(...members.map((node) => node.position.x)),
      y: Math.min(...members.map((node) => node.position.y)),
    }
    const coverNode = coverNodeForGroup(members)
    cards.push({
      groupId: group.id,
      name: group.name,
      memberCount: members.length,
      position,
      ...(coverNode ? { coverNode } : {}),
      ...(group.color ? { color: group.color } : {}),
    })
    for (const member of members) {
      groupByMemberId.set(member.id, group.id)
      projectedNodeById.set(member.id, {
        ...member,
        position,
        ...(coverNode?.size ? { size: { ...coverNode.size } } : {}),
      })
    }
  }

  const collapsedNodeIds = new Set(groupByMemberId.keys())
  const visibleNodes = nodes.filter((node) => !collapsedNodeIds.has(node.id))
  const visibleEdges = edges.filter((edge) => {
    const sourceGroupId = groupByMemberId.get(edge.source)
    const targetGroupId = groupByMemberId.get(edge.target)
    return !sourceGroupId || !targetGroupId || sourceGroupId !== targetGroupId
  })

  return {
    visibleNodes,
    visibleEdges,
    edgeNodeById: projectedNodeById,
    cards,
    collapsedNodeIds,
  }
}
