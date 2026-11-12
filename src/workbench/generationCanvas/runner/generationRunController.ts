import { productionMetaOf } from '../model/productionMeta'
import { productionRunApi } from '../../production/productionRunApi'
import { reportCanvasFeedback } from '../components/canvasFeedback'
import { releaseUnknownSubmissionForNode, releaseUnknownCanvasSubmissionsForNode, synchronizeCanvasOpenRuns } from '../../production/releaseUnknownSubmission'
import { normalizeCanvasBatchConcurrency } from '../components/canvasProductionScope'
import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { getDesktopBridge } from '../../../desktop/bridge'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import type { GenerationRunOutcome, RunGenerationNodesBatchResult } from './generationRunOutcome'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { isNodeGenerationOwnedByProduction } from '../../production/productionShotOwnership'
import { directorPreviewSpendBlock, directorPreviewSpendBlockMessageKey } from '../nodes/director/model/directorPreviewState'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../project/projectCanvasReadSurface'
import { canvasOpenRuns, releaseCanvasShotRun, withdrawCanvasShots } from '../../api/taskApi'
import { confirmGenerationResend, confirmGenerationSpend, paidNodeLedger, spendCostKind, describeGenerationCost, generationCostContextForNode, type SpendInitiator } from '../spend/spendConfirm'
import { isRetryableGenerationError, normalizeRetryAttempts, normalizeBaseDelayMs, waitForRetry } from './generationRetryPolicy'
import { generationNodeExecutor, type GenerationNodeExecutor } from './generationNodeExecutor'
import type { GenerationNodeResults } from './catalogTaskResultParse'
import { classifyGenerationError, isOpenGenerationRefusal } from '../../observability/classifyError'
import { narrateProgress } from '../../observability/narrate'
import { LocalTaskCancelledError, clearTaskCancel, isTaskCancelRequested, isLocalTaskCancelledError } from './localTaskControl'
import { useNodeLivePreviewStore } from '../store/nodeLivePreviewStore'
import { createRunId } from '../store/canvasIds'
import { createRunOwnOutcomes, nextRunStartedAt } from './runOwnOutcomes'
import { captureApprovedGenerationInputs, isRunTargetLoaded, readRunGraph, whenRunTargetLoaded, type RunGraph, type RunProjectTarget } from './runProjectDelivery'
import { isRecoverableTimeoutError } from './recoverableTimeout'
import { retrievalRecoverableMessage } from './retrievalRecovery'
import { describeOpaqueFailure } from '../../observability/opaqueFailure'
import { recordNodeModelFailure, recordNodeModelSuccess } from './nodeModelHealth'
import {
  beginSingletonBatch,
  isEntryCancelled,
  useGenerationQueueStore,
  waitForQueueGate,
} from './generationQueueStore'
// 错误分类(classifyGenerationError)已抽到 observability/classifyError(人话叶子层,生成域+对话域共用);
// 这里 re-export 保持 NodeErrorReport / classifyGenerationError.test 等既有 import 不破。
export { classifyGenerationError, type GenerationErrorReport } from '../../observability/classifyError'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { stampUpstreamRefSnapshot } from './refSnapshotStamp'
import {
  effectiveArchetypeMode,
  sendArchetypeMode,
  hasAnyArchetypeReference,
} from '../nodes/controls/archetypeMeta'
import {
  nodeUnmetReferenceDependency,
  type UnmetReferenceDependency,
} from '../nodes/controls/referenceDependency'
import { dispatchedAttempt, resolveTaskArchetype } from './catalogTaskResolve'
import i18n from '../../../i18n'
import {
  AssetUploadConsentCancelledError,
  buildConsentNode,
  hostingDisclosureForResolution,
  hasLocalAssetReference,
  resolveAssetUploadConsent,
} from './assetUploadConsent'
import { buildDialoguePromptSuffix } from '../agent/storyboardDialogue'
import type { MediaDimensions } from '../nodes/nodeSizing'

function countsTowardGenerationBrake(kind: ReturnType<typeof classifyGenerationError>['kind']): boolean {
  return kind !== 'quota' && kind !== 'local-refusal'
}

/**
 * 公共临时托管的**已决**同意。注意它是 `RunGenerationNodeOptions` 里唯一必填的字段——
 * 这是故意的，也是 F16b 的根治手法。
 *
 * 为什么必填：旧版把它写成可选的 `assetUploadConsent?: 'allow'`，runner 里再用
 * 「没传就自己弹一张卡」兜底。结果是「忘了传」这件事完全没有信号——编译过、测试绿、
 * 只有真用户在 agent / MCP 路径上每次生成都被第二张卡拦一下。改成必填后，
 * 「谁来问用户」这个问题在**编译期**就必须被每个调用点回答，答不出就不给过。
 *
 * 只有两个合法答案，都必须来自 resolveAssetUploadConsent 的解析结果：
 * - `'allow'`     ：用户已在花钱确认卡上同意（或策略/KIE 判定无需再问）。
 * - `'not-needed'`：这次生成压根不碰公共托管（无本地素材 / 本地 ComfyUI 跑）。
 */
export type AssetUploadConsentDecision = 'allow' | 'not-needed'

/** Interactive validation is only for approval; author validation survives project switches. */
export type GenerationApprovalGuards =
  | { assertCurrent?: never; assertAuthorCurrent?: never }
  | { assertCurrent: () => Promise<void>; assertAuthorCurrent: (graph: RunGraph, executingNodeId: string) => Promise<void> }

export type GenerationConfirmationGuards = GenerationApprovalGuards & {
  /**
   * 谁发起的。**必填、没有缺省**：付费确认按它判（Agent 发起一律弹，spendConfirmationRequirement）。
   * 缺省成 'user' 就是 fail-open——下一个忘了报的新入口会被当成「用户点的便宜单张」静默花钱（R17：让编译器拦）。
   */
  initiator: SpendInitiator
  resend?: boolean
}

export type DeferredNodeMaterialization = {
  draftNode: GenerationCanvasNode
  materialize: () => Promise<string>
}

export type RunGenerationNodeOptions = {
  assertAuthorCurrent?: (graph: RunGraph, executingNodeId: string) => Promise<void>
  /** runId = 正在跑的这一次（运行自己报号，D9）。 */
  assertApprovedInputs?: (graph: RunGraph, executingNodeId: string, runId?: string) => void
  executor?: GenerationNodeExecutor
  retry?: {
    maxAttempts?: number
    baseDelayMs?: number
  }
  /** 'run' = 单镜 Run 路：这一次运行的批准、派发、记账都在主进程的单镜 Run 里（paidNodeLedger 定）。缺省 = 不花钱的本地 / 文本路。 */
  ledger?: 'run'
  initiator?: SpendInitiator
  acknowledgedOpenRuns?: string[]
  /** 批量卡上点确认时就定下的运行记录号（主进程已经为它开了出价）。缺省 = 这一次现起一个号（单节点 ↑）。 */
  runRecordId?: string
  /** One-shot correction appended to the provider prompt for a bounded QA retry. */
  promptSuffix?: string
  /** 队列批次 id（任务中心的调度真相源，见 generationQueueStore）。不传 = 单发，内部自建 1 节点批次。 */
  batchId?: string
  /**
   * 上游确认面已解析好的托管同意。**必填**，理由见 AssetUploadConsentDecision。
   * runner 不问用户——它只执行已经做出的决定。
   */
  assetUploadConsent: AssetUploadConsentDecision
  /** 这次运行所属的项目（提交那一刻签发的完整绑定）。**必填**：运行期间只认它，不重读当前项目。 */
  target: RunProjectTarget
  /**
   * 「这一镜归不归画布」主进程已经认过了（D2 第③步：Agent 付费卡把这几镜交给画布，同意绑在那一次交接上）。
   * 渲染层那份制作 Run 投影比账本晚一拍（交接刚记下、同意刚绑上），拿它再判一次会把刚交过来的镜拦回去；
   * 派发时主进程按绑着的那个画布 Run 再认一次（`decideShotClaim` 带 canvasRunId），这里只跳过渲染层自己的那一份预判，
   * 输入齐不齐（`generationNodeInputsReady`）照判。缺省 = 照常预判（节点 ↑、框选生成）。
   */
  claimAdmittedByHost?: true
}

async function resolveHostingDisclosure(node: GenerationCanvasNode | undefined) {
  return node ? hostingDisclosureForResolution(await resolveAssetUploadConsent(await buildConsentNode(node))) : { allowed: true }
}


type GenerationRunContext = {
  nodes?: GenerationCanvasNode[]
  edges?: GenerationCanvasEdge[]
}

// options 没有默认值：`= {}` 正是让调用点能省略托管同意的那个逃生口（F16b 根因）。
// 去掉它之后，「谁问的用户」在编译期就必须有答案。target 同理：运行属于哪个项目在提交那一刻就定死。
export async function runGenerationNode(
  nodeId: string,
  options: RunGenerationNodeOptions,
): Promise<GenerationNodeResult> {
  const id = String(nodeId || '').trim()
  if (!id) throw new Error('nodeId is required')
  const { target } = options

  // 读的是运行自己项目的图（在前台读 store，不在前台读盘），绝不读切换后新项目的图。
  const initialState = await readRunGraph(target)
  const initialNode = initialState?.nodes.find((node) => node.id === id)
  if (!initialState || !initialNode) throw new Error('node not found')
  // 3D-BOX 预演闸（方案 §8）：要花钱的单镜 Run 路由主进程准入问它（appIntegrationCanvasShot）；不花钱的本地 / 文本路在这里问。
  const previewBlock = options.ledger === 'run' ? null : directorPreviewSpendBlock(id, initialState.nodes)
  if (previewBlock) {
    throw new Error(i18n.t(directorPreviewSpendBlockMessageKey(previewBlock)))
  }
  const runnable = options.claimAdmittedByHost ? generationNodeInputsReady : canRunGenerationNode
  if (!runnable(initialNode, { nodes: initialState.nodes, edges: initialState.edges })) {
    throw new Error(
      initialNode.kind === 'video'
        ? '视频节点缺少上游真实图片或视频资产 URL。请先生成或选择首帧/参考图后再生成视频。'
        : getGenerationNodeExecutionKind(initialNode.kind) === 'model3d'
          ? i18n.t('generationCommon.composer.model3dReferenceRequired')
          : `暂不支持「${initialNode.kind}」类型节点的生成`,
    )
  }

  // 托管同意在**上游**就已经问完了（花钱确认卡里的披露块，或自主路径的
  // resolveAutonomousUploadConsent）。这一层不再问、也不再有能问的东西——它只把已决的答案
  // 往下透传给 executor。F16b 之前这里会自己弹第二张卡，那张卡现已删除，见 assetUploadConsent.ts。
  const resolvedReferences = resolveGenerationReferences(initialNode, { nodes: initialState.nodes, edges: initialState.edges })
  // 提交时打上游版本戳（refSnapshot）：参考图后来重生成 → diff 即知「这次产物用的是旧图」。
  whenRunTargetLoaded(target, () => stampUpstreamRefSnapshot(id, { nodes: initialState.nodes, edges: initialState.edges }))
  const hasLocalReference = hasLocalAssetReference({
    ...initialNode,
    references: [
      ...(initialNode.references || []),
      ...resolvedReferences.referenceImages,
      ...resolvedReferences.referenceVideos,
      ...resolvedReferences.referenceAudios,
      ...(resolvedReferences.firstFrameUrl ? [resolvedReferences.firstFrameUrl] : []),
      ...(resolvedReferences.lastFrameUrl ? [resolvedReferences.lastFrameUrl] : []),
      ...(resolvedReferences.relayFromVideoUrl ? [resolvedReferences.relayFromVideoUrl] : []),
    ],
  })

  // 队列登记：批量路径由 runGenerationNodesByPlan 预先整批登记（含后续波次），单发路径自建 1 节点批次。
  // markRunning 只把 queued 翻成 running（幂等），所以两条路都能安全调。
  const ownsBatch = !options.batchId
  const batchId = options.batchId ?? beginSingletonBatch(id, target.projectId)
  const queue = useGenerationQueueStore.getState()
  for (const entry of queue.entries) {
    if (entry.nodeId === id && entry.batchId !== batchId && entry.state === 'queued'
      && queue.batches[entry.batchId]?.projectId === target.projectId) queue.cancelEntry(entry.batchId, id)
  }
  queue.markRunning(batchId, id)

  const now = nextRunStartedAt()
  // 运行记录随原项目持久化（含 projectId）：找回/重启都只认它，不认「当时打开的是哪个」。
  // attempt = 这次发给哪家的哪个模型（提交那一刻从被执行的节点读出）：失败提示点名的是它，
  // 健康记账记到的也是它——不是「失败时节点碰巧选着谁」（运行期间用户可以换家）。
  // 花钱前的确认已冻结 (模型, 供应商)（captureApprovedGenerationInputs），重试循环里它不会中途变。
  const attempt = dispatchedAttempt(initialNode)
  const run = { id: options.runRecordId ?? createRunId(id), status: 'queued' as const, startedAt: now, updatedAt: now, projectId: target.projectId, ...(attempt ? { attempt } : {}) }
  let runFailure: unknown
  // 这次自己的结局（准入前只占显示、准入后按号收账）都经它投：runOwnOutcomes.ts。
  const own = createRunOwnOutcomes(target, id, run, options.ledger === 'run')
  const { reportProgress, deliverOwn: deliverOwnOutcome } = own
  try {
    await own.start()
    const executor = options.executor ?? generationNodeExecutor
    const maxAttempts = normalizeRetryAttempts(options.retry?.maxAttempts)
    const baseDelayMs = normalizeBaseDelayMs(options.retry?.baseDelayMs)
  let results: GenerationNodeResults | null = null
  let mediaDimensions: MediaDimensions | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const savedGraph = await readRunGraph(target)
      // Validation and disk reads may outlive deletion. Never resurrect the initial snapshot.
      let state = isRunTargetLoaded(target) ? useGenerationCanvasStore.getState() : savedGraph
      if (!state) throw new Error('node not found')
      if (options.assertAuthorCurrent) {
        await options.assertAuthorCurrent(state, id)
        state = await readRunGraph(target)
      }
      const node = state?.nodes.find((candidate) => candidate.id === id)
      if (!state || !node) throw new Error('node not found')
      options.assertApprovedInputs?.(state, id, run.id)
      const nodeMeta = (node.meta || {}) as Record<string, unknown>
      const dialogueArchetype = resolveTaskArchetype(nodeMeta)
      const dialogueMode = dialogueArchetype ? effectiveArchetypeMode(dialogueArchetype, node, state).mode : null
      const dialoguePromptSuffix = buildDialoguePromptSuffix(dialogueMode, nodeMeta, nodeMeta.dialogue)
      // Streaming output is not input to another attempt of the same text run.
      const executionNode = node.kind === 'text' ? { ...node, contentJson: initialNode.contentJson } : node
      try {
        results = await executor(executionNode, {
          nodes: state.nodes,
          edges: state.edges,
          projectTarget: target,
          ...(options.ledger === 'run' ? { canvasRun: { runRecordId: run.id, ...(options.initiator === 'user' && options.acknowledgedOpenRuns ? { acknowledgedOpenRuns: options.acknowledgedOpenRuns } : {}) } } : {}),
          ...(options.promptSuffix || dialoguePromptSuffix
            ? { promptSuffix: [options.promptSuffix, dialoguePromptSuffix].filter(Boolean).join('\n\n') }
            : {}),
          // 提交幂等键 = 本次 run.id：重试循环内每次 attempt 复用同一个 run.id，
          // electron 侧台账据此认作「同一次意图提交」→ 重试绝不二次下单。新生成 = 新 run.id。
          idempotencyKey: run.id,
          ...(hasLocalReference ? { anonymousAssetHostingConsent: 'allow' as const } : {}),
          // S2:catalog 任务各阶段回报 → 节点进度(人话已由 narrate 翻好)。
          onProgress: (progress) => {
            reportProgress({
              runId: run.id,
              phase: progress.phase,
              message: progress.message,
              ...(progress.taskId ? { taskId: progress.taskId } : {}),
            })
          },
          onMediaDimensions: (dimensions) => { mediaDimensions = dimensions },
        })
        break
      } catch (error: unknown) {
        if (attempt >= maxAttempts || !isRetryableGenerationError(error)) {
          throw error
        }
        reportProgress({
          runId: run.id,
          phase: 'retrying',
          // 文案走 narrate 注册表(S2 纪律:展示文案不许散落字面量)。
          message: narrateProgress('retrying', { attempt: attempt + 1, maxAttempts }),
        })
        await waitForRetry(attempt, baseDelayMs)
      }
    }
    const deliveryFailure = await own.drained()
    if (deliveryFailure) throw deliveryFailure
    if (!results) throw new Error(describeOpaqueFailure(null))
    // 一次运行交回几张就落几张：每张都按这次的运行记录号投（同一个合并规则），按上游顺序，最后一张是最新的版本。
    let landedInOpenProject = false
    for (const result of results) {
      landedInOpenProject = await deliverOwnOutcome({ kind: 'result', result, runId: run.id, ...(mediaDimensions ? { mediaDimensions } : {}) })
    }
    const title = (initialNode.title || '').trim()
    for (const result of results) {
      // 自动另存（集中设置页开启时）：新生成的图/视频静默复制一份到用户目录（每张都存）。fire-and-forget——不 await
      // （不拖慢生成收尾）、失败不冒泡（best-effort 全在主进程侧，关着/没设目录/失败都静默）。只对新生成，
      // 找回(recoverTaskActions)不触发、避免重复另存。
      if ((result.type === 'image' || result.type === 'video') && (result.url || '').trim()) {
        void getDesktopBridge()
          ?.assets?.autoSave?.({ url: result.url as string, suggestedName: title || undefined })
          .catch(() => undefined)
      }
    }
    if (landedInOpenProject) recordNodeModelSuccess(run.attempt)
    useGenerationQueueStore.getState().markSettled(batchId, id, 'success')
    if (landedInOpenProject) await persistActiveWorkbenchProjectNow().catch(() => {})
    // 返回这次最新的那张（成为当前图的就是它，时间轴据它对账）。
    return results[results.length - 1]!
  } catch (caughtError: unknown) {
    const error = (await own.drained()) ?? caughtError
    runFailure = error
    // Both explicit cancellation and its polling race return to idle without penalizing model health.
    if (isLocalTaskCancelledError(error) || isTaskCancelRequested(id)) {
      // 单镜 Run 路：只是渲染层不等了——还在路上的交给主进程观察者收完，钱花了的结果照样进项目。
      if (options.ledger === 'run') void releaseCanvasShotRun({ projectId: target.projectId, runRecordId: run.id }).catch(() => undefined)
      await deliverOwnOutcome({ kind: 'status', runId: run.id, status: 'idle' })
      // 用户主动停的：不进刹车计数（模型没挂，是人喊停的）。
      useGenerationQueueStore.getState().markSettled(batchId, id, 'cancelled', { countsTowardBrake: false })
      throw isLocalTaskCancelledError(error) ? error : new LocalTaskCancelledError()
    }
    if (error instanceof AssetUploadConsentCancelledError) {
      await deliverOwnOutcome({ kind: 'status', runId: run.id, status: 'idle' })
      useGenerationQueueStore.getState().markSettled(batchId, id, 'cancelled', { countsTowardBrake: false })
      throw error
    }
    // A polling timeout remains recoverable from its persisted taskId; it is not a model failure.
    if (isRecoverableTimeoutError(error)) {
      await deliverOwnOutcome({ kind: 'status', runId: run.id, status: 'recoverable', error: error.message })
      // 上游没有明确判死（可能仍在跑/已出片）→ 健康记账不算失败，刹车也不该算。
      useGenerationQueueStore.getState().markSettled(batchId, id, 'error', {
        error: error.message,
        countsTowardBrake: false,
      })
      throw error
    }
    // A retrieval-stage failure stays recoverable using the current original node's taskId;
    // retrievalRecovery distinguishes this already-paid task from a new paid retry.
    const blocked = retrievalRecoverableMessage(error, (await readRunGraph(target))?.nodes.find((n) => n.id === id))
    if (blocked) {
      // 不记模型失败（丢的只是取回），但刹车照记：后续每条多半会同样失败而提交侧照旧扣费。
      await deliverOwnOutcome({ kind: 'status', runId: run.id, status: 'recoverable', error: blocked })
      useGenerationQueueStore.getState().markSettled(batchId, id, 'error', { error: blocked })
      throw error
    }
    if (isOpenGenerationRefusal(describeOpaqueFailure(error))) {
      // 主进程拒了 = 这次从来不是一次运行（D3）：不写记录、不回滚（runOwnOutcomes.refused）。
      await own.refused()
      useGenerationQueueStore.getState().markSettled(batchId, id, 'cancelled', { countsTowardBrake: false })
      if (options.initiator === 'user') {
        const open = await canvasOpenRuns({ projectId: target.projectId, nodeId: id })
        whenRunTargetLoaded(target, () => { synchronizeCanvasOpenRuns(open) })
      }
      throw error
    }
    const kind = classifyGenerationError(describeOpaqueFailure(error)).kind
    if (kind !== 'local-refusal' && isRunTargetLoaded(target)) recordNodeModelFailure(run.attempt)
    // Store the RAW message (describeOpaqueFailure only fills in when there is none): NodeErrorReport
    // runs classifyGenerationError over it, and a plain string needs no persisted-shape migration.
    const rawMessage = describeOpaqueFailure(error)
    await deliverOwnOutcome({ kind: 'status', runId: run.id, status: 'error', error: rawMessage })
    // 真执行失败 → 计入刹车（连续 3 个即暂停队列，防上游整体挂掉时把剩下的额度一路烧完）。
    useGenerationQueueStore.getState().markSettled(batchId, id, 'error', { error: rawMessage, countsTowardBrake: countsTowardGenerationBrake(kind) })
    throw error
  } finally {
    // A rejected disk write/read must not strand the original queue entry as running.
    const entry = useGenerationQueueStore.getState().entries.find(item => item.batchId === batchId && item.nodeId === id)
    if (entry?.state === 'running' || entry?.state === 'queued') {
      useGenerationQueueStore.getState().markSettled(batchId, id, 'error', {
        error: describeOpaqueFailure(runFailure), countsTowardBrake: false,
      })
    }
    // 取消登记与活预览帧都是会话瞬态：任务收尾（成/败/取消）一律清，防泄漏到下一次生成。
    clearTaskCancel(id)
    useNodeLivePreviewStore.getState().clearPreview(id)
    // 单发路径的批次由本函数自建，也由本函数收尾（批量路径归 runGenerationNodesByPlan 收）。
    if (ownsBatch) useGenerationQueueStore.getState().finishBatch(batchId)
  }
}

export type RunGenerationNodesBatchOptions = Omit<RunGenerationNodeOptions, 'ledger' | 'runRecordId'> & {
  /**
   * 批量卡上点了确认之后主进程为每一个要花钱的节点开好的出价：节点 → 运行记录号。在这里的节点走单镜 Run（它自己那一份），
   * 不在这里的是不花钱的本地 / 文本节点。缺省 = 这一批没有要花钱的节点。
   */
  canvasRunRecordIds?: ReadonlyMap<string, string>
  /** Maximum concurrent runs. Defaults to 6（用户拍板：同一波内尽量并行，框选 6 个镜头能一起跑，
   *  不再一个一个来）。有依赖的镜头仍按波次串行（锚先于镜头），这只调「同波内同时几个」。上限 8。 */
  concurrency?: number
  /** Called whenever a node finishes (success or failure) so the UI can update progress. */
  onNodeResult?: (
    event: { ok: true; nodeId: string; result: GenerationNodeResult } | { ok: false; nodeId: string; error: Error },
  ) => void
}




/**
 * Run a batch of generation nodes with bounded concurrency. Each node
 * goes through the same retry/failure semantics as `runGenerationNode`,
 * so callers can still display a per-node retry button if a run fails.
 * This is the runtime used by the storyboard demo's "全部生成" action.
 *
 * @legacy-batch-frozen (P4 S7, docs/plan/2026-08-25-p4-s7-legacy-converge.md)
 * 这是 GUI 画布批量的**唯一自有派发循环**，也是默认构建里现役的唯一 GUI 批量路径（语义调度器默认关）。
 * 冻结纪律：**不加新功能**。新批量能力（合同/收据/预算/锚检查点/慢供应商韧性）只进语义调度器
 * multiShotBatchScheduler；本函数只做维护性修复，别在此长新逻辑。Canvas owner → 语义运行时的迁移
 * 是 P5 Proposal adapter（runtime plan line 103/505），不是 S7。check:batch-machines 门岗钉死
 * runGenerationNode 调用点不外扩（别在别处再起第四台批量循环）。
 */
export async function runGenerationNodesBatch(
  nodeIds: readonly string[],
  options: RunGenerationNodesBatchOptions,
): Promise<RunGenerationNodesBatchResult> {
  const queue = nodeIds
    .map((value) => String(value || '').trim())
    .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index)
  const concurrency = normalizeCanvasBatchConcurrency(options.concurrency)
  const successes: RunGenerationNodesBatchResult['successes'] = []
  const failures: RunGenerationNodesBatchResult['failures'] = []
  const skipped: string[] = []
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      // 闸一：批次被整体取消 → 跳出；被连续失败刹车暂停 → 在此挂起，等用户「继续」或「全部取消」。
      // 不传 batchId 时恒 'go'，退化回接队列前的行为。
      if ((await waitForQueueGate(options.batchId)) === 'stop') break
      const nextIndex = cursor
      cursor += 1
      const nodeId = queue[nextIndex]
      // 闸二：这一个被单独取消了 → 直接跳过。**零 vendor 调用零扣费**，这就是「取消不产生费用」的兑现处。
      if (isEntryCancelled(options.batchId, nodeId)) continue
      try {
        const node = (await readRunGraph(options.target))?.nodes.find(value => value.id === nodeId)
        if (paidNodeLedger(node) && (await canvasOpenRuns({ projectId: options.target.projectId, nodeId })).length) {
          skipped.push(nodeId)
          if (options.batchId) useGenerationQueueStore.getState().markSettled(options.batchId, nodeId, 'cancelled', { countsTowardBrake: false })
          const record = options.canvasRunRecordIds?.get(nodeId)
          if (record) withdrawCanvasShots({ projectId: options.target.projectId, runRecordIds: [record], by: 'stopped' })
          continue
        }
        const result = await runGenerationNode(nodeId, {
          assertAuthorCurrent: options.assertAuthorCurrent,
          assertApprovedInputs: options.assertApprovedInputs,
          executor: options.executor,
          retry: options.retry,
          // 整批共用一个托管决定：批量确认卡对整批问了一次（batchPlanPreview），别在波次里逐个再问。
          assetUploadConsent: options.assetUploadConsent,
          target: options.target,
          ...(options.claimAdmittedByHost ? { claimAdmittedByHost: true as const } : {}),
          ...(options.canvasRunRecordIds?.has(nodeId) ? { ledger: 'run' as const, runRecordId: options.canvasRunRecordIds.get(nodeId)! } : {}),
          ...(options.batchId ? { batchId: options.batchId } : {}),
        })
        successes.push({ nodeId, result })
        // 批量重生成也要走回填闸（与单发路径同款）：位置不变、clip 换新产物 URL；无引用时 no-op。
        // 只有这张图就是当前图才对账（D7）：比它新的运行已经成功时，它只进了版本历史，时间轴不动。
        whenRunTargetLoaded(options.target, () => {
          if (useGenerationCanvasStore.getState().nodes.find(node => node.id === nodeId)?.result?.id === result.id) useWorkbenchStore.getState().reconcileTimelineForUpdatedNodes(nodeId, result)
        })
        options.onNodeResult?.({ ok: true, nodeId, result })
      } catch (error: unknown) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        if (isOpenGenerationRefusal(normalizedError.message)) { skipped.push(nodeId); continue }
        failures.push({ nodeId, error: normalizedError })
        options.onNodeResult?.({ ok: false, nodeId, error: normalizedError })
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
  await Promise.all(workers)
  return { totalCount: queue.length, successes, failures, skipped }
}

/**
 * 单节点生成/重试/生成变体的轻确认 + 跑。要花钱的走单镜 Run（这一下点击就是批准，主进程记账）；文本 / 本地 ComfyUI 不进 Run、不要授权。
 * rerun=true 是「基于此生成变体」：先复制出新节点再跑；普通重新生成走 regenerateNodeInPlace。
 */
const preparingSingleGeneration = new Map<string, symbol>()
export async function confirmAndRunNode(nodeId: string, opts: { rerun?: boolean; title?: string; confirmLabel?: string; prepareDependencies?: () => boolean; deferredMaterialization?: DeferredNodeMaterialization } & GenerationConfirmationGuards): Promise<GenerationRunOutcome> {
  if (preparingSingleGeneration.has(nodeId)) return 'nothing-to-run'
  const intent = Symbol()
  preparingSingleGeneration.set(nodeId, intent)
  const ready = (preparing = false) => {
    if (preparing && preparingSingleGeneration.has(nodeId) && preparingSingleGeneration.get(nodeId) !== intent) return false
    if (preparing) preparingSingleGeneration.set(nodeId, intent)
    else if (preparingSingleGeneration.get(nodeId) === intent) preparingSingleGeneration.delete(nodeId)
    return true
  }
  try { return await confirmAndRunSingleNode(nodeId, opts, ready) } finally { ready() }
}

async function confirmAndRunSingleNode(nodeId: string, opts: { rerun?: boolean; title?: string; confirmLabel?: string; prepareDependencies?: () => boolean; deferredMaterialization?: DeferredNodeMaterialization } & GenerationConfirmationGuards, ready: (preparing?: boolean) => boolean): Promise<GenerationRunOutcome> {
  // 点「生成」即动作起点：签发此刻打开的项目。提交前（确认卡）换了项目 = 取消，没花钱；
  // 一旦提交，运行归原项目（target），之后切页/切项目都不取消它。
  const project = withProjectAction((issued) => issued)
  if (!project) return 'unavailable'
  const projectId = project.binding.projectId
  let assertApprovedInputs = opts.deferredMaterialization
    ? undefined
    : captureApprovedGenerationInputs([nodeId])
  const node = opts.deferredMaterialization?.draftNode ?? useGenerationCanvasStore.getState().nodes.find((n) => n.id === nodeId)
  const open = !opts.rerun && paidNodeLedger(node) ? await canvasOpenRuns({ projectId, nodeId }) : []
  if (open.length && opts.initiator !== 'user') throw Object.assign(new Error('node_generation_in_flight'), { code: 'node_generation_in_flight' })
  if (opts.prepareDependencies?.()) return 'nothing-to-run'
  const hosting = await resolveHostingDisclosure(node)
  if (!hosting.allowed) return 'declined'
  let acknowledgedOpenRuns: string[] | undefined
  const askToResend = async (entries: Awaited<ReturnType<typeof canvasOpenRuns>>): Promise<GenerationRunOutcome | null> => {
    if (!isProjectExecutionContextCurrent(project)) return 'unavailable'
    synchronizeCanvasOpenRuns(entries)
    const current = useGenerationCanvasStore.getState().nodes.find(value => value.id === nodeId) ?? node
    const unknown = entries.some(entry => entry.reason === 'needs_reconcile') || Boolean(current?.error && classifyGenerationError(current.error).primary === 'release-regenerate')
    const confirmed = await confirmGenerationResend({ resultUnknown: unknown, kind: current ? spendCostKind(current.kind) : 'image', ...(hosting.disclosure ? { hostingDisclosure: hosting.disclosure } : {}) })
    if (!confirmed) return 'declined'
    if (!isProjectExecutionContextCurrent(project)) return 'unavailable'
    try {
      const productionRunId = productionMetaOf({ meta: current?.meta })?.runId
      if (productionRunId) await releaseUnknownSubmissionForNode(projectId, productionRunId, nodeId, productionRunApi)
      acknowledgedOpenRuns = await releaseUnknownCanvasSubmissionsForNode(projectId, nodeId, productionRunApi)
      project.assertCurrent()
    } catch {
      reportCanvasFeedback(i18n.t('generationCommon.observability.releaseConfirm.failed'), 'error', { identity: `node:${nodeId}`, reason: 'release-failed', projectId, nodeIds: [nodeId] })
      return 'unavailable'
    }
    return null
  }
  const resending = opts.initiator === 'user' && (opts.resend || open.length > 0)
  if (resending) {
    const outcome = await askToResend(open)
    if (outcome) return outcome
  }
  const ok = resending || await confirmGenerationSpend([node], {
    initiator: opts.initiator,
    title: opts.rerun ? i18n.t('generationCommon.spend.generateVariant') : opts.title || i18n.t('generationCommon.spend.startGeneration'),
    message: describeGenerationCost(1, node ? spendCostKind(node.kind) : 'image', generationCostContextForNode(node, projectId)),
    confirmLabel: opts.rerun ? i18n.t('generationCommon.spend.generateVariant') : opts.confirmLabel || i18n.t('generationCommon.spend.generate'),
    ...(hosting.disclosure ? { hostingDisclosure: hosting.disclosure } : {}),
  })
  // **这一行就是那个结局**：2026-09-22 之前它是一个裸 `return`，Agent 那一侧因此读不到
  // 「他点了取消」（见 `generationRunOutcome.ts`）。
  if (!ok) return 'declined'
  await opts.assertCurrent?.()
  if (!isProjectExecutionContextCurrent(project)) return 'unavailable'
  let runId = nodeId
  if (opts.deferredMaterialization) {
    runId = await opts.deferredMaterialization.materialize()
    if (!runId) return 'unavailable'
    assertApprovedInputs = captureApprovedGenerationInputs([runId])
  }
  const runNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === runId) ?? node
  if (opts.rerun) {
    assertApprovedInputs?.(useGenerationCanvasStore.getState(), nodeId)
    const dup = useGenerationCanvasStore.getState().duplicateNodeForRegeneration(nodeId)
    if (!dup) return 'unavailable'
    runId = dup.id
    assertApprovedInputs = captureApprovedGenerationInputs([runId])
    // 副本落在屏外时由画布边缘提示指路；不再替用户把画布挪过去（2026-09-25「程序不再主动平移画布」）。
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const work = runGenerationNode(runId, { assertAuthorCurrent: opts.assertAuthorCurrent, assertApprovedInputs, ...(paidNodeLedger(runNode) ? { ledger: 'run' as const } : {}), initiator: opts.initiator, acknowledgedOpenRuns, assetUploadConsent: 'allow', target: project.binding })
      ready()
      const result = await work
      whenRunTargetLoaded(project.binding, () => {
        if (useGenerationCanvasStore.getState().nodes.find(node => node.id === runId)?.result?.id === result.id) useWorkbenchStore.getState().reconcileTimelineForUpdatedNodes(runId, result)
      })
      break
    } catch (error) {
      if (!isOpenGenerationRefusal(describeOpaqueFailure(error)) || opts.initiator !== 'user' || attempt > 0) break
      if (!ready(true)) return 'nothing-to-run'
      const outcome = await askToResend(await canvasOpenRuns({ projectId, nodeId }))
      if (outcome) return outcome
    }
  }

  // 提交已经发出去了（跑挂了由任务队列记失败），对「用户同不同意这次」这一格就是 started。
  return 'started'
}

/** Re-generate in place: retain node identity, add the result to its existing history, and
 * reconcile timeline references. confirmAndRunNode({ rerun: true }) remains the duplicate action. */
export async function regenerateNodeInPlace(
  nodeId: string,
  // 确认卡可带调用方的动作名（如分镜表「用新图重跑」）：用户点的是什么，卡上就回声什么，
  // 不让一张通用「重新生成」卡吃掉刚建立的语境（R16 情绪走查：小白在这一步会迟疑
  // 「到底用没用新图」）。缺省仍是「重新生成」，画布 composer 等既有调用方零变化。
  opts: { title?: string; confirmLabel?: string } & GenerationConfirmationGuards,
): Promise<GenerationRunOutcome> {
  return confirmAndRunNode(nodeId, opts)
}

export function canRunGenerationNode(
  node: GenerationCanvasNode | Pick<GenerationCanvasNode, 'kind'> | null | undefined,
  context: GenerationRunContext = {},
): boolean {
  if (!node) return false
  // 这一镜归制作流程生成（报价卡等确认 / 排队 / 生成中）：画布再发一次就是重复生成、重复扣费。
  if ('id' in node && node.id && isNodeGenerationOwnedByProduction(node, useProductionCanvasLandingStore.getState().runs)) return false
  return generationNodeInputsReady(node, context)
}

/**
 * 这个节点**自己的输入**够不够发一次（不问这一镜归谁生成）：3D-BOX 预演就绪、档案模式要的参考都在、跨槽依赖成立。
 * `canRunGenerationNode` = 归画布 + 这一条；交接过来的镜（`claimAdmittedByHost`）与付费卡出卡前的本地预检只问这一条——
 * 判据只有这一份，生成钮置灰、提交咽喉、卡上「去改镜 N」说的是同一件事。
 */
export function generationNodeInputsReady(
  node: GenerationCanvasNode | Pick<GenerationCanvasNode, 'kind'> | null | undefined,
  context: GenerationRunContext = {},
): boolean {
  if (!node) return false
  // 这一镜的 3D-BOX 参考预演还没好（渲染中 / 失败）或已过期（挂上之后又被改过）：花钱就是按错的参考出片。判据只住 directorPreviewState。
  if ('id' in node && node.id && directorPreviewSpendBlock(node.id, context.nodes ?? useGenerationCanvasStore.getState().nodes)) return false
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  if (executionKind === 'image') {
    // L3 护栏：档案当前模式是「图生图」(image_edit) 且声明了参考槽、却一张参考都递不进来 → 不可生成
    // （对齐视频节点既有护栏；composer 给「图生图需要参考图」文案）。此前 image 恒 true，空参考的
    // 图生图会被静默当纯文生发出去（模板丢空键）——「图生图不按原图」体感来源之一。
    // 纯文生图模式 / 无档案模型照旧恒可生成（后者由 runtime 的 image_edit 闸兜底诚实拒发）；
    // 连了线但源未生成不在此禁——composer 的「备齐参考」波次接管。
    if (!('id' in node) || !node.id) return true
    const meta = node.meta || {}
    const imageArchetype = resolveTaskArchetype(meta)
    if (!imageArchetype) return true
    // 方式按这次的输入现算：没放图就是文生图（不再有「方式要图却没图」这一说）；放了图才轮到「参考到没到」。
    const references = resolveGenerationReferences(node, context)
    const imageMode = sendArchetypeMode(imageArchetype, node, references)
    if (imageMode.transportTaskKind !== 'image_edit' || (imageMode.slots || []).length === 0) return true
    return hasAnyArchetypeReference(meta, imageMode, references)
  }
  // C5: 文本节点只要选了文本模型就能生成；prompt 缺失由 buildCatalogTaskRequest 兜底报错。
  if (executionKind === 'text') return true
  // 声音：配音(台词缺失下游兜底，同 text 可生成)；转写需先有音频参考(audio_ref 槽)。
  if (executionKind === 'audio') {
    if (!('meta' in node)) return true
    const meta = node.meta || {}
    const audioArchetype = resolveTaskArchetype(meta)
    const audioReferences = 'id' in node && node.id ? resolveGenerationReferences(node, context) : undefined
    const mode = audioArchetype ? sendArchetypeMode(audioArchetype, node as GenerationCanvasNode, audioReferences) : null
    const needsAudioRef = (mode?.slots || []).some((slot) => slot.kind === 'audio_ref')
    if (!needsAudioRef) return true
    // 连线来源也算（2026-09-11 起「声音」节点/导入的音频素材是一等参考源，SLOT_ACCEPTS.audio_ref=
    // ['audio']——用户报的根因「声音节点连不上视频节点」修在 anchorPolicy.ts + referenceEdgeCapability.ts）
    // ——口径与另两支一致，这里当年就已经按「将来会有音频源」写好，不用再改。
    return Boolean(mode && hasAnyArchetypeReference(meta, mode, audioReferences))
  }
  // 视频与 3D **共用**下面这段「档案模式声明」判定（P1 不复制第二份）：3D 档案与视频同构——
  // text 模式 slots:[]（文生3D，prompt-only）、image 模式带 first_frame 参考槽（图生3D）。
  // 此前这里只认 video，其余 kind 一律 false → model3d 节点生成钮恒灰、runner 抛「暂不支持」，
  // 画布 3D 节点永远发不出去（#320 J11 实证；同族第二次发作，第一次=#286 参数底栏）。
  // 「新 kind 漏分支」整类由 canRunGenerationNode.test.ts 的 registry 穷举矩阵当场报红。
  if (executionKind !== 'video' && executionKind !== 'model3d') return false
  if (!('id' in node) || !node.id) return false
  const meta = node.meta || {}
  const archetype = resolveTaskArchetype(meta)
  // 无档案模型（ComfyUI 导入图 / 自定义接入）→ 放行。判据必须是**模型自己声明要什么**，不是
  // 「用户手上现在有没有参考」——后者把因果反过来了。图/音两支早已收口成「无档案 = 放行，由 runtime
  // 的诚实闸兜底拒发」（见上 image 分支注释），只有 video 这支漏了，于是**图定义的文生视频工作流**
  // 被锁死：图里没有图输入、UI 也不显示参考框，按钮却非要一张参考才亮 → 用户只能连张图去喂它 →
  // runtime 又以「没有『图生视频』通道」拒发 → 两头堵死，纯文生视频整类发不出去（2026-08-24 用户反馈：
  // 「Comfyui 我配置的文生视频工作流，但是提交必须输入图片才能发出」）。
  // 与 promptRequiredForNode 同一条思路：需不需要某种输入是模型的属性，这一层不猜。
  if (!archetype) return true
  // 当前模式无参考槽 = 纯文生视频（t2v）→ 只要 prompt 即可生成，同 text/image 节点（prompt 缺失下游兜底）。
  // 不能因「video 一律要首帧」把 t2v 的生成按钮锁死——栽过：RunningHub Seedance 默认 text 模式（slots:[]）
  // 按钮被置灰、误提示"需要首帧"，用户根本点不了文生视频（2026-06-30 用户反馈）。apimart/kie Seedance 同病，
  // 只是用户多从图片边起步才没暴露。根因 = 此判定原本不分模式，一律要参考。
  // 方式按这次的输入现算（没放东西且档案有文字生成 = 文生，偏好里是首尾帧 / 参考也一样）。
  const references = resolveGenerationReferences(node, context)
  const mode = sendArchetypeMode(archetype, node, references)
  if ((mode.slots || []).length === 0) return true
  // 有参考槽的模式（i2v/首尾帧/全能参考 omni/视频编辑）→ 需至少一个参考。判据统一交给
  // hasAnyArchetypeReference：它遍历**本模式声明的槽**，每个槽同时看「画布边」和「meta 手动上传」，
  // 与显示（resolveReferenceSlots）、发送（buildArchetypeInputParams）同一口径。
  // 此前这里是一串就地展开的 OR，每加一种槽都得记得再补一条 → 漏了连线参考视频、尾帧接力、
  // 源视频三处，用户明明连了线、缩略图也显示着，↑ 按钮却死着（2026-08-20 用户反馈 + 不变量测试）。
  if (!hasAnyArchetypeReference(meta, mode, references)) return false
  // 跨槽依赖（档案 slot.requiresAnyOf）：有参考 ≠ 组合合法。Seedance 2.0 的参考音频必须搭配图或视频
  // （方舟「不支持"文本+音频"、"纯音频" 输入」/ APIMart "Must be used together with reference images
  // or reference videos"），只放一段音频此前会被判可生成、发出去才被服务商拒。2.5 已解除，故按档案声明判、
  // 不写死模型名。置灰文案取同一判定（unmetReferenceDependencyForNode），不让 composer 再猜一遍。
  return !unmetReferenceDependencyForNode(node, context)
}

/**
 * 该节点当前有没有「有值却缺伴随」的参考槽（档案 slot.requiresAnyOf）。
 * `canRunGenerationNode` 用它决定能不能点，composer 用它决定置灰时说哪句人话 —— **同一个判定**。
 */
export function unmetReferenceDependencyForNode(
  node: GenerationCanvasNode,
  context: GenerationRunContext = {},
): UnmetReferenceDependency | null {
  const meta = node.meta || {}
  const archetype = resolveTaskArchetype(meta)
  const references = resolveGenerationReferences(node, context)
  return nodeUnmetReferenceDependency(meta, archetype ? sendArchetypeMode(archetype, node, references) : null, references)
}
