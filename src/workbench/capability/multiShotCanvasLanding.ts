// P4 S5 — 多镜产物画布落地（渲染层落点，capabilityApplyHandler 只做 dispatch）。
//
// 这里只管一件事，capabilityApplyHandler 保持精简：
//   production.materialize-shots：确认即落 + 打开项目补齐 + Run 每次变化后的跟随**共用**的一个家（P1）——
//      把「锚 + 勾选镜」落成占位节点 + 编组，整批一个 Cmd+Z（proposalTxn 式事务），组也打 materializationOperationId 幂等章。
//      幂等：同 op 已建的节点/组跳过（跑两次不重复，§3.4）；节点被删又补建=新节点（不复活由主进程 detach 记账把关）。
//      每一镜再带两样之一：`result`（出片了：回填，**运行时断言 result.url 必须 nomi-local://**）或
//      `generation`（没出片：这一镜此刻在节点上该挂的运行状态）。**两样都写进节点自己的运行记录**——
//      与普通生成同一份状态，于是同一个 NodeGeneratingOverlay / NodeErrorReport 画它，不再有第二套画法。
//      （以前「出片」走一条单独的 attach-shot-result、「生成中」由渲染层轮询 Run 另画一套，2026-09-25 合成这一条。）
// 反方向（用户删了占位节点 / 整批 ⌘Z → 让 Run 记 detached）不在这里：它住 src/workbench/production/watchDeletedProductionNodes.ts，
// 由 ProductionCanvasLandingHost 挂载，经渲染层唯一的制作命令口发 plan.detach-shot-nodes。
//
// ctx 纪律：canvasGestureContext 只包同步段（禁跨 await，见其头注释）——本模块每个 store 写入各自 inLandingTxn 包一次。
import { withProjectAction, whenProjectAdopted, isProjectExecutionContextCurrent } from '../project/projectCanvasReadSurface'
import i18n from '../../i18n'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { applyCanvasToolCall, resolveCanvasToolNodeId } from '../generationCanvas/agent/applyCanvasToolCall'
import { listAvailableModelsForAgent } from '../generationCanvas/agent/availableModels'
import { getVendorPreference } from '../api/vendorPreferenceApi'
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
import { isProductionRunRecord } from '../../../electron/shared/productionShotPhase'
import type { MediaDimensions } from '../generationCanvas/nodes/nodeSizing'
import type { HeldNodeOutcome } from '../generationCanvas/store/nodeRunOutcome'
import { findAnchorNode, findShotNode } from '../creation/storyboard/exec/storyboardNodeBinding'
import { stableShotId, type PlanAnchor, type PlanShot } from '../generationCanvas/agent/storyboardPlan'

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
  /** 候选选中的标量参数。节点是候选的投影，参数是投影的一部分——漏掉它节点就会回落档案默认。 */
  parameters?: Record<string, string | number | boolean>
}

/**
 * 没出片的一镜此刻在节点上该挂的运行状态（主进程 `MaterializeShotGenerationWire` 的渲染半，判定在主进程那一份）。
 * `runRecordId` = 节点运行记录的身份（取自那次任务），同一任务反复投影幂等。
 */
export type MaterializeShotGeneration =
  | { state: 'running'; runRecordId: string; startedAt: number }
  | { state: 'failed'; runRecordId: string; startedAt: number; message?: string }
  // 已经生成、结果没能取回（#975 V-975）：节点挂「可找回」——分镜表同一份状态词（recoverable），不进任何批量生成。
  | { state: 'recoverable'; runRecordId: string; startedAt: number; message?: string }
  | { state: 'ended' }


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
  mediaDimensions?: MediaDimensions
  /** 没有 result 时：这一镜在节点上的运行状态。 */
  generation?: MaterializeShotGeneration
  /**
   * Run 里这一镜记着 detached：只许动画布上已有的节点，绝不新建（主进程 MaterializeShotWire.existingOnly）。
   * 节点还在就照常回填并回报绑定——画布文档才是「节点在不在」的 owner，主进程据绑定纠正那条记录。
   */
  existingOnly?: boolean
  /**
   * Run 里这一镜绑着的节点（主进程 MaterializeShotWire.nodeId）。节点此刻不在画布上（删了、还没撤销）时，这一镜到达的结局
   * 按这个 nodeId 暂存，撤销 / 放回把节点带回来时落上——与普通画布同一个语义（架构③ 合同 3），不再静默跳过。
   */
  nodeId?: string
}

export type MaterializeShotsPayload = {
  /** Document authoring never recreates nodes during save/open/reconciliation. */
  existingOnly?: boolean
  projectId?: string
  runId?: string
  materializationOperationId?: string
  /** 计划名：分镜组名 = 它加「分镜组·」前缀（走 i18n）。缺省 = 通用兜底。 */
  planName?: string
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
    // 候选选的参数要跟着身份一起过来：`buildPlannedNodeMeta` 铺的是档案**默认值**，
    // 不喂它真实选择，新建出来的节点就会显示一份没人选过的参数（而卡上印的价格是按真实选择算的）。
    ...(candidate.parameters ? { params: candidate.parameters } : {}),
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
  const entryByKey = needsModels
    ? buildModelEntryIndex(await listAvailableModelsForAgent(), (await getVendorPreference()).orderedVendorKeys)
    : buildModelEntryIndex([])
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
            // 同上：重绑定必须带上候选真正选的参数，否则每一次重绑定都把用户挑过的值
            // 按回档案默认（2026-09-11 付费卡上改尺寸「改完又弹回去」就是这条漏掉的后果）。
            ...(shot.candidate.parameters ? { params: shot.candidate.parameters } : {}),
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
 * 文稿方案的镜头已经经分镜行落在画布上的那些节点（shotId → 节点 id）。只认本 op 章还没认领的镜；
 * 方案 id 就是 Run id（草稿与方案同一套 id，见 generationDocumentPlan）。镜头 id 不是稳定 id 时不猜（照常新建）。
 */
function adoptStoryboardNodes(shots: readonly MaterializeShotInput[], runId: string | undefined, stamped: ReadonlyMap<string, string>): Map<string, string> {
  const adopted = new Map<string, string>()
  if (!runId) return adopted
  const nodes = useGenerationCanvasStore.getState().nodes
  for (const shot of shots) {
    if (stamped.has(shot.shotId)) continue
    const node = shot.role === 'anchor'
      ? findAnchorNode(nodes, runId, { id: shot.shotId, name: '' } as PlanAnchor)
      : stableShotId({ shotId: shot.shotId, index: -1 }) === shot.shotId ? findShotNode(nodes, runId, { shotId: shot.shotId, index: -1 } as PlanShot) : null
    if (node) adopted.set(shot.shotId, node.id)
  }
  return adopted
}

/** 主进程按项目寻址的落地，最多等这个窗口认下那个项目多久（主进程那头的 RPC 期限是 60s）。 */
const PROJECT_ADOPTION_WAIT_MS = 30_000

/**
 * 确认即落 / 打开项目补齐的**唯一落点**（P1 一个家）。整批一个撤销步：N 节点 + 组 = 一个 Cmd+Z。
 * 幂等：materializationOperationId + clientId(=shotId) 双章去重，已建的跳过、只补缺失的；组按 op 章复用不重建。
 * 抛错 = 落地失败（调用方主进程 catch → 只记 warn，不阻断生成，§1 铁律）。
 */
export async function materializeShots(payload: MaterializeShotsPayload): Promise<MaterializeShotsResult> {
  const materializationOperationId = sanitizeMaterializationOperationId(payload.materializationOperationId)
  const incoming = Array.isArray(payload.shots) ? payload.shots.filter((shot) => shot && typeof shot.shotId === 'string' && shot.shotId.trim()) : []
  if (!materializationOperationId || incoming.length === 0) return { bindings: [], createdNodeIds: [], groupId: null }

  // Renderer projection belongs to this project lifetime, not whichever canvas is focused
  // after a model/tool/persistence await. Main-process paid execution continues independently.
  // A landing main addressed to a project may arrive while this window is still adopting it
  // (open-project reconciliation fires on main's commit, before our commit reply): wait for the
  // adoption instead of failing, then require it to be the addressed project.
  const adoption = payload.projectId
    ? whenProjectAdopted(PROJECT_ADOPTION_WAIT_MS)
    : Promise.resolve(withProjectAction(current => current))
  const project = await adoption
  if (!project) throw new Error('storyboard_project_unavailable')
  if (payload.projectId && payload.projectId !== project.binding.projectId) throw new Error('storyboard_project_changed')
  project.assertCurrent()
  interruptPendingCanvasWrite()
  // 本 op 章已经落过的 shotId → 节点 id。**只用来决定撤销步与重绑定**：
  // 「这次要不要真建节点」的判据不在这里，在写边界 applyCanvasToolCall（P1 一个 owner）。
  const stampedByShot = materializedNodeIdsByClientId(
    useGenerationCanvasStore.getState().nodes,
    materializationOperationId,
  )
  // 按镜头身份去重：文稿方案的那一镜如果用户已经经分镜行「放到画布」落过节点（方案 id = 这个 Run 的 id，
  // 节点身份 = storyboardDesignId × shotId / anchorId，唯一判据在 storyboardNodeBinding），就认那个节点、
  // 把它绑到 Run 上——不再落第二份。认来的节点不重绑定候选、不拉进分镜组（它归分镜行管）。
  const adoptedByShot = adoptStoryboardNodes(incoming, payload.runId, stampedByShot)
  const existingByShot = new Map([...stampedByShot, ...adoptedByShot])

  // 分锚/镜：参考行（锚）在上、镜头折行网格（复用 storyboard 布局的 anchorCount 约定）。构造序=先锚后镜。
  const existingOnly = (shot: MaterializeShotInput): boolean => payload.existingOnly === true || shot.existingOnly === true
  const ordered = incoming.filter(shot => !existingOnly(shot) || existingByShot.has(shot.shotId)).sort((a, b) => Number(a.role !== 'anchor') - Number(b.role !== 'anchor'))
  // 全部落进同一分类（分镜组），锚按 kind、镜落 shots。跨分类混编时以「镜头组」为主分类。
  const groupCategoryId: BuiltinCanvasCategoryId = 'shots'

  const clientIdToNodeId: Record<string, string> = Object.fromEntries(existingByShot.entries())
  const createdNodeIds: string[] = []
  const missing = ordered.filter((shot) => !existingByShot.has(shot.shotId))
  // 已落的节点里，候选意图**变新了**的那些（generation.patch 之后）。revision 没变就一个字不动——
  // 这条闸是「打开项目补齐」这类幂等重放不会覆盖用户手改的原因。
  const rebindable = ordered.filter((shot) => {
    const nodeId = existingByShot.get(shot.shotId)
    if (existingOnly(shot) || !nodeId || !shot.candidate || adoptedByShot.has(shot.shotId)) return false
    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    const stored = nodeCandidateRevision(node?.meta as Record<string, unknown> | undefined)
    return stored === null || shot.candidate.revision > stored
  })

  // 事务边界（proposalTxn 同款）：在 ctx 外**先打一个** barrier（不被抑制），整批 N 节点 + 边 + 组全部
  // 挂同一 txn 且 suppressUndoBarriers=true（它们各自的 pushUndoSnapshot 被抑制）→ 一次 Cmd+Z 撤整批。
  // create_canvas_nodes 一次建 N 个节点（内部 N 次 addNode），若不整体抑制会打 N 个 barrier（撤一次只退一个）。
  const txnId = `txn_materialize_shots_${materializationOperationId}`
  const ctx = { source: 'runtime' as const, txnId, suppressUndoBarriers: true }
  const inLandingTxn = <T,>(fn: () => T): T => {
    project.assertCurrent()
    return withCanvasGestureContext(ctx, fn)
  }
  // 只在本次真会落东西时打 barrier（有缺失节点 / 有要重绑定的 / 要新建分镜组）——纯回填/幂等空跑不该占一个撤销步。
  // 节点全落 groupCategoryId(shots) → ≥2 个就够建组（锚+镜同组，靠 referenceSheet 区分）。
  const groupExists = useGenerationCanvasStore.getState().groups.some((group) => group.materializationOperationId === materializationOperationId)
  const willCreateGroup = !payload.existingOnly && !groupExists && ordered.filter((shot) => !adoptedByShot.has(shot.shotId)).length >= 2
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
          // 没标题时说「镜头 N」（N = 这一批里的顺序），**不**回退成 shotId：shotId 是候选/事务的内部标识
          // （`cand-op-…`），印成节点标题用户读不懂，也不是他起的名字。
          title: (shot.title || '').trim() || i18n.t('generationCommon.production.canvasLanding.shotFallbackTitle', { shot: ordered.indexOf(shot) + 1 }),
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
    const applied = await applyCanvasToolCall('create_canvas_nodes', args, ctx,
      () => isProjectExecutionContextCurrent(project), undefined, undefined, async () => project.assertCurrent()) as {
      clientIdToNodeId?: Record<string, unknown>
      createdNodeIds?: unknown
    }
    project.assertCurrent()
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
  project.assertCurrent()

  // 编组（幂等章）：先按 op 章找已建的分镜组复用；没有才建。名字即时命名「分镜组·<计划名>」。
  const allNodeIds = ordered.filter((shot) => !adoptedByShot.has(shot.shotId)).map((shot) => clientIdToNodeId[shot.shotId]).filter((id): id is string => Boolean(id))
  const shotsCategoryNodeIds = allNodeIds.filter((nodeId) => {
    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    return node && (node.categoryId || 'shots') === groupCategoryId
  })
  let groupId: string | null = null
  const existingGroup = useGenerationCanvasStore.getState().groups.find((group) => group.materializationOperationId === materializationOperationId)
  if (existingGroup) {
    groupId = existingGroup.id
  } else if (!payload.existingOnly && shotsCategoryNodeIds.length >= 2) {
    const planName = (payload.planName || '').trim()
    const groupName = planName
      ? i18n.t('generationCommon.production.canvasLanding.groupName', { name: planName })
      : i18n.t('generationCommon.production.canvasLanding.groupFallbackName')
    const group = inLandingTxn(() => useGenerationCanvasStore.getState().createGroup(groupCategoryId, groupName, {
      materializationOperationId,
      nodeIds: shotsCategoryNodeIds,
    }))
    groupId = group?.id ?? null
  }

  // 每一镜的运行状态落进节点自己的运行记录：出片了回填 result，没出片挂上「生成中 / 失败 / 已结束」。
  // 挂同一 txn（ctx 抑制其 barrier）→ 与占位节点/组同属一个撤销步。都是同步写，ctx 不跨 await（符合纪律）。
  for (const shot of ordered) {
    const nodeId = clientIdToNodeId[shot.shotId]
    if (!nodeId) continue
    if (shot.result) inLandingTxn(() => attachShotResult({ nodeId, result: shot.result!, mediaDimensions: shot.mediaDimensions }))
    else if (shot.generation) inLandingTxn(() => applyShotGeneration(nodeId, shot.generation!))
  }

  // 绑着的节点此刻不在画布上（删了、还没撤销）：这一镜到达的结局按 nodeId 暂存，节点回来时由统一提交口落上
  // （与普通画布 runProjectDelivery 同一个暂存）。节点不复活——删除事实优先。
  const liveNodeIds = new Set(useGenerationCanvasStore.getState().nodes.map((node) => node.id))
  for (const shot of incoming) {
    const boundNodeId = typeof shot.nodeId === 'string' ? shot.nodeId.trim() : ''
    if (!boundNodeId || liveNodeIds.has(boundNodeId) || clientIdToNodeId[shot.shotId]) continue
    const held = heldOutcomeOf(shot)
    if (held) holdOnce(boundNodeId, held)
  }

  // 付费卡确认落地不再挪画布、不再切分类（2026-09-25 用户：「付费卡点击之后画布就闪动一下，然后我就找不到
  // 那个镜头生成去哪里了」——那一闪是单镜先聚焦放大、360ms 后再适应全图两次移动叠在一起）。
  // 新镜头落在可见区（落不下就在已有内容下方），屏外 / 别的分类由画布边缘提示指路，点它才过去。

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
  project.assertCurrent()
  if (changedCanvasStructure) await persistActiveWorkbenchProjectNow().catch(() => {})
  project.assertCurrent()

  return { bindings, createdNodeIds, groupId }
}

export type AttachShotResultPayload = {
  nodeId?: string
  result?: GenerationNodeResult
  mediaDimensions?: MediaDimensions
}

export type AttachShotResultOutcome = { attached: true; nodeId: string } | { skipped: 'node-removed' | 'no-result' | 'already-attached' }

/**
 * 回填一镜的 result（生成完成一个填一个＝「逐个冒」的节奏载体）。
 * **运行时断言：result.url 必须 nomi-local://**（本地优先铁律；providerUrl 另存原始 CDN）。R17 的 grep 棘轮
 * 抓不住「把 https CDN 塞进 node.result.url」这类运行期错误，故断言写在这条唯一回填入口里当场炸。
 * 节点已被用户删（整批撤销/手动删）→ 按 nodeId 暂存，撤销 / 放回时落上（与普通画布同一语义）。
 *
 * **同一份产物只回填一次**：Run 每变一次画布就跟一次，已经在节点结果或版本历史里的那一份（同 id 同地址）
 * 不再回填——否则用户切回旧版本 / 在这个节点上重新生成之后，下一次跟随会把制作那一版硬塞回当前结果。
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
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    // 节点在生成中被删了（钱已花）：结局按 nodeId 暂存，撤销把节点带回来时落上去（与普通画布同一语义）。
    holdOnce(nodeId, { kind: 'result', result, ...(payload.mediaDimensions ? { mediaDimensions: payload.mediaDimensions } : {}) })
    return { skipped: 'node-removed' }
  }
  const known = [node.result, ...(node.history ?? [])].some((entry) => entry?.id === result.id && entry.url === result.url)
  if (known) return { skipped: 'already-attached' }
  useGenerationCanvasStore.getState().addNodeResult(nodeId, result, payload.mediaDimensions)
  return { attached: true, nodeId }
}

/** 一镜带来的结局里，节点不在时值得暂存的那一份：出片了的结果，或确定的失败。生成中 / 已结束 / 可找回是瞬态，跟着下一次投影走。 */
function heldOutcomeOf(shot: MaterializeShotInput): HeldNodeOutcome | null {
  if (shot.result) return { kind: 'result', result: shot.result, ...(shot.mediaDimensions ? { mediaDimensions: shot.mediaDimensions } : {}) }
  if (shot.generation?.state === 'failed') return { kind: 'status', status: 'error', ...(shot.generation.message ? { error: shot.generation.message } : {}) }
  return null
}

/** Run 每变一次就投影一次：同一份结局只暂存一次（否则节点回来时同一张图会落成两个版本）。 */
function holdOnce(nodeId: string, outcome: HeldNodeOutcome): void {
  const store = useGenerationCanvasStore.getState()
  const already = (store.heldNodeOutcomes[nodeId] ?? []).some((held) => held.kind === outcome.kind
    && (outcome.kind === 'result' ? held.kind === 'result' && held.result.id === outcome.result.id && held.result.url === outcome.result.url : JSON.stringify(held) === JSON.stringify(outcome)))
  if (!already) store.holdRunOutcome(nodeId, outcome)
}

/**
 * 没出片的一镜：把它此刻的运行状态写进节点自己的运行记录（普通生成用的同一组 store 动作）。
 * - running：挂一条「生成中」记录 → 节点上就是普通生成那张等待画面（NodeGeneratingOverlay）；
 * - failed：记成失败 → 节点上就是普通生成那张失败卡（重试走返工链 useProductionNodeRetry）；
 * - ended：不在跑了 → 只收掉**本制作**挂上去的「生成中」，绝不动用户自己在这个节点上跑的那一次。
 * 全部幂等：同一条记录已经是这个状态就一个字不改（用户关掉的失败卡不会被下一次跟随重新弹出来）。
 */
function applyShotGeneration(nodeId: string, generation: MaterializeShotGeneration): void {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  const latest = node.runs?.[0]
  const latestIsOurs = isProductionRunRecord(latest)
  const latestInFlight = latest?.status === 'running' || latest?.status === 'queued'
  if (generation.state === 'ended') {
    if (latestIsOurs && latestInFlight) store.setNodeStatus(nodeId, 'idle')
    return
  }
  // 用户正在这个节点上自己跑一次（普通生成）：那一次说了算，不去盖它。
  if (latestInFlight && !latestIsOurs) return
  const existing = node.runs?.find((run) => run.id === generation.runRecordId)
  if (generation.state === 'running') {
    if (latest?.id === generation.runRecordId && latestInFlight) return
    // 这次任务已经有过结论（成功 / 失败）就不倒回去；被收掉的（重开项目时把幽灵转圈收成 cancelled）照常续上。
    if (existing && (existing.status === 'success' || existing.status === 'error')) return
    // 「重新取回」把这一镜放回了轮询：同一条记录从可找回翻回进行中，不另挂一条。
    if (existing?.status === 'recoverable') {
      store.trackNodeRun(nodeId, generation.runRecordId, { status: 'running' })
      return
    }
    store.appendNodeRun(nodeId, { id: generation.runRecordId, status: 'running', startedAt: generation.startedAt })
    return
  }
  const status = generation.state === 'recoverable' ? 'recoverable' : 'error'
  if (existing?.status === status) return
  if (existing) store.trackNodeRun(nodeId, generation.runRecordId, { status, ...(generation.message ? { error: generation.message } : {}) })
  else store.appendNodeRun(nodeId, { id: generation.runRecordId, status, startedAt: generation.startedAt, ...(generation.message ? { error: generation.message } : {}) })
}

/** capabilityApplyHandler 转来的 op 分发（保持 handler 精简）。返回未处理 → null 让 handler 继续 switch。 */
export async function handleMultiShotCanvasLandingOp(op: string, data: Record<string, unknown>): Promise<unknown | null> {
  switch (op) {
    case 'production.materialize-shots':
      return materializeShots(data as MaterializeShotsPayload)
    default:
      return null
  }
}

// P4 S5 词表小工具类不在此文件（CATEGORY_IDS 仅为 groupCategoryId 校验保留引用点）。
void CATEGORY_IDS
