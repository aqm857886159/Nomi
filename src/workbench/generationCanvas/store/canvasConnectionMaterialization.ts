import { connectNodes } from '../model/graphOps'
import { planGroupLinkEdges } from '../model/groupInputLinks'
import { resolveCanvasReferenceConnection } from '../model/canvasReferenceConnection'
import { readParameterReferenceSlots } from '../model/parameterReferenceSlots'
import type { GenerationCanvasNode, GenerationCanvasEdge, GenerationCanvasEdgeMode } from '../model/generationCanvasTypes'

type GroupLinkStore = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
}
export type GroupMaterializedConnection = {
  sourceNodeId: string
  targetNodeId: string
  mode: GenerationCanvasEdgeMode
  edge: GenerationCanvasEdge
}
type GroupMaterializeOutcome = {
  edges: GenerationCanvasEdge[]
  connected: GroupMaterializedConnection[]
  skipped: number
  alreadyConnected: number
}

export function materializeGroupLink(
  pre: GroupLinkStore,
  groupId: string | undefined,
  sourceNodeId: string,
  targets: GenerationCanvasNode[],
): GroupMaterializeOutcome {
  const plan = planGroupLinkEdges({ link: { sourceNodeId }, targets, nodes: pre.nodes, edges: pre.edges })
  let edges = pre.edges
  const connected: GroupMaterializedConnection[] = []
  for (const item of plan.connect) {
    const next = connectNodes(edges, item.sourceNodeId, item.targetNodeId, item.mode, item.targetParamKey)
    if (next === edges) continue
    // connectNodes 是 append；给刚加的那条盖上溯源章（成员移出组时据此精确撤边、不误伤手工边）。
    const added = next[next.length - 1]
    if (!added) continue
    const materialized = groupId ? { ...added, viaGroupId: groupId } : added
    next[next.length - 1] = materialized
    edges = next
    connected.push({ sourceNodeId: item.sourceNodeId, targetNodeId: item.targetNodeId, mode: item.mode ?? 'reference', edge: materialized })
  }
  return { edges, connected, skipped: plan.skipped.length, alreadyConnected: plan.alreadyConnected.length }
}

/** 编组作为来源：每个成员各向同一目标物化一条真边；顺序计算使用逐条追加后的 edges。 */
export function materializeGroupOutputLink(
  pre: GroupLinkStore,
  groupId: string | undefined,
  sources: GenerationCanvasNode[],
  target: GenerationCanvasNode,
): GroupMaterializeOutcome {
  let edges = pre.edges
  const connected: GroupMaterializedConnection[] = []
  let skipped = 0
  let alreadyConnected = 0
  for (const source of sources) {
    if (source.id === target.id) continue
    const connection = resolveCanvasReferenceConnection(source, target, pre.nodes, edges)
    const slots = readParameterReferenceSlots(target.meta)
    if (edges.some((edge) => edge.source === source.id && edge.target === target.id &&
      (edge.targetParamKey ? slots.some((slot) => slot.key === edge.targetParamKey) : connection.ok && edge.mode === connection.mode))) {
      alreadyConnected += 1
      continue
    }
    if (!connection.ok) {
      skipped += 1
      continue
    }
    const { mode, targetParamKey } = connection
    const next = connectNodes(edges, source.id, target.id, mode, targetParamKey)
    if (next === edges) continue
    const added = next[next.length - 1]
    if (!added) continue
    const materialized = groupId ? { ...added, viaGroupId: groupId } : added
    next[next.length - 1] = materialized
    edges = next
    connected.push({ sourceNodeId: source.id, targetNodeId: target.id, mode: mode ?? 'reference', edge: materialized })
  }
  return { edges, connected, skipped, alreadyConnected }
}

