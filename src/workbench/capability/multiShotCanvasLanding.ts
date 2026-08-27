// P4 S5 — 多镜产物画布落地（渲染层落点，capabilityApplyHandler 只做 dispatch）。
//
// 三件事，全在这里，capabilityApplyHandler 保持精简：
//   1. production.materialize-shots：确认即落 + 打开项目补齐**共用**的一个家（P1）——把「锚 + 勾选镜」
//      落成占位节点 + 编组，整批一个 Cmd+Z（proposalTxn 式事务），组也打 materializationOperationId 幂等章。
//      幂等：同 op 已建的节点/组跳过（跑两次不重复，§3.4）；节点被删又补建=新节点（不复活由主进程 detach 记账把关）。
//   2. production.attach-shot-result：逐镜回填 result（一个填一个＝「逐个冒」）；**运行时断言 result.url 必须
//      nomi-local://**（providerUrl 另存原始 CDN；R17：grep 棘轮抓不住这类，断言写在这里）。节点已删=静默跳过。
//   3. production.detach-canvas-nodes 的渲染半：见 registerCanvasDetachReporter（撤销/删节点 → 通知主进程记账）。
//
// ctx 纪律：canvasGestureContext 只包同步段（禁跨 await，见其头注释）——本模块每个 store 写入各自 inLandingTxn 包一次。
import i18n from '../../i18n'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { applyCanvasToolCall, resolveCanvasToolNodeId } from '../generationCanvas/agent/applyCanvasToolCall'
import { withCanvasGestureContext } from '../generationCanvas/events/canvasGestureContext'
import { pushUndoSnapshot } from '../generationCanvas/events/canvasUndoJournal'
import { interruptPendingCanvasWrite } from '../generationCanvas/events/canvasWriteBoundary'
import { CATEGORY_IDS, type BuiltinCanvasCategoryId, type GenerationNodeKind, type GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'

/** 一镜/一锚要落的占位节点（主进程从 Run 的 generationPlan.shots 投影而来）。clientId = shotId（稳定寻址）。 */
export type MaterializeShotInput = {
  shotId: string
  /** anchor=定妆/场景参考（落 cast/scene）；shot=视频镜头（落 shots）。 */
  role?: 'anchor' | 'shot'
  kind?: GenerationNodeKind
  title?: string
  prompt?: string
  /** 已完成镜的结果（打开项目补齐时一并回填；确认即落时为空）。 */
  result?: GenerationNodeResult
}

export type MaterializeShotsPayload = {
  projectId?: string
  runId?: string
  materializationOperationId?: string
  groupName?: string
  shots?: MaterializeShotInput[]
}

export type MaterializeShotsResult = {
  /** shotId → 真实节点 id（主进程据此 plan.bind-shot-nodes 写回 job/shot）。 */
  bindings: Array<{ shotId: string; nodeId: string; provider: string; model: string }>
  createdNodeIds: string[]
  groupId: string | null
}

const OPERATION_ID_RE = /^[A-Za-z0-9._:-]{1,240}$/

function sanitizeOperationId(value: unknown): string | undefined {
  return typeof value === 'string' && OPERATION_ID_RE.test(value) ? value : undefined
}

/**
 * 确认即落 / 打开项目补齐的**唯一落点**（P1 一个家）。整批一个撤销步：N 节点 + 组 = 一个 Cmd+Z。
 * 幂等：materializationOperationId + clientId(=shotId) 双章去重，已建的跳过、只补缺失的；组按 op 章复用不重建。
 * 抛错 = 落地失败（调用方主进程 catch → 只记 warn，不阻断生成，§1 铁律）。
 */
export async function materializeShots(payload: MaterializeShotsPayload): Promise<MaterializeShotsResult> {
  const materializationOperationId = sanitizeOperationId(payload.materializationOperationId)
  const incoming = Array.isArray(payload.shots) ? payload.shots.filter((shot) => shot && typeof shot.shotId === 'string' && shot.shotId.trim()) : []
  if (!materializationOperationId || incoming.length === 0) return { bindings: [], createdNodeIds: [], groupId: null }

  interruptPendingCanvasWrite()
  const store = useGenerationCanvasStore.getState()
  // 已建的（本 op 章 + clientId）→ shotId → 节点 id。补齐时据此只补缺失、幂等回填 result。
  const existingByShot = new Map<string, string>()
  for (const node of store.nodes) {
    const meta = node.meta as Record<string, unknown> | undefined
    if (meta?.materializationOperationId !== materializationOperationId) continue
    const clientId = typeof meta.materializationClientId === 'string' ? meta.materializationClientId.trim() : ''
    if (clientId) existingByShot.set(clientId, node.id)
  }

  // 分锚/镜：参考行（锚）在上、镜头折行网格（复用 storyboard 布局的 anchorCount 约定）。构造序=先锚后镜。
  const ordered = [...incoming].sort((a, b) => Number(a.role !== 'anchor') - Number(b.role !== 'anchor'))
  // 全部落进同一分类（分镜组），锚按 kind、镜落 shots。跨分类混编时以「镜头组」为主分类。
  const groupCategoryId: BuiltinCanvasCategoryId = 'shots'

  // 只建缺失的节点（幂等）。已建的直接进 bindings（补齐时回填 result 见下）。
  const missing = ordered.filter((shot) => !existingByShot.has(shot.shotId))
  const clientIdToNodeId: Record<string, string> = Object.fromEntries(existingByShot.entries())
  const createdNodeIds: string[] = []

  // 事务边界（proposalTxn 同款）：在 ctx 外**先打一个** barrier（不被抑制），整批 N 节点 + 边 + 组全部
  // 挂同一 txn 且 suppressUndoBarriers=true（它们各自的 pushUndoSnapshot 被抑制）→ 一次 Cmd+Z 撤整批。
  // create_canvas_nodes 一次建 N 个节点（内部 N 次 addNode），若不整体抑制会打 N 个 barrier（撤一次只退一个）。
  const txnId = `txn_materialize_shots_${materializationOperationId}`
  const ctx = { source: 'runtime' as const, txnId, suppressUndoBarriers: true }
  const inLandingTxn = <T,>(fn: () => T): T => withCanvasGestureContext(ctx, fn)
  // 只在本次真会落东西时打 barrier（有缺失节点，或要新建分镜组）——纯回填/幂等空跑不该占一个撤销步。
  // 节点全落 groupCategoryId(shots) → ≥2 个就够建组（锚+镜同组，靠 referenceSheet 区分）。
  const groupExists = useGenerationCanvasStore.getState().groups.some((group) => group.materializationOperationId === materializationOperationId)
  const willCreateGroup = !groupExists && ordered.length >= 2
  if (missing.length > 0 || willCreateGroup) pushUndoSnapshot()

  if (missing.length > 0) {
    const missingAnchorCount = missing.filter((shot) => shot.role === 'anchor').length
    const args = {
      nodes: missing.map((shot) => {
        const kind: GenerationNodeKind = shot.kind || (shot.role === 'anchor' ? 'image' : 'video')
        return {
          clientId: shot.shotId,
          kind,
          title: (shot.title || '').trim() || i18n.t('generationCommon.production.canvasLanding.shotFallbackTitle', { shot: shot.shotId }),
          prompt: typeof shot.prompt === 'string' ? shot.prompt : '',
          // categoryId 由 groupCategoryId 统一定（create_canvas_nodes 忽略 per-node categoryId，按 groupCategoryId/kind 定）。
          ...(shot.role === 'anchor' ? { referenceSheet: true as const } : {}),
          // 幂等章 + 批次占位标记（三态占位组件据 productionRunId 找到对应 Run 的 job 派生态）。
          metadata: {
            materializationOperationId,
            materializationClientId: shot.shotId,
            ...(payload.runId ? { productionRunId: payload.runId } : {}),
            productionShotId: shot.shotId,
            ...(shot.role ? { productionShotRole: shot.role } : {}),
          },
        }
      }),
      edges: [] as Array<{ sourceClientId: string; targetClientId: string }>,
      // groupCategoryId=shots：锚 + 镜整批落同一分类（与 storyboardPlanToCreateNodesArgs 落地同规则，P1 不另立），
      // 参考边同屏可见；锚靠 referenceSheet 标记区分（不占镜号）。anchorCount → 布局「参考行在上 + 镜头折行网格」。
      groupCategoryId,
      anchorCount: missingAnchorCount,
    }
    const applied = await inLandingTxn(() => applyCanvasToolCall('create_canvas_nodes', args)) as {
      clientIdToNodeId?: Record<string, unknown>
      createdNodeIds?: unknown
    }
    const rawMap = applied?.clientIdToNodeId && typeof applied.clientIdToNodeId === 'object' && !Array.isArray(applied.clientIdToNodeId)
      ? applied.clientIdToNodeId as Record<string, unknown>
      : {}
    for (const shot of missing) {
      const mapped = rawMap[shot.shotId]
      const nodeId = typeof mapped === 'string' && mapped.trim() ? mapped : resolveCanvasToolNodeId(shot.shotId)
      if (nodeId) {
        clientIdToNodeId[shot.shotId] = nodeId
        createdNodeIds.push(nodeId)
      }
    }
  }

  // 编组（幂等章）：先按 op 章找已建的分镜组复用；没有才建。名字即时命名「分镜组·<计划名>」。
  const allNodeIds = ordered.map((shot) => clientIdToNodeId[shot.shotId]).filter((id): id is string => Boolean(id))
  const shotsCategoryNodeIds = allNodeIds.filter((nodeId) => {
    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    return node && (node.categoryId || 'shots') === groupCategoryId
  })
  let groupId: string | null = null
  const existingGroup = useGenerationCanvasStore.getState().groups.find((group) => group.materializationOperationId === materializationOperationId)
  if (existingGroup) {
    groupId = existingGroup.id
  } else if (shotsCategoryNodeIds.length >= 2) {
    const groupName = (payload.groupName || '').trim() || i18n.t('generationCommon.production.canvasLanding.groupFallbackName')
    const group = inLandingTxn(() => useGenerationCanvasStore.getState().createGroup(groupCategoryId, groupName, {
      materializationOperationId,
      nodeIds: shotsCategoryNodeIds,
    }))
    groupId = group?.id ?? null
  }

  // 补齐时回填已完成镜的 result（跑两次幂等：addNodeResult 覆盖同 result 无害）。挂同一 txn（ctx 抑制其 barrier）
  // → 回填的 result 与占位节点/组同属一个撤销步。addNodeResult 是同步的，ctx 不跨 await（符合纪律）。
  for (const shot of ordered) {
    const nodeId = clientIdToNodeId[shot.shotId]
    if (nodeId && shot.result) inLandingTxn(() => attachShotResult({ nodeId, shotId: shot.shotId, result: shot.result! }))
  }

  // 落完把整块揭进视口（同批量/切图的既有 fit 信号），否则多半一半落在视口外。
  useWorkbenchStore.getState().requestCanvasFit(groupCategoryId)

  const nodeById = new Map(useGenerationCanvasStore.getState().nodes.map((node) => [node.id, node]))
  const bindings = ordered
    .map((shot) => {
      const nodeId = clientIdToNodeId[shot.shotId]
      if (!nodeId) return null
      const meta = nodeById.get(nodeId)?.meta as Record<string, unknown> | undefined
      return {
        shotId: shot.shotId,
        nodeId,
        provider: typeof meta?.modelVendor === 'string' ? meta.modelVendor : typeof meta?.vendor === 'string' ? meta.vendor : '',
        model: typeof meta?.modelKey === 'string' ? meta.modelKey : '',
      }
    })
    .filter((binding): binding is NonNullable<typeof binding> => Boolean(binding))

  return { bindings, createdNodeIds, groupId }
}

export type AttachShotResultPayload = {
  projectId?: string
  runId?: string
  nodeId?: string
  shotId?: string
  result?: GenerationNodeResult
}

export type AttachShotResultOutcome = { attached: true; nodeId: string } | { skipped: 'node-removed' | 'no-result' }

/**
 * 逐镜回填一个 result（生成完成一个填一个＝「逐个冒」的节奏载体）。
 * **运行时断言：result.url 必须 nomi-local://**（本地优先铁律；providerUrl 另存原始 CDN）。R17 的 grep 棘轮
 * 抓不住「把 https CDN 塞进 node.result.url」这类运行期错误，故断言写在这条唯一回填入口里当场炸。
 * 节点已被用户删（整批撤销/手动删）→ 静默跳过（返回 skipped，主进程据此在任务中心明示「画布节点已移除」）。
 */
export function attachShotResult(payload: AttachShotResultPayload): AttachShotResultOutcome {
  const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId.trim() : ''
  const result = payload.result
  if (!nodeId || !result) return { skipped: 'no-result' }
  const url = typeof result.url === 'string' ? result.url : ''
  // 只对**有 url 的媒体结果**强制本地协议（文本结果无 url，直接放行）。
  if (url && !url.startsWith('nomi-local://')) {
    throw new Error(`production.attach-shot-result 拒绝非本地 result.url（必须 nomi-local://，原始 CDN 存 providerUrl）：${url.slice(0, 80)}`)
  }
  interruptPendingCanvasWrite()
  const exists = useGenerationCanvasStore.getState().nodes.some((node) => node.id === nodeId)
  if (!exists) return { skipped: 'node-removed' }
  useGenerationCanvasStore.getState().addNodeResult(nodeId, result)
  return { attached: true, nodeId }
}

/** capabilityApplyHandler 转来的 op 分发（保持 handler 精简）。返回未处理 → null 让 handler 继续 switch。 */
export async function handleMultiShotCanvasLandingOp(op: string, data: Record<string, unknown>): Promise<unknown | null> {
  switch (op) {
    case 'production.materialize-shots':
      return materializeShots(data as MaterializeShotsPayload)
    case 'production.attach-shot-result':
      return attachShotResult(data as AttachShotResultPayload)
    default:
      return null
  }
}

// P4 S5 词表小工具类不在此文件（CATEGORY_IDS 仅为 groupCategoryId 校验保留引用点）。
void CATEGORY_IDS
