// 画布快照归一化 + 种子节点。从 generationCanvasStore.ts 抽出。
// 注意：这是 store 专用的深度归一化（过滤未知 kind、position 兜底、groups 走 zod、edges 校验端点），
// 与 workbenchPersistence.ts 的轻量直通版 normalizeGenerationCanvasSnapshot 行为不同，故改名 normalizeStoreSnapshot。
import { isGenerationNodeKind } from '../model/generationNodeKinds'
import { nodeGroupSchema } from '../model/generationCanvasSchema'
import { isCategoryId } from './canvasGuards'
import { createDefaultGenerationCanvasSnapshot } from './generationCanvasDefaults'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationCanvasSnapshot,
  GenerationNodeProgress,
  GenerationNodeRunRecord,
  GenerationNodeRunStatus,
  GenerationNodeStatus,
  NodeGroup,
} from '../model/generationCanvasTypes'

/**
 * 重启收敛：磁盘里 status 仍是 running/queued 的节点 = 上次退出时正在生成（没活着的轮询循环了）。
 * 有 taskId（已落盘）→ 收敛成 `recoverable`：上游可能仍在跑/已出片，给「重新拉取结果」入口（重启后也能拉）。
 * 无 taskId（从没真发出去）→ 收敛成 `idle`：清掉幽灵转圈。progress 一律清空（重启不再假装在转）。
 */
function convergeStuckMidFlightNode(
  node: Omit<GenerationCanvasNode, 'categoryId'>,
): Omit<GenerationCanvasNode, 'categoryId'> {
  if (node.status !== 'running' && node.status !== 'queued') return node
  const runs: GenerationNodeRunRecord[] = Array.isArray(node.runs) ? node.runs : []
  const taskId = (runs[0]?.taskId || (node.progress as GenerationNodeProgress | undefined)?.taskId || '').trim()
  const nextStatus: GenerationNodeStatus = taskId ? 'recoverable' : 'idle'
  const nextRunStatus: GenerationNodeRunStatus = taskId ? 'recoverable' : 'cancelled'
  const nextRuns = runs.length
    ? [{ ...runs[0], status: nextRunStatus, progress: undefined }, ...runs.slice(1)]
    : runs
  return { ...node, status: nextStatus, progress: undefined, runs: nextRuns }
}

export function normalizeStoreSnapshot(input: unknown): GenerationCanvasSnapshot {
  if (!input || typeof input !== 'object') {
    // 默认画布单一真相源：此前这里自持一份不带 categoryId 的 seedNodes 拷贝，
    // 是「新建项目触发 legacy 迁移」的又一入口（审计 A4）。
    return createDefaultGenerationCanvasSnapshot()
  }
  const raw = input as Record<string, unknown>
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes.flatMap((item): GenerationCanvasNode[] => {
        if (!item || typeof item !== 'object') return []
        const node = item as Record<string, unknown>
        const id = typeof node.id === 'string' ? node.id.trim() : ''
        const kind = isGenerationNodeKind(node.kind) ? node.kind : null
        const positionRaw = node.position && typeof node.position === 'object' ? node.position as Record<string, unknown> : {}
        const x = typeof positionRaw.x === 'number' && Number.isFinite(positionRaw.x) ? positionRaw.x : 0
        const y = typeof positionRaw.y === 'number' && Number.isFinite(positionRaw.y) ? positionRaw.y : 0
        if (!id || !kind) return []
        const rawCategoryId = typeof node.categoryId === 'string' ? node.categoryId.trim() : undefined
        const categoryId = isCategoryId(rawCategoryId) ? rawCategoryId : undefined
        const { categoryId: _discardedCategoryId, ...nodeWithoutCategoryId } = node
        const normalizedNode: Omit<GenerationCanvasNode, 'categoryId'> = {
          ...(nodeWithoutCategoryId as Omit<GenerationCanvasNode, 'categoryId'>),
          id,
          kind,
          title: typeof node.title === 'string' ? node.title : id,
          position: { x, y },
        }
        const convergedNode = convergeStuckMidFlightNode(normalizedNode)
        return [categoryId ? { ...convergedNode, categoryId } : convergedNode]
      })
    : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(raw.edges)
    ? raw.edges.flatMap((item): GenerationCanvasEdge[] => {
        if (!item || typeof item !== 'object') return []
        const edge = item as Record<string, unknown>
        const id = typeof edge.id === 'string' ? edge.id.trim() : ''
        const source = typeof edge.source === 'string' ? edge.source.trim() : ''
        const target = typeof edge.target === 'string' ? edge.target.trim() : ''
        if (!id || !source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return []
        return [{ ...(edge as GenerationCanvasEdge), id, source, target }]
      })
    : []
  const selectedNodeIds = Array.isArray(raw.selectedNodeIds)
    ? raw.selectedNodeIds.filter((id): id is string => typeof id === 'string' && nodeIds.has(id))
    : []
  const groups = Array.isArray(raw.groups)
    ? raw.groups.flatMap((group): NodeGroup[] => {
        const parsed = nodeGroupSchema.safeParse(group)
        if (!parsed.success) return []
        return [{
          ...parsed.data,
          nodeIds: Array.from(new Set(parsed.data.nodeIds.filter((id) => nodeIds.has(id)))),
        }]
      })
    : []
  return {
    nodes,
    edges,
    groups,
    selectedNodeIds,
  }
}
