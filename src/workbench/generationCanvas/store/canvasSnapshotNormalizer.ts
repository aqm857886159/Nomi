import { backfillShotIndexes } from '../model/shotNumbering'
// 画布快照归一化 + 种子节点。从 generationCanvasStore.ts 抽出。
// 注意：这是 store 专用的深度归一化（过滤未知 kind、position 兜底、groups 走 zod、edges 校验端点），
// 与 workbenchPersistence.ts 的轻量直通版 normalizeGenerationCanvasSnapshot 行为不同，故改名 normalizeStoreSnapshot。
import { normalizeShotTableMeta } from '../../../../electron/shared/canvas/shotTable'
import { convergeDeconstructionNodes } from '../nodes/shotTable/deconstructionLifecycle'
import { isGenerationNodeKind } from '../model/generationNodeKinds'
import { normalizeParameterEdges } from '../model/parameterReferenceSlots'
import { nodeGroupSchema } from '../model/generationCanvasSchema'
import { isLegacyScene3DNode, migrateScene3DNode } from '../nodes/director/migration/migrateScene3dNode'
import { backfillGroupFrameBounds } from '../model/canvasFrameBounds'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { isCategoryId } from './canvasGuards'
import { createDefaultGenerationCanvasSnapshot } from './generationCanvasDefaults'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationCanvasSnapshot,
  GenerationNodeProgress,
  GenerationNodeResult,
  GenerationNodeRunRecord,
  GenerationNodeRunStatus,
  GenerationNodeStatus,
  NodeGroup,
} from '../model/generationCanvasTypes'
import { isCanvasWorkflowTemplate } from '../plugins/canvasWorkflowTemplates'
import { assetUrlForProductionPreview } from '../../../../electron/shared/productionPreviewUrl'
import { isProductionRunRecord } from '../../../../electron/shared/productionShotPhase'

/**
 * 重启收敛：磁盘里 status 仍是 running/queued 的节点 = 上次退出时正在生成（没活着的轮询循环了）。
 * 有 taskId（已落盘）→ 收敛成 `recoverable`：上游可能仍在跑/已出片，给「重新拉取结果」入口（重启后也能拉）。
 * 无 taskId（从没真发出去）→ 收敛成 `idle`：清掉幽灵转圈。progress 一律清空（重启不再假装在转）。
 *
 * **制作投影写的那条记录不归这里管**（`isProductionRunRecord`）：它本来就没有任务号——任务住在主进程的 Run 里，
 * 只有 Run 知道它还在不在跑。收敛把它当幽灵收成空闲，重开窗口后在跑的镜就变成一张空白节点（2026-09-26 真付费 T5）。
 * 它的「生成中 / 失败 / 结束 / 出片」只由制作投影写（`applyShotGeneration`）：App 重启时主进程重新补齐一次，
 * 窗口重开期间 Run 的每次变化都由跟随者投影过来。
 */
function convergeStuckMidFlightNode(
  node: Omit<GenerationCanvasNode, 'categoryId'>,
): Omit<GenerationCanvasNode, 'categoryId'> {
  if (node.status !== 'running' && node.status !== 'queued') return node
  const runs: GenerationNodeRunRecord[] = Array.isArray(node.runs) ? node.runs : []
  if (isProductionRunRecord(runs[0])) return node
  const taskId = (runs[0]?.taskId || (node.progress as GenerationNodeProgress | undefined)?.taskId || '').trim()
  const nextStatus: GenerationNodeStatus = taskId ? 'recoverable' : 'idle'
  const nextRunStatus: GenerationNodeRunStatus = taskId ? 'recoverable' : 'cancelled'
  const nextRuns = runs.length
    ? [{ ...runs[0], status: nextRunStatus, progress: undefined }, ...runs.slice(1)]
    : runs
  return { ...node, status: nextStatus, progress: undefined, runs: nextRuns }
}

/**
 * 旧版制作落地写进结果的签名预览链（5 分钟过期）→ 素材库永久地址。见 electron/shared/productionPreviewUrl.ts。
 * 只改写认得出的那一种；别的地址一个字不动。
 */
function migrateProductionPreviewResult(result: GenerationNodeResult): GenerationNodeResult {
  const url = assetUrlForProductionPreview(result.url)
  const thumbnailUrl = assetUrlForProductionPreview(result.thumbnailUrl)
  if (!url && !thumbnailUrl) return result
  return { ...result, ...(url ? { url } : {}), ...(thumbnailUrl ? { thumbnailUrl } : {}) }
}

function migrateProductionPreviewResults(node: Omit<GenerationCanvasNode, 'categoryId'>): Omit<GenerationCanvasNode, 'categoryId'> {
  const result = node.result && typeof node.result === 'object' ? migrateProductionPreviewResult(node.result) : node.result
  const history = Array.isArray(node.history) ? node.history.map((entry) => entry && typeof entry === 'object' ? migrateProductionPreviewResult(entry) : entry) : node.history
  if (result === node.result && (history === node.history || history?.every((entry, index) => entry === node.history?.[index]))) return node
  return { ...node, ...(result ? { result } : {}), ...(history ? { history } : {}) }
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
        const rawNode = item as Record<string, unknown>
        // 切换门（2026-09-03）：老 scene3d 节点在加载时迁成 director（kind + meta.directorProject），之后与普通 director 节点无异
        const node = (() => {
          if (!isLegacyScene3DNode(rawNode)) return rawNode
          const migrated = migrateScene3DNode(rawNode, typeof rawNode.title === 'string' && rawNode.title ? rawNode.title : 'Scene 1')
          return { ...rawNode, kind: migrated.kind, meta: migrated.meta }
        })()
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
          ...(kind === 'shot_table' ? { meta: normalizeShotTableMeta(node.meta) } : {}),
        }
        // 拆解的终态判定不在这里自己算一遍：`deconstructionLifecycle` 是唯一 owner，
        // 这里只是它的三条读路径之一（另两条是事件尾巴重放与外部图应用），
        // 且必须在**重放之后**再收敛一次——2026-09-10 那句只在这里收敛的 `running → idle`
        // 会被事件尾巴原样盖回去，等于没收敛（T-ED-06）。
        const convergedNode = convergeStuckMidFlightNode(migrateProductionPreviewResults(normalizedNode))
        return [categoryId ? { ...convergedNode, categoryId } : convergedNode]
      })
    : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const usedEdgeIds = new Set<string>()
  const edges = Array.isArray(raw.edges)
    ? raw.edges.flatMap((item): GenerationCanvasEdge[] => {
        if (!item || typeof item !== 'object') return []
        const edge = item as Record<string, unknown>
        const id = typeof edge.id === 'string' ? edge.id.trim() : ''
        const source = typeof edge.source === 'string' ? edge.source.trim() : ''
        const target = typeof edge.target === 'string' ? edge.target.trim() : ''
        if (!id || !source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return []
        let uniqueId = id
        // 2026-08-07 之前 createEdgeId 只含 source+target，同两点多标签边会撞 id，
        // React key / 命中 / 改标签 / 断开都变得歧义。恢复时仅修复重复项，首条保持旧 id；
        // suffix 由快照顺序确定，同一快照多次恢复结果一致。
        if (usedEdgeIds.has(uniqueId)) {
          let suffix = typeof edge.order === 'number' && Number.isFinite(edge.order) ? edge.order : usedEdgeIds.size
          uniqueId = `${id}::${suffix}`
          while (usedEdgeIds.has(uniqueId)) {
            suffix += 1
            uniqueId = `${id}::${suffix}`
          }
        }
        usedEdgeIds.add(uniqueId)
        return [{ ...(edge as GenerationCanvasEdge), id: uniqueId, source, target }]
      })
    : []
  const selectedNodeIds = Array.isArray(raw.selectedNodeIds)
    ? raw.selectedNodeIds.filter((id): id is string => typeof id === 'string' && nodeIds.has(id))
    : []
  const parsedGroups = Array.isArray(raw.groups)
    ? raw.groups.flatMap((group): NodeGroup[] => {
        const parsed = nodeGroupSchema.safeParse(group)
        if (!parsed.success) return []
        return [{
          ...parsed.data,
          nodeIds: Array.from(new Set(parsed.data.nodeIds.filter((id) => nodeIds.has(id)))),
        }]
      })
    : []
  // 旧组原地升级（2026-09-06 框工具第一档）：2026-09-06 之前建的组没有 `frameBounds`——
  // 那时框是成员包围盒算出来的一层皮，字段没人写也没人读。现在框的边界是真相之一，
  // 缺这个字段的组要按它**当时画布上本来就长的那个样子**补一次（同一份算式，见
  // model/canvasFrameBounds），否则升级当天所有旧组会集体跳一下。
  // 幂等：已有 bounds 的原样返回；成员一个都取不到的空组不硬造。补出的值随下次持久化落盘。
  const nodeRectById = new Map(nodes.map((node) => {
    const size = resolveNodeVisualSize(node)
    return [node.id, { x: node.position.x, y: node.position.y, width: size.width, height: size.height }] as const
  }))
  const groups = backfillGroupFrameBounds(parsedGroups, (nodeId) => nodeRectById.get(nodeId) ?? null)
  const workflowTemplates = Array.isArray(raw.workflowTemplates)
    ? raw.workflowTemplates.filter(isCanvasWorkflowTemplate)
    : []
  return {
    nodes: convergeDeconstructionNodes(backfillShotIndexes(nodes).nodes),
    edges: normalizeParameterEdges(nodes, edges),
    groups,
    selectedNodeIds,
    workflowTemplates,
  }
}
