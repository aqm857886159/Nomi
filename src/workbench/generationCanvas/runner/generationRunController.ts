import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { getDesktopBridge } from '../../../desktop/bridge'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { toast } from '../../../ui/toast'
import { mintSpendGrant } from '../../api/taskApi'
import { confirmGenerationSpend, describeGenerationCost, generationCostContextForNode, type GenerationCostKind } from '../spend/spendConfirm'
import { generationNodeExecutor, type GenerationNodeExecutor } from './generationNodeExecutor'
import { narrateProgress } from '../../observability/narrate'
import { LocalTaskCancelledError, clearTaskCancel, isTaskCancelRequested, isLocalTaskCancelledError } from './localTaskControl'
import { useComfyuiPreviewStore } from '../store/comfyuiPreviewStore'
import { isRecoverableTimeoutError } from './recoverableTimeout'
import { recordModelFailure, recordModelSuccess } from './modelHealthMemory'
import {
  beginSingletonBatch,
  isEntryCancelled,
  useGenerationQueueStore,
  waitForQueueGate,
} from './generationQueueStore'
// 错误分类(classifyGenerationError)已抽到 observability/classifyError(人话叶子层,生成域+对话域共用);
// 这里 re-export 保持 NodeErrorReport / classifyGenerationError.test 等既有 import 不破。
export { classifyGenerationError, type GenerationErrorReport } from '../../observability/classifyError'
import type { DependencyWavePlan } from './dependencyWaves'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { stampUpstreamRefSnapshot } from './refSnapshotStamp'
import { archetypeForNode, resolveModeForConnectedReferences } from '../agent/referenceEdgeCapability'
import {
  applyArchetypeModeSwitch,
  currentArchetypeMode,
  hasAnyArchetypeReference,
} from '../nodes/controls/archetypeMeta'
import {
  nodeUnmetReferenceDependency,
  type UnmetReferenceDependency,
} from '../nodes/controls/referenceDependency'
import { resolveTaskArchetype } from './catalogTaskResolve'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import i18n from '../../../i18n'
import {
  AssetUploadConsentCancelledError,
  hasLocalAssetReference,
  resolveAssetUploadConsent,
} from './assetUploadConsent'
import type { HostingDisclosure } from '../spend/spendConfirm'
import { FOCUS_GENERATION_NODE_EVENT } from '../nodes/nodeSizing'
import { buildDialoguePromptSuffix } from '../agent/storyboardDialogue'

/** 节点 kind → 付费预估用的产物口径，喂给 describeGenerationCost 报对名词与时长。 */
function spendCostKind(kind: GenerationNodeKind): Exclude<GenerationCostKind, 'mixed'> {
  const exec = getGenerationNodeExecutionKind(kind)
  // model3d 同为一等产物口径——落回 'image' 会让花钱确认卡把 3D 生成说成「1 张画面」（同族 kind 边界漏 3D）。
  return exec === 'text' || exec === 'video' || exec === 'audio' || exec === 'model3d' ? exec : 'image'
}

/** 一批节点的产物口径：全同则取该类，混合则 'mixed'，喂给 describeGenerationCost 报对名词。 */
export function spendCostKindForNodes(ids: string[]): GenerationCostKind {
  const nodes = useGenerationCanvasStore.getState().nodes
  const kinds = new Set(
    ids
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is GenerationCanvasNode => Boolean(n))
      .map((n) => spendCostKind(n.kind)),
  )
  if (kinds.size === 1) return [...kinds][0]
  return kinds.size === 0 ? 'image' : 'mixed'
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

export type RunGenerationNodeOptions = {
  executor?: GenerationNodeExecutor
  retry?: {
    maxAttempts?: number
    baseDelayMs?: number
  }
  /** 付费守卫令牌：真人确认后铸的 grantId，透传到 executor → request.extras 供主进程核验。 */
  grantId?: string
  /** One-shot correction appended to the provider prompt for a bounded QA retry. */
  promptSuffix?: string
  /** 队列批次 id（任务中心的调度真相源，见 generationQueueStore）。不传 = 单发，内部自建 1 节点批次。 */
  batchId?: string
  /**
   * 上游确认面已解析好的托管同意。**必填**，理由见 AssetUploadConsentDecision。
   * runner 不问用户——它只执行已经做出的决定。
   */
  assetUploadConsent: AssetUploadConsentDecision
}

async function buildConsentNode(node: GenerationCanvasNode): Promise<Pick<GenerationCanvasNode, 'meta' | 'references'>> {
  const resolved = resolveGenerationReferences(node, { nodes: [node], edges: [] })
  return {
    ...node,
    references: [
      ...(node.references || []),
      ...resolved.referenceImages,
      ...resolved.referenceVideos,
      ...resolved.referenceAudios,
      ...(resolved.firstFrameUrl ? [resolved.firstFrameUrl] : []),
      ...(resolved.lastFrameUrl ? [resolved.lastFrameUrl] : []),
      ...(resolved.relayFromVideoUrl ? [resolved.relayFromVideoUrl] : []),
    ],
  }
}

async function resolveHostingDisclosure(node: GenerationCanvasNode | undefined): Promise<{ allowed: boolean; disclosure?: HostingDisclosure }> {
  if (!node) return { allowed: true }
  const consentNode = await buildConsentNode(node)
  const resolution = await resolveAssetUploadConsent(consentNode)
  if (!resolution.allowed) return { allowed: false }
  if (!resolution.needsConfirmation) return { allowed: true }
  return {
    allowed: true,
    disclosure: {
      message: i18n.t('generationCommon.spendHostingDisclosure.message'),
      rememberLabel: i18n.t('generationCommon.spendHostingDisclosure.remember'),
      onRemember: resolution.remember,
    },
  }
}

/**
 * 给**自主路径**（外部 agent / MCP 能力）解析托管同意——这些路径没有人坐在屏幕前，
 * 弹卡等于把整条自动化挂死在一个没人点的对话框上。
 *
 * 判据完全复用同一个 resolveAssetUploadConsent，不另立一套语义：
 * - 策略 deny → 抛 AssetUploadConsentCancelledError，这次生成不发（诚实失败，理由回给调用方）；
 * - 还需要问一次（策略 ask + 有本地素材 + KIE 没配）→ 同样**拒发**。自动化不能替用户
 *   默默把素材传到公共托管上；把「去设置里配 KIE，或把托管策略改成允许」这句人话回给
 *   agent，由它转达。这是 D4「缺口明着标」：宁可这一次不跑，也不偷偷上传。
 * - 其余 → 'allow' / 'not-needed'，照常跑。
 */
export async function resolveAutonomousUploadConsent(
  nodeId: string,
): Promise<AssetUploadConsentDecision> {
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return 'not-needed'
  const consentNode = await buildConsentNode(node)
  if (!hasLocalAssetReference(consentNode)) return 'not-needed'
  const resolution = await resolveAssetUploadConsent(consentNode)
  if (!resolution.allowed) throw new AssetUploadConsentCancelledError()
  if (resolution.needsConfirmation) {
    throw new Error(i18n.t('generationCommon.spendHostingDisclosure.autonomousBlocked'))
  }
  return 'allow'
}

type GenerationRunContext = {
  nodes?: GenerationCanvasNode[]
  edges?: GenerationCanvasEdge[]
}

type RetryableGenerationError = Error & {
  status?: number
  code?: unknown
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 350

function isRetryableGenerationError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (!(error instanceof Error)) return false
  const candidate = error as RetryableGenerationError
  if (typeof candidate.status === 'number') {
    return (
      candidate.status === 408 ||
      candidate.status === 409 ||
      candidate.status === 425 ||
      candidate.status === 429 ||
      candidate.status >= 500
    )
  }
  const message = candidate.message.trim().toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('socket') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('rate limit')
  )
}

function normalizeRetryAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS
  return Math.max(1, Math.min(5, Math.floor(value)))
}

function normalizeBaseDelayMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BASE_DELAY_MS
  return Math.max(0, Math.min(3_000, Math.floor(value)))
}

async function waitForRetry(attempt: number, baseDelayMs: number): Promise<void> {
  if (baseDelayMs <= 0) return
  await new Promise((resolve) => globalThis.setTimeout(resolve, baseDelayMs * 2 ** Math.max(0, attempt - 1)))
}

/**
 * 提交前对账「生成方式 × 活边参考」（2026-07-28 群反馈根治）：当前模式一条参考边都收不下、档案里
 * 有能收的模式 → 切过去（与建边 autoPromoteTargetModeForEdge 同一套语义，ModeBar 同步翻转）。
 * 建边时的 auto-promote 只覆盖「建边那一刻」，换模型（archetype 失配落回默认 t2i）、存量边都够不到；
 * 停在 t2i 的节点会在投影层（buildArchetypeInputParams 空槽互斥）把挂着的参考静默丢掉、付费发出
 * 纯文生（「男的角色图生成出女的」根因）。挂在唯一提交咽喉 runGenerationNode 入口，整类不再复发。幂等。
 */
export function reconcileNodeModeWithConnectedReferences(nodeId: string): void {
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  const nextModeId = resolveModeForConnectedReferences(node, state.nodes, state.edges)
  if (!nextModeId) return
  const archetype = archetypeForNode(node)
  if (!archetype) return
  state.updateNode(nodeId, {
    meta: applyArchetypeModeSwitch((node.meta || {}) as Record<string, unknown>, archetype, nextModeId),
  })
}

/** 结算时读节点当前绑定的模型键（健康记忆的记账主体；meta 无 modelKey 的异常路径记空=跳过）。 */
function currentNodeModelKey(nodeId: string): unknown {
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  return (node?.meta as Record<string, unknown> | undefined)?.modelKey
}

// options 没有默认值：`= {}` 正是让调用点能省略托管同意的那个逃生口（F16b 根因）。
// 去掉它之后，「谁问的用户」在编译期就必须有答案。
export async function runGenerationNode(
  nodeId: string,
  options: RunGenerationNodeOptions,
): Promise<GenerationNodeResult> {
  const id = String(nodeId || '').trim()
  if (!id) throw new Error('nodeId is required')

  reconcileNodeModeWithConnectedReferences(id)
  const initialState = useGenerationCanvasStore.getState()
  const initialNode = initialState.nodes.find((node) => node.id === id)
  if (!initialNode) throw new Error('node not found')
  if (!canRunGenerationNode(initialNode, { nodes: initialState.nodes, edges: initialState.edges })) {
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
  stampUpstreamRefSnapshot(id, { nodes: initialState.nodes, edges: initialState.edges })
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
  const batchId = options.batchId ?? beginSingletonBatch(id)
  useGenerationQueueStore.getState().markRunning(batchId, id)

  const run = initialState.appendNodeRun(id, {
    status: 'queued',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  })
  useGenerationCanvasStore.getState().setNodeProgress(id, {
    runId: run.id,
    phase: 'queued',
    message: narrateProgress('queued'),
    percent: 0,
  })

  try {
    const executor = options.executor ?? generationNodeExecutor
    const maxAttempts = normalizeRetryAttempts(options.retry?.maxAttempts)
    const baseDelayMs = normalizeBaseDelayMs(options.retry?.baseDelayMs)
    let result: GenerationNodeResult | null = null
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const state = useGenerationCanvasStore.getState()
      const node = state.nodes.find((candidate) => candidate.id === id) || initialNode
      const nodeMeta = (node.meta || {}) as Record<string, unknown>
      const dialogueArchetype = resolveTaskArchetype(nodeMeta)
      const dialogueMode = dialogueArchetype ? currentArchetypeMode(dialogueArchetype, nodeMeta) : null
      const dialoguePromptSuffix = buildDialoguePromptSuffix(dialogueMode, nodeMeta, nodeMeta.dialogue)
      try {
        result = await executor(node, {
          nodes: state.nodes,
          edges: state.edges,
          ...(options.grantId ? { grantId: options.grantId } : {}),
          ...(options.promptSuffix || dialoguePromptSuffix
            ? { promptSuffix: [options.promptSuffix, dialoguePromptSuffix].filter(Boolean).join('\n\n') }
            : {}),
          // 提交幂等键 = 本次 run.id：重试循环内每次 attempt 复用同一个 run.id，
          // electron 侧台账据此认作「同一次意图提交」→ 重试绝不二次下单。新生成 = 新 run.id。
          idempotencyKey: run.id,
          ...(hasLocalReference ? { anonymousAssetHostingConsent: 'allow' as const } : {}),
          // S2:catalog 任务各阶段回报 → 节点进度(人话已由 narrate 翻好)。
          onProgress: (progress) => {
            useGenerationCanvasStore.getState().setNodeProgress(id, {
              runId: run.id,
              phase: progress.phase,
              message: progress.message,
              ...(progress.taskId ? { taskId: progress.taskId } : {}),
            })
          },
        })
        break
      } catch (error: unknown) {
        if (attempt >= maxAttempts || !isRetryableGenerationError(error)) {
          throw error
        }
        useGenerationCanvasStore.getState().setNodeProgress(id, {
          runId: run.id,
          phase: 'retrying',
          // 文案走 narrate 注册表(S2 纪律:展示文案不许散落字面量)。
          message: narrateProgress('retrying', { attempt: attempt + 1, maxAttempts }),
        })
        await waitForRetry(attempt, baseDelayMs)
      }
    }
    if (!result) throw new Error('生成失败')
    useGenerationCanvasStore.getState().addNodeResult(id, result)
    // 自动另存（集中设置页开启时）：新生成的图/视频静默复制一份到用户目录。fire-and-forget——不 await
    // （不拖慢生成收尾）、失败不冒泡（best-effort 全在主进程侧，关着/没设目录/失败都静默）。只对新生成，
    // 找回(recoverTaskActions)不触发、避免重复另存。
    if ((result.type === 'image' || result.type === 'video') && (result.url || '').trim()) {
      const title = (useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.title || '').trim()
      void getDesktopBridge()
        ?.assets?.autoSave?.({ url: result.url as string, suggestedName: title || undefined })
        .catch(() => undefined)
    }
    recordModelSuccess(currentNodeModelKey(id))
    useGenerationQueueStore.getState().markSettled(batchId, id, 'success')
    await persistActiveWorkbenchProjectNow().catch(() => {})
    return result
  } catch (error: unknown) {
    // P 轨遮罩取消：用户主动停的，不进红色错误桶也不算模型失败——回 idle 静静结束。
    // 两条路都要兜：① 轮询 tick 主动抛 LocalTaskCancelledError；② 竞态——点取消瞬间轮询恰好
    // 把 /history 的 interrupted 终态拉回来当失败抛（走查实锤），靠 cancelRequested 登记识别。
    if (isLocalTaskCancelledError(error) || isTaskCancelRequested(id)) {
      useGenerationCanvasStore.getState().setNodeStatus(id, 'idle')
      // 用户主动停的：不进刹车计数（模型没挂，是人喊停的）。
      useGenerationQueueStore.getState().markSettled(batchId, id, 'cancelled', { countsTowardBrake: false })
      throw isLocalTaskCancelledError(error) ? error : new LocalTaskCancelledError()
    }
    if (error instanceof AssetUploadConsentCancelledError) {
      useGenerationCanvasStore.getState().setNodeStatus(id, 'idle')
      useGenerationQueueStore.getState().markSettled(batchId, id, 'cancelled', { countsTowardBrake: false })
      throw error
    }
    // 可找回超时：上游可能仍在跑/已出片 → 落 recoverable（不进红色错误桶），给「重新拉取」入口。
    // taskId 已在 run 记录里持久化，recover 动作从节点重建续查（重启后也能拉）。
    // 健康记账也不算失败——上游没有明确判死。
    if (isRecoverableTimeoutError(error)) {
      useGenerationCanvasStore.getState().setNodeStatus(id, 'recoverable', error.message)
      // 上游没有明确判死（可能仍在跑/已出片）→ 健康记账不算失败，刹车也不该算。
      useGenerationQueueStore.getState().markSettled(batchId, id, 'error', {
        error: error.message,
        countsTowardBrake: false,
      })
      throw error
    }
    recordModelFailure(currentNodeModelKey(id))
    // Store the RAW message; the UI (NodeErrorReport) runs classifyGenerationError
    // to show a human reason + hint + the raw detail. Keeping node.error a plain
    // string avoids a persisted-shape migration for existing project files.
    const rawMessage = error instanceof Error && error.message ? error.message : '生成失败'
    useGenerationCanvasStore.getState().setNodeStatus(id, 'error', rawMessage)
    // 真执行失败 → 计入刹车（连续 3 个即暂停队列，防上游整体挂掉时把剩下的额度一路烧完）。
    useGenerationQueueStore.getState().markSettled(batchId, id, 'error', { error: rawMessage })
    throw error
  } finally {
    // 取消登记与活预览帧都是会话瞬态：任务收尾（成/败/取消）一律清，防泄漏到下一次生成。
    clearTaskCancel(id)
    useComfyuiPreviewStore.getState().clearPreview(id)
    // 单发路径的批次由本函数自建，也由本函数收尾（批量路径归 runGenerationNodesByPlan 收）。
    if (ownsBatch) useGenerationQueueStore.getState().finishBatch(batchId)
  }
}

export type RunGenerationNodesBatchOptions = RunGenerationNodeOptions & {
  /** Maximum concurrent runs. Defaults to 6（用户拍板：同一波内尽量并行，框选 6 个镜头能一起跑，
   *  不再一个一个来）。有依赖的镜头仍按波次串行（锚先于镜头），这只调「同波内同时几个」。上限 8。 */
  concurrency?: number
  /** Called whenever a node finishes (success or failure) so the UI can update progress. */
  onNodeResult?: (
    event: { ok: true; nodeId: string; result: GenerationNodeResult } | { ok: false; nodeId: string; error: Error },
  ) => void
}

export type RunGenerationNodesBatchResult = {
  totalCount: number
  successes: Array<{ nodeId: string; result: GenerationNodeResult }>
  failures: Array<{ nodeId: string; error: Error }>
}

function normalizeConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 6
  return Math.max(1, Math.min(8, Math.floor(value)))
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
  const concurrency = normalizeConcurrency(options.concurrency)
  const successes: RunGenerationNodesBatchResult['successes'] = []
  const failures: RunGenerationNodesBatchResult['failures'] = []
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
        const result = await runGenerationNode(nodeId, {
          executor: options.executor,
          retry: options.retry,
          // 整批共用一个托管决定：批量确认卡对整批问了一次（batchPlanPreview），别在波次里逐个再问。
          assetUploadConsent: options.assetUploadConsent,
          ...(options.grantId ? { grantId: options.grantId } : {}),
          ...(options.batchId ? { batchId: options.batchId } : {}),
        })
        successes.push({ nodeId, result })
        options.onNodeResult?.({ ok: true, nodeId, result })
      } catch (error: unknown) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        failures.push({ nodeId, error: normalizedError })
        options.onNodeResult?.({ ok: false, nodeId, error: normalizedError })
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
  await Promise.all(workers)
  return { totalCount: queue.length, successes, failures }
}

/**
 * 按拓扑波次执行批量生成(harness S2b,替代平铺 FIFO 的入口):
 * - 波内并行(沿用 runGenerationNodesBatch 的并发池/重试语义);
 * - 波间串行:依赖节点等到上游真完成才开跑——参考图不再"没出来就裸跑";
 * - blocked(上游缺果/环)与"上游本批失败"的下游 → **显式失败**,人话原因,可单独重试。
 *
 * @legacy-batch-frozen (P4 S7)：见下方 runGenerationNodesBatch 的冻结纪律——本函数是波次编排层，
 * 同样冻结、不加新功能。新批量能力走语义调度器。
 */
export async function runGenerationNodesByPlan(
  plan: DependencyWavePlan,
  options: RunGenerationNodesBatchOptions,
): Promise<RunGenerationNodesBatchResult> {
  const successes: RunGenerationNodesBatchResult['successes'] = []
  const failures: RunGenerationNodesBatchResult['failures'] = []
  // 整批一次登记（含后续波次 + 被拦下的）——「排队可见」的全部秘密：等 worker 空位的、等上游的，
  // 从这一刻起就在任务中心里有名有姓，而不是像以前那样在 store 里still idle、看着像没被选中。
  const batchId = useGenerationQueueStore
    .getState()
    .enqueueBatch([...plan.waves, plan.blocked.map((blocked) => blocked.nodeId)])
  const runOptions: RunGenerationNodesBatchOptions = { ...options, batchId }
  const failNode = (nodeId: string, message: string) => {
    const error = new Error(message)
    useGenerationCanvasStore.getState().setNodeStatus(nodeId, 'error', message)
    // 「上游缺果/成环」与「上游本批失败的连带」都不是模型挂了 → 不进刹车计数，否则一个上游失败
    // 会把下游连锁标失败、瞬间凑满 3 个，误停整条队列。
    useGenerationQueueStore.getState().markSettled(batchId, nodeId, 'error', { error: message, countsTowardBrake: false })
    failures.push({ nodeId, error })
    options.onNodeResult?.({ ok: false, nodeId, error })
  }
  // 等待态不许穿红衣（F15）：`unfrozen-anchor`（等定妆）与 `missing-upstream`（等上游出图）不是「失败」，
  // 是「在等一个还没做的前置」——红色错误卡只留给真失败（provider 报错）/结构错误（环）。这类：节点**留在 idle**
  // （不画红错误卡）、队列条目记 `cancelled`（已结算、零扣费、不进刹车、不进「重试失败」），原因由确认条 +
  // 完成汇总 notice 带可点下一步说清（去定妆 / 去生成上游）。retry 会再次被人话拦下，不静默、也不误当失败。
  const waitNode = (nodeId: string) => {
    useGenerationCanvasStore.getState().setNodeStatus(nodeId, 'idle')
    useGenerationQueueStore.getState().markSettled(batchId, nodeId, 'cancelled', { countsTowardBrake: false })
  }
  const isWaitingReason = (reason: DependencyWavePlan['blocked'][number]['reason']): boolean =>
    reason === 'unfrozen-anchor' || reason === 'missing-upstream'
  for (const blocked of plan.blocked) {
    if (isWaitingReason(blocked.reason)) waitNode(blocked.nodeId)
    else failNode(blocked.nodeId, blocked.detail) // cycle 等结构错误 = 真失败桶（红），可单独处理
  }

  const plannedIds = new Set(plan.waves.flat())
  const internalDeps = new Map<string, string[]>()
  for (const edge of plan.edgesUsed) {
    if (!plannedIds.has(edge.source) || !plannedIds.has(edge.target)) continue
    internalDeps.set(edge.target, [...(internalDeps.get(edge.target) ?? []), edge.source])
  }

  const failedIds = new Set(plan.blocked.map((blocked) => blocked.nodeId))
  for (const wave of plan.waves) {
    // 上游本批失败 → 下游显式失败(不裸跑、不死等),其余照常并行。
    const runnable: string[] = []
    for (const nodeId of wave) {
      const failedDep = (internalDeps.get(nodeId) ?? []).find((dep) => failedIds.has(dep))
      if (failedDep) {
        failedIds.add(nodeId)
        const depTitle =
          useGenerationCanvasStore.getState().nodes.find((node) => node.id === failedDep)?.title || failedDep
        failNode(nodeId, `上游「${depTitle}」本批生成失败,本节点未执行`)
      } else {
        runnable.push(nodeId)
      }
    }
    if (runnable.length === 0) continue
    const result = await runGenerationNodesBatch(runnable, runOptions)
    successes.push(...result.successes)
    for (const failure of result.failures) {
      failedIds.add(failure.nodeId)
      failures.push(failure)
    }
  }
  // 收尾：批次落终态（面板据此归入「已完成」+ 触发失焦提醒），并修剪历史条目保持内存有界。
  useGenerationQueueStore.getState().finishBatch(batchId)
  return { totalCount: plan.waves.flat().length + plan.blocked.length, successes, failures }
}

/**
 * 单节点生成/重试/生成变体的轻确认 + 铸令牌 + 跑（付费守卫，务实纵深 A1）。
 * rerun=true 是「基于此生成变体」：先复制出新节点再绑令牌跑；普通重新生成走 regenerateNodeInPlace。
 */
export async function confirmAndRunNode(nodeId: string, opts: { rerun?: boolean } = {}): Promise<void> {
  const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === nodeId)
  const hosting = await resolveHostingDisclosure(node)
  if (!hosting.allowed) return
  const ok = await confirmGenerationSpend([node], {
    title: opts.rerun
      ? i18n.t('generationCommon.spend.generateVariant')
      : i18n.t('generationCommon.spend.startGeneration'),
    message: describeGenerationCost(1, node ? spendCostKind(node.kind) : 'image', generationCostContextForNode(node)),
    confirmLabel: opts.rerun
      ? i18n.t('generationCommon.spend.generateVariant')
      : i18n.t('generationCommon.spend.generate'),
    light: true,
    ...(hosting.disclosure ? { hostingDisclosure: hosting.disclosure } : {}),
  })
  if (!ok) return
  let runId = nodeId
  if (opts.rerun) {
    const dup = useGenerationCanvasStore.getState().duplicateNodeForRegeneration(nodeId)
    if (!dup) return
    runId = dup.id
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: dup.id } }))
    }
  }
  let grantId: string
  try {
    grantId = await mintSpendGrant([runId])
  } catch (error) {
    toast(
      error instanceof Error && error.message
        ? error.message
        : i18n.t('generationCommon.batchPlan.authorizationFailed'),
      'error',
    )
    return
  }
  try {
    await runGenerationNode(runId, { grantId, assetUploadConsent: 'allow' })
  } catch {
    // 失败已记在节点上（卡片渲染人话错误），这里不再弹。
  }
}

/**
 * 同一镜头 ×N 变体连发（2026-07-29 批量体检 C，样张拍板）：一次轻确认按 N 张报成本，
 * 随后逐次铸令牌+跑。**串行**——同节点的进度/状态是单通道，并发会互踩；N≤4 体感可接受。
 * 出图走 addNodeResult 既有堆叠（新图设主图、旧图进历史里挑）。中途失败即停：
 * 剩余次数不再扣费（对坏通道不连烧；失败原因已落节点卡片），已出的变体保留。
 */
export async function confirmAndRunNodeVariants(
  nodeId: string,
  count: number,
  // 托管同意由本函数自己的花钱卡问出来（下方固定传 'allow'），调用方给不了也不该给。
  options: Omit<RunGenerationNodeOptions, 'assetUploadConsent'> = {},
): Promise<void> {
  const id = String(nodeId || '').trim()
  if (!id) return
  const total = Math.max(1, Math.min(8, Math.floor(count)))
  const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
  const hosting = await resolveHostingDisclosure(node)
  if (!hosting.allowed) return
  const ok = await confirmGenerationSpend([node], {
    title: i18n.t('generationCommon.spend.startGeneration'),
    message: describeGenerationCost(total, node ? spendCostKind(node.kind) : 'image', generationCostContextForNode(node)),
    confirmLabel: i18n.t('generationCommon.spend.generate'),
    light: true,
    ...(hosting.disclosure ? { hostingDisclosure: hosting.disclosure } : {}),
  })
  if (!ok) return
  for (let index = 0; index < total; index += 1) {
    let grantId: string
    try {
      grantId = await mintSpendGrant([id])
    } catch (error) {
      toast(
        error instanceof Error && error.message
          ? error.message
          : i18n.t('generationCommon.batchPlan.authorizationFailed'),
        'error',
      )
      return
    }
    try {
      const result = await runGenerationNode(id, { ...options, grantId, assetUploadConsent: 'allow' })
      useWorkbenchStore.getState().reconcileTimelineForUpdatedNodes(id, result)
    } catch {
      return // 失败已落节点卡片（人话错误）；停发剩余变体
    }
  }
}

/**
 * In-place 重生成（C0）：同节点重出 —— **不 duplicate、不换 id、不动 shotIndex**。
 * `runGenerationNode` 本就原地（addNodeResult 把新 result 设为 node.result、旧的进 history），
 * 这里加「轻确认 + 铸令牌（不绕付费闸）+ 完成后回填时间轴」。产物贴回原节点后，
 * 时间轴里引用该节点的 clip 走回填闸（位置不变、URL providerUrl 优先、trim 越界夹取）。
 * 与「基于此生成变体」(confirmAndRunNode{rerun} = duplicate) 分流，
 * 别共用一个口子（一个改这一镜、一个长出新镜）。
 */
export async function regenerateNodeInPlace(
  nodeId: string,
  // 确认卡可带调用方的动作名（如分镜表「用新图重跑」）：用户点的是什么，卡上就回声什么，
  // 不让一张通用「重新生成」卡吃掉刚建立的语境（R16 情绪走查：小白在这一步会迟疑
  // 「到底用没用新图」）。缺省仍是「重新生成」，画布 composer 等既有调用方零变化。
  opts?: { title?: string; confirmLabel?: string },
): Promise<void> {
  const id = String(nodeId || '').trim()
  if (!id) return
  const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
  const hosting = await resolveHostingDisclosure(node)
  if (!hosting.allowed) return
  const ok = await confirmGenerationSpend([node], {
    title: opts?.title || i18n.t('generationCommon.composer.regenerate'),
    message: describeGenerationCost(1, node ? spendCostKind(node.kind) : 'image', generationCostContextForNode(node)),
    confirmLabel: opts?.confirmLabel || i18n.t('generationCommon.composer.regenerate'),
    light: true,
    ...(hosting.disclosure ? { hostingDisclosure: hosting.disclosure } : {}),
  })
  if (!ok) return
  let grantId: string
  try {
    grantId = await mintSpendGrant([id])
  } catch (error) {
    toast(
      error instanceof Error && error.message
        ? error.message
        : i18n.t('generationCommon.batchPlan.authorizationFailed'),
      'error',
    )
    return
  }
  try {
    const result = await runGenerationNode(id, { grantId, assetUploadConsent: 'allow' })
    useWorkbenchStore.getState().reconcileTimelineForUpdatedNodes(id, result)
  } catch {
    // 失败已记在节点卡片（人话错误），不再弹。
  }
}

export function canRunGenerationNode(
  node: GenerationCanvasNode | Pick<GenerationCanvasNode, 'kind'> | null | undefined,
  context: GenerationRunContext = {},
): boolean {
  if (!node) return false
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
    const imageMode = imageArchetype ? currentArchetypeMode(imageArchetype, meta) : null
    if (!imageArchetype || !imageMode || imageMode.transportTaskKind !== 'image_edit' || (imageMode.slots || []).length === 0) return true
    const references = resolveGenerationReferences(node, context)
    return hasAnyArchetypeReference(meta, imageArchetype, references)
  }
  // C5: 文本节点只要选了文本模型就能生成；prompt 缺失由 buildCatalogTaskRequest 兜底报错。
  if (executionKind === 'text') return true
  // 声音：配音(台词缺失下游兜底，同 text 可生成)；转写需先有音频参考(audio_ref 槽)。
  if (executionKind === 'audio') {
    if (!('meta' in node)) return true
    const meta = node.meta || {}
    const audioArchetype = resolveTaskArchetype(meta)
    const mode = audioArchetype ? currentArchetypeMode(audioArchetype, meta) : null
    const needsAudioRef = (mode?.slots || []).some((slot) => slot.kind === 'audio_ref')
    if (!needsAudioRef) return true
    // 连线来源也算（今天没有音频源节点种类，SLOT_ACCEPTS.audio_ref=[]，故实际恒空）——口径与另两支一致，
    // 将来加了音频节点不必再想起来补这一处。
    const audioReferences = 'id' in node && node.id ? resolveGenerationReferences(node, context) : undefined
    return Boolean(audioArchetype && hasAnyArchetypeReference(meta, audioArchetype, audioReferences))
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
  const mode = currentArchetypeMode(archetype, meta)
  if ((mode.slots || []).length === 0) return true
  // 有参考槽的模式（i2v/首尾帧/全能参考 omni/视频编辑）→ 需至少一个参考。判据统一交给
  // hasAnyArchetypeReference：它遍历**本模式声明的槽**，每个槽同时看「画布边」和「meta 手动上传」，
  // 与显示（resolveReferenceSlots）、发送（buildArchetypeInputParams）同一口径。
  // 此前这里是一串就地展开的 OR，每加一种槽都得记得再补一条 → 漏了连线参考视频、尾帧接力、
  // 源视频三处，用户明明连了线、缩略图也显示着，↑ 按钮却死着（2026-08-20 用户反馈 + 不变量测试）。
  const references = resolveGenerationReferences(node, context)
  if (!hasAnyArchetypeReference(meta, archetype, references)) return false
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
  return nodeUnmetReferenceDependency(meta, resolveTaskArchetype(meta), resolveGenerationReferences(node, context))
}
