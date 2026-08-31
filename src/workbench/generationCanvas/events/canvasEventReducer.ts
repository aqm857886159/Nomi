// 画布事件重放器(harness S5-a):事件 → 投影的纯函数。
// 这就是"账本算余额"的那只手——S5-a 当 CI 安全网(replay≡snapshot 属性测试),
// S5-b 翻正后当 hydrate/undo 的正式投影。复用 graphOps 纯算子保证与 store 同语义。
// 未知事件类型原样跳过(前向兼容:老版本重放新日志不崩,§4.1 演进策略)。
import { connectNodes, disconnectEdge, removeNodes, upsertNode } from '../model/graphOps'
import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'

export type CanvasProjection = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  groups: NodeGroup[]
}

export const emptyCanvasProjection = (): CanvasProjection => ({ nodes: [], edges: [], groups: [] })

type ReplayableEvent = { type: string; payload: Record<string, unknown> }

/** 事件重放的幂等语义是 source+target+mode；ID 是交互身份，不代替图语义去重。 */
function sameEdgeSemantic(a: GenerationCanvasEdge, b: GenerationCanvasEdge): boolean {
  return a.source === b.source && a.target === b.target && a.mode === b.mode
}

export function applyCanvasEvent(projection: CanvasProjection, event: ReplayableEvent): CanvasProjection {
  const payload = event.payload || {}
  switch (event.type) {
    case 'canvas.node.added': {
      const node = payload.node as GenerationCanvasNode | undefined
      if (!node?.id) return projection
      return { ...projection, nodes: upsertNode(projection.nodes, node) }
    }
    case 'canvas.node.moved': {
      const nodeId = String(payload.nodeId || '')
      const position = payload.position as { x: number; y: number } | undefined
      if (!nodeId || !position) return projection
      return {
        ...projection,
        nodes: projection.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
      }
    }
    case 'canvas.node.prompt-changed': {
      const nodeId = String(payload.nodeId || '')
      if (!nodeId) return projection
      return {
        ...projection,
        nodes: projection.nodes.map((node) => (node.id === nodeId ? { ...node, prompt: String(payload.prompt ?? '') } : node)),
      }
    }
    case 'canvas.node.removed': {
      // 只删节点+其边;组成员清理由伴随的 group.updated 后态事件表达
      // (store 里 deleteNode 清组、deleteSelectedNodes 不清——语义必须分开如实记账)。
      const nodeId = String(payload.nodeId || '')
      if (!nodeId) return projection
      const next = removeNodes(projection.nodes, projection.edges, [nodeId])
      return { ...projection, nodes: next.nodes, edges: next.edges }
    }
    case 'canvas.node.updated': {
      const nodeId = String(payload.nodeId || '')
      const patch = payload.patch as Record<string, unknown> | undefined
      if (!nodeId || !patch) return projection
      return {
        ...projection,
        nodes: projection.nodes.map((node) => {
          if (node.id !== nodeId) return node
          // patch 里 value===null = 「清除该字段」(如离开分镜清 shotIndex)——store 用 delete,
          // 重放必须等价删键才 ≡ snapshot。null 是 JSON-safe 的删除信号(undefined 会被
          // EventLog 的 JSON 序列化吞掉,过不了持久化)。
          const next: Record<string, unknown> = { ...node }
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) delete next[key]
            else next[key] = value
          }
          return next as GenerationCanvasNode
        }),
      }
    }
    case 'canvas.node.locked':
    case 'canvas.node.unlocked': {
      // S6-4 节点锁:幂等置位/复位(重复重放同帧等价)。
      const lockTargetId = String(payload.nodeId || '')
      if (!lockTargetId) return projection
      const locked = event.type === 'canvas.node.locked'
      return {
        ...projection,
        nodes: projection.nodes.map((node) => (node.id === lockTargetId ? { ...node, locked } : node)),
      }
    }
    case 'canvas.node.ungrouped': {
      const nodeId = String(payload.nodeId || '')
      if (!nodeId) return projection
      return {
        ...projection,
        nodes: projection.nodes.map((node) => {
          if (node.id !== nodeId) return node
          const next = { ...node }
          delete (next as Record<string, unknown>).groupId
          return next
        }),
      }
    }
    case 'canvas.edge.connected': {
      const source = String(payload.sourceNodeId || '')
      const target = String(payload.targetNodeId || '')
      if (!source || !target) return projection
      // 仅用于重放旧日志：历史 connected 事件不带完整边对象，后续 mode-changed /
      // disconnected 却用旧式 edge-source-target ID。先复用统一算子判重/算 order，再把
      // 新增边恢复为旧 ID，才能让同一条历史尾巴里的后续事件继续命中。
      const legacyId = String(payload.edgeId || `edge-${source}-${target}`)
      // 快照 lastSeq 可能落后于快照内容，同一尾巴会被重复应用；此时 mode 可能已被
      // 后续事件改过，不能再按 mode 判重，legacy ID 才是这条历史边的稳定身份。
      if (projection.edges.some((edge) => edge.id === legacyId)) return projection
      const edges = connectNodes(projection.edges, source, target, payload.mode as GenerationCanvasEdge['mode'])
      if (edges === projection.edges) return projection
      const lastIndex = edges.length - 1
      return {
        ...projection,
        edges: edges.map((edge, index) => (index === lastIndex ? { ...edge, id: legacyId } : edge)),
      }
    }
    case 'canvas.edge.mode-changed': {
      const edgeId = String(payload.edgeId || '')
      if (!edgeId) return projection
      return {
        ...projection,
        edges: projection.edges.map((edge) => (edge.id === edgeId ? { ...edge, mode: payload.mode as GenerationCanvasEdge['mode'] } : edge)),
      }
    }
    case 'canvas.edge.disconnected': {
      const edgeId = String(payload.edgeId || '')
      if (!edgeId) return projection
      return { ...projection, edges: disconnectEdge(projection.edges, edgeId) }
    }
    case 'canvas.group.created': {
      const group = payload.group as NodeGroup | undefined
      if (!group?.id) return projection
      // 幂等(S5-b-1):尾部重放可能重看快照里已有的事件
      if (projection.groups.some((candidate) => candidate.id === group.id)) return projection
      return { ...projection, groups: [...projection.groups, group] }
    }
    case 'canvas.group.updated': {
      const group = payload.group as NodeGroup | undefined
      if (!group?.id) return projection
      return { ...projection, groups: projection.groups.map((candidate) => (candidate.id === group.id ? group : candidate)) }
    }
    case 'canvas.group.removed': {
      const groupId = String(payload.groupId || '')
      if (!groupId) return projection
      const released = new Set(Array.isArray(payload.releasedNodeIds) ? (payload.releasedNodeIds as string[]) : [])
      return {
        ...projection,
        nodes: projection.nodes.map((node) => {
          if (!released.has(node.id)) return node
          const next = { ...node }
          delete (next as Record<string, unknown>).groupId
          return next
        }),
        groups: projection.groups.filter((candidate) => candidate.id !== groupId),
      }
    }
    case 'canvas.node.run-updated': {
      // run 域终态收敛(S5-a3):后态整节点替换——内部时间戳/runs 合并逻辑无需镜像
      const node = payload.node as GenerationCanvasNode | undefined
      if (!node?.id) return projection
      return { ...projection, nodes: projection.nodes.map((candidate) => (candidate.id === node.id ? node : candidate)) }
    }
    case 'canvas.edge.added': {
      // 整边对象(paste 等克隆路径:边 id 已定,不能走 connectNodes 重铸 id)
      const edge = payload.edge as GenerationCanvasEdge | undefined
      if (!edge?.id) return projection
      // ID 是新事件的稳定身份；semantic fallback 兼容被旧快照规范化过 ID 的同一条边。
      // 已存在时必须保留快照里的较新 mode，不能拿较早的 added 后态覆盖它。
      if (projection.edges.some((candidate) => candidate.id === edge.id || sameEdgeSemantic(candidate, edge))) return projection
      return { ...projection, edges: [...projection.edges, edge] }
    }
    case 'canvas.edge.removed': {
      // ID 主定位保证边后来改过 mode 仍能被重复尾巴删掉；semantic fallback 兼容旧事件。
      const edge = payload.edge as GenerationCanvasEdge | undefined
      if (!edge?.id) return projection
      const hasExactId = projection.edges.some((candidate) => candidate.id === edge.id)
      return {
        ...projection,
        edges: projection.edges.filter((candidate) => (
          hasExactId ? candidate.id !== edge.id : !sameEdgeSemantic(candidate, edge)
        )),
      }
    }
    case 'canvas.snapshot.restored': {
      // 全量后态(undo/redo/hydrate 的影子记账;S5-b 翻正后 undo 改为按 txn 重放)
      const snapshot = payload.snapshot as Partial<CanvasProjection> | undefined
      if (!snapshot) return projection
      return {
        nodes: Array.isArray(snapshot.nodes) ? snapshot.nodes : [],
        edges: Array.isArray(snapshot.edges) ? snapshot.edges : [],
        groups: Array.isArray(snapshot.groups) ? snapshot.groups : [],
      }
    }
    case 'canvas.groups.reordered': {
      const groups = payload.groups as NodeGroup[] | undefined
      if (!Array.isArray(groups)) return projection
      return { ...projection, groups }
    }
    default:
      return projection
  }
}

export function replayCanvasEvents(events: readonly ReplayableEvent[]): CanvasProjection {
  return events.reduce(applyCanvasEvent, emptyCanvasProjection())
}
