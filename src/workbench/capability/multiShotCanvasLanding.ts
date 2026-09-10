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
import { listAvailableModelsForAgent } from '../generationCanvas/agent/availableModels'
import { buildModelEntryIndex, buildPlannedNodeMeta } from '../generationCanvas/agent/plannedNodeMeta'
import {
  materializedNodeIdsByClientId,
  sanitizeMaterializationOperationId,
} from '../generationCanvas/agent/materializationStamp'
import { CANDIDATE_META_KEYS } from '../generationCanvas/agent/candidateNodeMeta'
import { withCanvasGestureContext } from '../generationCanvas/events/canvasGestureContext'
import { pushUndoSnapshot } from '../generationCanvas/events/canvasUndoJournal'
import { interruptPendingCanvasWrite } from '../generationCanvas/events/canvasWriteBoundary'
import { CATEGORY_IDS, type BuiltinCanvasCategoryId, type GenerationNodeKind, type GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import { persistActiveWorkbenchProjectNow } from '../project/workbenchProjectSession'

/**
 * 这一镜候选的模型身份（主进程 MaterializeShotCandidateWire 的渲染半）。
 * **它在则节点模型以它为准**——渲染层不再另挑默认模型（那是「agent 说的模型 ≠ 节点上的模型」的直接原因）。
 */
export type MaterializeShotCandidate = {
  candidateId: string
  /** PlanCandidate.revision：只有它比节点上记着的更新，才重绑定 prompt/模型。 */
  revision: number
  vendor?: string
  modelKey?: string
  modeId?: string
  mode?: string
}

/** 一镜/一锚要落的占位节点（主进程从 Run 的 generationPlan.shots 投影而来）。clientId = shotId（稳定寻址）。 */
export type MaterializeShotInput = {
  shotId: string
  /** anchor=定妆/场景参考（落 cast/scene）；shot=视频镜头（落 shots）。 */
  role?: 'anchor' | 'shot'
  kind?: GenerationNodeKind
  title?: string
  prompt?: string
  candidate?: MaterializeShotCandidate
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

/** 候选身份写进节点入参（create_canvas_nodes 认 modelKey/vendor/modeId，由 buildPlannedNodeMeta 解析成 meta）。 */
function candidateNodeArgs(candidate: MaterializeShotCandidate | undefined): Record<string, unknown> {
  if (!candidate?.modelKey) return {}
  return {
    modelKey: candidate.modelKey,
    ...(candidate.vendor ? { vendor: candidate.vendor } : {}),
    ...(candidate.modeId ? { modeId: candidate.modeId } : {}),
  }
}

/** 候选来源戳：节点从此**知道自己是谁的意图**（自愈 effect 据此不静默改写；重绑定据 revision 判断）。 */
function candidateStamp(candidate: MaterializeShotCandidate | undefined): Record<string, unknown> {
  if (!candidate) return {}
  return {
    [CANDIDATE_META_KEYS.candidateId]: candidate.candidateId,
    [CANDIDATE_META_KEYS.candidateRevision]: candidate.revision,
    ...(candidate.modelKey ? { [CANDIDATE_META_KEYS.candidateModelKey]: candidate.modelKey } : {}),
    ...(candidate.vendor ? { [CANDIDATE_META_KEYS.candidateModelVendor]: candidate.vendor } : {}),
  }
}

/** 节点上记着的候选 revision（没有 = 从没被候选绑定过，按「首次落地」处理）。 */
function nodeCandidateRevision(meta: Record<string, unknown> | undefined): number | null {
  const value = meta?.[CANDIDATE_META_KEYS.candidateRevision]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 把新候选重绑定到**已经落在画布上**的节点：prompt、标题、模型身份、以及新的候选 revision 戳。
 *
 * 模型 meta 走 `buildPlannedNodeMeta`（全仓「计划模型 → 节点 meta」的唯一 owner），不在这里另写一套：
 * 它负责按 `(vendor, modelKey)` 认身份、铺档案默认参数、丢掉非法值。候选的模型此刻不可用时它返回
 * undefined —— 那就只更新 prompt 与戳，**不去猜一个别的模型**（戳仍记着 agent 要的是哪个，
 * 由节点控件那边向用户明说）。
 */
async function rebindLandedShots(
  shots: readonly MaterializeShotInput[],
  nodeIdByShot: ReadonlyMap<string, string>,
  inLandingTxn: <T>(fn: () => T) => T,
): Promise<void> {
  const needsModels = shots.some((shot) => Boolean(shot.candidate?.modelKey))
  const entryByKey = buildModelEntryIndex(needsModels ? await listAvailableModelsForAgent() : [])
  for (const shot of shots) {
    const nodeId = nodeIdByShot.get(shot.shotId)
    if (!nodeId) continue
    const store = useGenerationCanvasStore.getState()
    const node = store.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) continue
    const currentMeta = (node.meta as Record<string, unknown> | undefined) ?? {}
    const modelMeta = shot.candidate?.modelKey
      ? buildPlannedNodeMeta(
          {
            modelKey: shot.candidate.modelKey,
            ...(shot.candidate.vendor ? { vendor: shot.candidate.vendor } : {}),
            ...(shot.candidate.modeId ? { modeId: shot.candidate.modeId } : {}),
          },
          entryByKey,
        )
      : undefined
    const title = (shot.title || '').trim()
    inLandingTxn(() => useGenerationCanvasStore.getState().updateNode(nodeId, {
      ...(typeof shot.prompt === 'string' ? { prompt: shot.prompt } : {}),
      ...(title ? { title } : {}),
      meta: { ...currentMeta, ...(modelMeta ?? {}), ...candidateStamp(shot.candidate) },
    }))
  }
}

/**
 * 确认即落 / 打开项目补齐的**唯一落点**（P1 一个家）。整批一个撤销步：N 节点 + 组 = 一个 Cmd+Z。
 * 幂等：materializationOperationId + clientId(=shotId) 双章去重，已建的跳过、只补缺失的；组按 op 章复用不重建。
 * 抛错 = 落地失败（调用方主进程 catch → 只记 warn，不阻断生成，§1 铁律）。
 */
export async function materializeShots(payload: MaterializeShotsPayload): Promise<MaterializeShotsResult> {
  const materializationOperationId = sanitizeMaterializationOperationId(payload.materializationOperationId)
  const incoming = Array.isArray(payload.shots) ? payload.shots.filter((shot) => shot && typeof shot.shotId === 'string' && shot.shotId.trim()) : []
  if (!materializationOperationId || incoming.length === 0) return { bindings: [], createdNodeIds: [], groupId: null }

  interruptPendingCanvasWrite()
  // 本 op 章已经落过的 shotId → 节点 id。**只用来决定撤销步与重绑定**：
  // 「这次要不要真建节点」的判据不在这里，在写边界 applyCanvasToolCall（P1 一个 owner）。
  const existingByShot = materializedNodeIdsByClientId(
    useGenerationCanvasStore.getState().nodes,
    materializationOperationId,
  )

  // 分锚/镜：参考行（锚）在上、镜头折行网格（复用 storyboard 布局的 anchorCount 约定）。构造序=先锚后镜。
  const ordered = [...incoming].sort((a, b) => Number(a.role !== 'anchor') - Number(b.role !== 'anchor'))
  // 全部落进同一分类（分镜组），锚按 kind、镜落 shots。跨分类混编时以「镜头组」为主分类。
  const groupCategoryId: BuiltinCanvasCategoryId = 'shots'

  const clientIdToNodeId: Record<string, string> = Object.fromEntries(existingByShot.entries())
  const createdNodeIds: string[] = []
  const missing = ordered.filter((shot) => !existingByShot.has(shot.shotId))
  // 已落的节点里，候选意图**变新了**的那些（generation.patch 之后）。revision 没变就一个字不动——
  // 这条闸是「打开项目补齐」这类幂等重放不会覆盖用户手改的原因。
  const rebindable = ordered.filter((shot) => {
    const nodeId = existingByShot.get(shot.shotId)
    if (!nodeId || !shot.candidate) return false
    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    const stored = nodeCandidateRevision(node?.meta as Record<string, unknown> | undefined)
    return stored === null || shot.candidate.revision > stored
  })

  // 事务边界（proposalTxn 同款）：在 ctx 外**先打一个** barrier（不被抑制），整批 N 节点 + 边 + 组全部
  // 挂同一 txn 且 suppressUndoBarriers=true（它们各自的 pushUndoSnapshot 被抑制）→ 一次 Cmd+Z 撤整批。
  // create_canvas_nodes 一次建 N 个节点（内部 N 次 addNode），若不整体抑制会打 N 个 barrier（撤一次只退一个）。
  const txnId = `txn_materialize_shots_${materializationOperationId}`
  const ctx = { source: 'runtime' as const, txnId, suppressUndoBarriers: true }
  const inLandingTxn = <T,>(fn: () => T): T => withCanvasGestureContext(ctx, fn)
  // 只在本次真会落东西时打 barrier（有缺失节点 / 有要重绑定的 / 要新建分镜组）——纯回填/幂等空跑不该占一个撤销步。
  // 节点全落 groupCategoryId(shots) → ≥2 个就够建组（锚+镜同组，靠 referenceSheet 区分）。
  const groupExists = useGenerationCanvasStore.getState().groups.some((group) => group.materializationOperationId === materializationOperationId)
  const willCreateGroup = !groupExists && ordered.length >= 2
  // 「这次落地结构性地改了画布吗」——一个判据两处用：打不打撤销步、要不要立刻落盘（见末尾 flush 注释）。
  // 回填已完成镜的 result **不算**：那是「打开项目补齐」每次都会做的幂等重放，把它算进来等于每开一次
  // 项目就白推高一次 revision（projectPersistenceService 头注释里那条「漂到 706」的自激振荡）。
  const changedCanvasStructure = missing.length > 0 || rebindable.length > 0 || willCreateGroup
  if (changedCanvasStructure) pushUndoSnapshot()

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
          // 候选的模型身份：节点模型以它为准（写边界 buildPlannedNodeMeta 负责校验+补全档案参数）。
          ...candidateNodeArgs(shot.candidate),
          // categoryId 由 groupCategoryId 统一定（create_canvas_nodes 忽略 per-node categoryId，按 groupCategoryId/kind 定）。
          ...(shot.role === 'anchor' ? { referenceSheet: true as const } : {}),
          // 幂等章 + 批次占位标记（三态占位组件据 productionRunId 找到对应 Run 的 job 派生态）+ 候选来源戳。
          metadata: {
            materializationOperationId,
            materializationClientId: shot.shotId,
            ...(payload.runId ? { productionRunId: payload.runId } : {}),
            productionShotId: shot.shotId,
            ...(shot.role ? { productionShotRole: shot.role } : {}),
            ...candidateStamp(shot.candidate),
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

  // generation.patch 之后：把已落节点的 prompt / 模型同步到新候选。**草稿只有一个账本**——
  // 候选是意图，节点是它的投影，改了意图就该在用户眼前变，而不是等下次重开项目。
  if (rebindable.length > 0) await rebindLandedShots(rebindable, existingByShot, inLandingTxn)

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

  // 真写了画布就**立刻落盘**，不交给 700ms 防抖。
  // 为什么：这次写会让 project.revision 前进，而付费授权信封盖的就是 project.revision
  // （收据只在它描述的那份项目文档还是当前版本时有效）。交给防抖 = 这次前进可能落在「封信封」与
  // 「用户点确认」之间，用户的批准被 Nomi 自己的投影作废，报「此确认已失效」。
  // 主进程侧的 settleCanvasLanding 等的就是这条 await——它必须在 revision 定下来之后才 resolve。
  // 落盘 owner 只此一个（canonicalCanvasPlanPatch 走的同一个 persistActiveWorkbenchProjectNow，P1）；
  // 幂等空跑绝不落盘，否则重开项目补齐会白白推高 revision。
  if (changedCanvasStructure) await persistActiveWorkbenchProjectNow().catch(() => {})

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
