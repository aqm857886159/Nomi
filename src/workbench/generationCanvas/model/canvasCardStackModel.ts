import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from './generationCanvasTypes'

export type CollapsedGroupCardProjection = {
  groupId: string
  name: string
  memberCount: number
  position: { x: number; y: number }
  coverNode?: GenerationCanvasNode
}

export type AggregateGroupEdgeProjection = {
  groupId: string
  direction: 'input' | 'output'
  memberEdgeIds: string[]
}

export const COLLAPSED_GROUP_CARD_SIZE = 224

export type CollapsedCanvasProjection = {
  visibleNodes: GenerationCanvasNode[]
  visibleEdges: GenerationCanvasEdge[]
  edgeNodeById: Map<string, GenerationCanvasNode>
  aggregateEdges: ReadonlyMap<string, AggregateGroupEdgeProjection>
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
      aggregateEdges: new Map(),
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
    })
    projectedNodeById.set(group.id, {
      id: group.id,
      kind: 'image',
      title: group.name,
      categoryId: group.categoryId,
      position,
      size: { width: COLLAPSED_GROUP_CARD_SIZE, height: COLLAPSED_GROUP_CARD_SIZE },
      status: 'idle',
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
  const visibleEdges: GenerationCanvasEdge[] = []
  const aggregateEdges = new Map<string, AggregateGroupEdgeProjection>()
  const aggregateRepresentativeByRelation = new Map<string, string>()
  const collapsedGroupById = new Map(collapsedGroups.map((group) => [group.id, group]))
  for (const edge of edges) {
    const sourceGroupId = groupByMemberId.get(edge.source)
    const targetGroupId = groupByMemberId.get(edge.target)
    if (sourceGroupId && targetGroupId && sourceGroupId === targetGroupId) continue

    let aggregate: Omit<AggregateGroupEdgeProjection, 'memberEdgeIds'> | null = null
    let relationKey = ''
    const declaredGroup = edge.viaGroupId ? collapsedGroupById.get(edge.viaGroupId) : undefined
    const outputLink = declaredGroup?.outputLinks?.find((link) => link.targetNodeId === edge.target)
    const inputLink = declaredGroup?.inputLinks?.find((link) => (
      link.sourceNodeId === edge.source && (link.mode == null || link.mode === edge.mode)
    ))
    if (declaredGroup && outputLink && sourceGroupId === declaredGroup.id) {
      aggregate = { groupId: sourceGroupId, direction: 'output' }
      relationKey = `${sourceGroupId}:output:${edge.target}`
    } else if (declaredGroup && inputLink && targetGroupId === declaredGroup.id) {
      aggregate = { groupId: targetGroupId, direction: 'input' }
      relationKey = `${targetGroupId}:input:${edge.source}:${inputLink.mode || 'auto'}`
    }

    if (!aggregate) {
      visibleEdges.push(edge)
      continue
    }
    const representativeId = aggregateRepresentativeByRelation.get(relationKey)
    if (representativeId) {
      aggregateEdges.get(representativeId)?.memberEdgeIds.push(edge.id)
      continue
    }
    aggregateRepresentativeByRelation.set(relationKey, edge.id)
    aggregateEdges.set(edge.id, { ...aggregate, memberEdgeIds: [edge.id] })
    visibleEdges.push(edge)
  }

  return {
    visibleNodes,
    visibleEdges,
    edgeNodeById: projectedNodeById,
    aggregateEdges,
    cards,
    collapsedNodeIds,
  }
}
