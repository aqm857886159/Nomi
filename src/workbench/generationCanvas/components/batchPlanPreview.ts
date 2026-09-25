import { declareStoreLifetime } from '../../project/storeLifetime'
// 批量执行计划预览态(harness S2b,样张方案 A:画布原位确认)。
// 语义铁律:进入预览 ≠ 开始生成——确认前零 vendor 调用零扣费;取消即散,画布零变化。
import { create } from 'zustand'
import { reportCanvasFeedback } from './canvasFeedback'
import { notify, revealNotificationTarget } from '../../../ui/notificationPolicy'
import { isProjectExecutionContextCurrent, isProjectOpen, withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { captureApprovedGenerationInputs, type RunGraph, type RunProjectTarget } from '../runner/runProjectDelivery'
import { spendCostKindForNodes, type GenerationConfirmationGuards } from '../runner/generationRunController'
import { runGenerationNodesByPlan } from '../runner/generationRunWaves'
import { confirmAndMintGrant, describeGenerationCost, generationCostContextForNodes } from '../spend/spendConfirm'
import { hasLocalAssetReference, resolveAssetUploadConsent } from '../runner/assetUploadConsent'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'
import { buildDependencyWaves, type DependencyWavePlan } from '../runner/dependencyWaves'
import type { GenerationRunOutcome } from '../runner/generationRunOutcome'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { verifyShotsAndReport } from '../agent/shotVerifyStore'
import { resolveShotIdentities } from '../model/shotNumbering'
import i18n from '../../../i18n'
import { normalizeCanvasBatchConcurrency } from './canvasProductionScope'

export const BATCH_RUN_TOAST_ID = 'canvas-batch-run'

type BatchPlanPreviewState = {
  plan: DependencyWavePlan | null
  running: boolean
  open: (plan: DependencyWavePlan) => void
  cancel: () => void
  confirm: () => Promise<void>
}

export const useBatchPlanPreviewStore = create<BatchPlanPreviewState>()((set, get) => ({
  plan: null,
  running: false,
  open: (plan) => set({ plan, running: false }),
  cancel: () => set({ plan: null, running: false }),
  confirm: async () => {
    const { plan, running } = get()
    if (!plan || running) return
    const projectId = withProjectAction((project) => project.binding.projectId) ?? ''
    set({ running: true })
    try {
      await confirmAndRunPlan(plan)
      set({ plan: null })
    } catch (error: unknown) {
      reportCanvasFeedback(
        error instanceof Error && error.message
          ? error.message
          : i18n.t('generationCommon.batchPlan.authorizationFailed'),
        'error',
        { projectId, identity: `batch-plan:${plan.waves.flat().slice().sort().join(':')}`, reason: 'authorization', nodeIds: plan.waves.flat() },
      )
      return
    } finally {
      set({ running: false })
    }
  },
}))

/**
 * 被拦下的节点(上游参考没生成 / 循环) → 人话提示文案；无 blocked 返回 null。
 * 「缺啥提示啥」：不再把 blocked 算进总数静默丢，而是明确告诉用户哪些没跑、为什么、怎么办。
 */
export function describeBlockedNotice(plan: DependencyWavePlan): string | null {
  if (plan.blocked.length === 0) return null
  const cycle = plan.blocked.filter((b) => b.reason === 'cycle').length
  const unfrozen = plan.blocked.filter((b) => b.reason === 'unfrozen-anchor').length
  // 「缺啥提示啥」：未冻结与「上游没生成」是不同原因（前者去卡上点「冻结」，后者要先生成上游），分开报。
  const waiting = plan.blocked.length - cycle - unfrozen
  const parts: string[] = []
  if (waiting > 0) parts.push(i18n.t('generationCommon.batchPlan.waitingUpstream', { count: waiting }))
  if (unfrozen > 0) parts.push(i18n.t('generationCommon.batchPlan.unfrozenAnchors', { count: unfrozen }))
  if (cycle > 0) parts.push(i18n.t('generationCommon.batchPlan.cyclicReferences', { count: cycle }))
  return i18n.t('generationCommon.batchPlan.blockedNotice', {
    details: parts.join(i18n.t('generationCommon.batchPlan.detailSeparator')),
  })
}

/**
 * 一批节点的托管解析：整批只问一次（有一个节点需要披露，整批就带上披露块）。
 * 返回 null = 策略 deny，这批直接不跑。
 */
async function resolveBatchHosting(ids: string[]): Promise<Awaited<ReturnType<typeof resolveAssetUploadConsent>> | null> {
  const canvasState = useGenerationCanvasStore.getState()
  const nodesById = new Map(canvasState.nodes.map((n) => [n.id, n]))
  const consentNodes = ids
    .map((id) => nodesById.get(id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .map((node) => {
      const resolved = resolveGenerationReferences(node, { nodes: canvasState.nodes, edges: canvasState.edges })
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
    })
  let hosting: Awaited<ReturnType<typeof resolveAssetUploadConsent>> = { allowed: true, needsConfirmation: false, remember: async () => {} }
  for (const node of consentNodes.filter((candidate) => hasLocalAssetReference(candidate))) {
    const resolution = await resolveAssetUploadConsent(node)
    if (!resolution.allowed) return null
    if (resolution.needsConfirmation && !hosting.needsConfirmation) hosting = resolution
  }
  return hosting
}

/** 解析结果 → 花钱卡要不要带披露块。needsConfirmation 时才给，否则整块不渲染。 */
function hostingDisclosureFor(
  hosting: Awaited<ReturnType<typeof resolveAssetUploadConsent>>,
): { hostingDisclosure: { message: string; rememberLabel: string; onRemember: () => Promise<void> } } | Record<string, never> {
  if (!hosting.needsConfirmation) return {}
  return {
    hostingDisclosure: {
      message: i18n.t('generationCommon.spendHostingDisclosure.message'),
      rememberLabel: i18n.t('generationCommon.spendHostingDisclosure.remember'),
      onRemember: hosting.remember,
    },
  }
}

/**
 * 用户直发批量（框选「生成 N 个」）：轻确认 + 铸令牌 + 跑。取消则零调用零扣费。
 * 抽到此处而非内联进 GenerationCanvas（巨壳 800 行顶格，不喂）。
 */
export async function confirmAndRunPlan(
  plan: DependencyWavePlan,
  options: { concurrency?: number } & GenerationConfirmationGuards = {},
): Promise<GenerationRunOutcome> {
  // 点「生成」即动作起点：签发此刻打开的项目。提交前换了项目 = 取消（没花钱）；提交后整批归原项目。
  const project = withProjectAction((issued) => issued)
  if (!project) return 'unavailable'
  const ids = plan.waves.flat()
  if (ids.length === 0) {
    // 无可跑 → 复用人话 toast 报「为什么不能跑」。零节点也就没有素材要上传。
    await runPlanWithToasts(plan, { assetUploadConsent: 'not-needed', project })
    return 'nothing-to-run'
  }
  const assertApprovedInputs = captureApprovedGenerationInputs(ids)
  const nodesById = new Map(useGenerationCanvasStore.getState().nodes.map((n) => [n.id, n]))
  const hosting = await resolveBatchHosting(ids)
  // 素材托管那张披露卡也是一次「他没同意这次」，不是一个错误。
  if (!hosting) return 'declined'
  const grantId = await confirmAndMintGrant({
    assertCurrent: async () => { await options.assertCurrent?.(); project.assertCurrent() },
    nodeIds: ids,
    nodes: ids.map((id) => nodesById.get(id)),
    ...(options.initiator ? { initiator: options.initiator } : {}),
    title: i18n.t('generationCommon.batchPlan.startTitle'),
    message: describeGenerationCost(ids.length, spendCostKindForNodes(ids), {
      ...generationCostContextForNodes(ids.map((id) => nodesById.get(id)), project.binding.projectId),
      concurrency: normalizeCanvasBatchConcurrency(options.concurrency),
      waveSizes: plan.waves.map((wave) => wave.length),
    }),
    confirmLabel: i18n.t('generationCommon.batchPlan.confirmGenerate'),
    ...hostingDisclosureFor(hosting),
  })
  // **这一行就是那个结局**：2026-09-22 之前它是一个裸 `return`，Agent 那一侧因此读不到
  // 「他点了取消」，`generate` 只好报 `generation_approval_unavailable`（见 `generationRunOutcome.ts`）。
  if (!grantId) return 'declined'
  await options.assertCurrent?.()
  if (!isProjectExecutionContextCurrent(project)) return 'unavailable'
  await runPlanWithToasts(plan, {
    project,
    assertAuthorCurrent: options.assertAuthorCurrent,
    assertApprovedInputs,
    grantId,
    concurrency: options.concurrency,
    // 用户刚在上面那张卡里同意了（或判定无需问）——决定在这里定死，波次里不再问第二次。
    assetUploadConsent: hosting.needsConfirmation ? 'allow' : 'not-needed',
  })
  return 'started'
}

/** 按计划真实生成 + 可行动的失败反馈。「全部生成」与 S6b agent 受理路径共用(单一执行口)。
 * grantId：付费守卫令牌（确认后铸），随 plan 下到每个节点的 request.extras 供主进程核验。 */
export async function runPlanWithToasts(
  plan: DependencyWavePlan,
  // assetUploadConsent 必填：整批的托管同意在上面那张批量花钱卡里问过了，这里只是把答案带下去。
  // 缺省会让 runner 无从判断「谁问的用户」，那正是 F16b 第二张卡的来源。
  options: { assertAuthorCurrent?: () => Promise<void>; assertApprovedInputs?: (graph: RunGraph, executingNodeId: string) => void; grantId?: string; concurrency?: number; assetUploadConsent: 'allow' | 'not-needed'; project: ProjectExecutionContext },
): Promise<void> {
  // 运行属于发起它的项目：身份（target）在这里定死，之后用户切项目也照样落回原项目。
  const target: RunProjectTarget = options.project.binding
  const projectId = target.projectId
  const waves = plan.waves
  const runnable = waves.flat().length
  const notice = describeBlockedNotice(plan)
  if (runnable === 0) {
    // 全被拦：别静默，说清原因
    reportCanvasFeedback(
      notice
        ? i18n.t('generationCommon.batchPlan.unavailable', { notice })
        : i18n.t('generationCommon.batchPlan.noRunnableNodes'),
      'error',
      { projectId, identity: `batch-plan:${plan.blocked.map((item) => item.nodeId).sort().join(':')}`, reason: 'unavailable', nodeIds: plan.blocked.map((item) => item.nodeId) },
    )
    return
  }
  // Progress is already projected by nodes and the task center. Each paid run owns
  // its recovery action; unrelated batches must not overwrite one global slot.
  const notificationId = `${BATCH_RUN_TOAST_ID}:${projectId}:${options.grantId ?? waves.flat().slice().sort().map(encodeURIComponent).join(':')}`
  try {
    const result = await runGenerationNodesByPlan(plan, {
      assertAuthorCurrent: options.assertAuthorCurrent,
      assertApprovedInputs: options.assertApprovedInputs,
      assetUploadConsent: options.assetUploadConsent,
      target,
      ...(options.grantId ? { grantId: options.grantId } : {}),
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    })
    const okCount = result.successes.length
    const failCount = result.failures.length
    // 完成汇总：把「还有谁没跑、为什么」(notice) 并进同一条，不再跑完补弹第二条（消除连环弹，弹窗审计）。
    const tail = notice ? i18n.t('generationCommon.batchPlan.blockedTail', { notice }) : ''
    if (failCount === 0) {
      if (notice) notify({
        identity: notificationId,
        reason: 'blocked-nodes',
        level: 'background',
        message: i18n.t('generationCommon.batchPlan.completed', { count: okCount, tail }),
        type: 'warning',
        actionLabel: i18n.t('taskCenter.title'),
        onAction: () => { void revealNotificationTarget({ projectId, taskCenter: true }) },
      })
    } else {
      // 失败汇总挂「重试失败的 N 个」一键动作（样张拍板 2026-07-29）：只对失败节点重建依赖波次
      // → 重新轻确认（新令牌，不绕付费闸）→ 并发重跑；成功的不重付。上游仍缺果的会再次被
      // 人话拦下（describeBlockedNotice），不静默。ttl 放宽到 12s 给动作留点击窗口。
      const failureIds = result.failures.map((failure) => failure.nodeId)
      const message =
        okCount === 0
          ? i18n.t('generationCommon.batchPlan.failed', { count: failCount, tail })
          : i18n.t('generationCommon.batchPlan.partiallyCompleted', { successes: okCount, failures: failCount, tail })
      notify({
        identity: notificationId,
        reason: 'generation-failed',
        level: 'background',
        message,
        type: okCount === 0 ? 'error' : 'warning',
        actionLabel: i18n.t('generationCommon.batchPlan.retryFailed', { count: failCount }),
        onAction: async () => {
          if (!isProjectOpen(projectId) && !(await revealNotificationTarget({ projectId, workspaceMode: 'generation' }))) return
          if (!isProjectOpen(projectId)) return
          const state = useGenerationCanvasStore.getState()
          void confirmAndRunPlan(
            buildDependencyWaves(failureIds, { nodes: state.nodes, edges: state.edges }),
            options.assertAuthorCurrent ? { concurrency: options.concurrency, assertCurrent: options.assertAuthorCurrent, assertAuthorCurrent: options.assertAuthorCurrent } : { concurrency: options.concurrency },
          )
        },
      })
    }
    // Stage 1:生成完成 → 对成功的镜头/首帧(共享身份判据,排除锚卡)跑画面校验(fire-and-forget,
    // 不阻塞完成 toast;verify 失败静默,绝不把生成完成拖红)。
    // 审片只给仍在前台的原项目：发起动作的项目生命周期还在（切走再切回 A→B→A 不复活）。
    if (okCount > 0 && isProjectExecutionContextCurrent(options.project)) {
      const { nodes, edges } = useGenerationCanvasStore.getState()
      const identities = resolveShotIdentities(nodes, edges)
      const shotIds = result.successes
        .map((s) => s.nodeId)
        .filter((id) => identities.has(id))
      if (shotIds.length > 0) void verifyShotsAndReport(shotIds, options.project)
    }
  } catch (error: unknown) {
    notify({
      identity: notificationId,
      reason: 'runner-failed',
      level: 'background',
      actionLabel: i18n.t('taskCenter.title'),
      onAction: () => { void revealNotificationTarget({ projectId, taskCenter: true }) },
      message: error instanceof Error && error.message ? error.message : i18n.t('generationCommon.batchPlan.exception'),
      type: 'error',
    })
  }
}

/**
 * C1 寿命声明：批量计划预览是这个项目画布上的一次待确认动作。
 * `running` 尤其不能留——切过去看到一个「正在跑」而其实什么都没跑。
 */
export const batchPlanPreviewStoreLifetime = declareStoreLifetime({
  store: 'useBatchPlanPreviewStore',
  fields: { plan: 'project', running: 'project' },
  releaseProject: () => useBatchPlanPreviewStore.setState({ plan: null, running: false }),
})
