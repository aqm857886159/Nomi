// 批量执行计划预览态(harness S2b,样张方案 A:画布原位确认)。
// 语义铁律:进入预览 ≠ 开始生成——确认前零 vendor 调用零扣费;取消即散,画布零变化。
import { create } from 'zustand'
import { toast, useToastStore } from '../../../ui/toast'
import { runGenerationNodesByPlan, spendCostKindForNodes } from '../runner/generationRunController'
import { mintSpendGrant } from '../../api/taskApi'
import { confirmAndMintGrant, confirmGenerationSpend, describeGenerationCost, generationCostContextForNodes } from '../spend/spendConfirm'
import { hasLocalAssetReference, resolveAssetUploadConsent } from '../runner/assetUploadConsent'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'
import { buildDependencyWaves, type DependencyWavePlan } from '../runner/dependencyWaves'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { verifyShotsAndReport } from '../agent/shotVerifyStore'
import i18n from '../../../i18n'

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
    set({ running: true })
    // 计划 overlay 的「按计划生成」点击本身 = 真人手势 → 铸付费令牌（绑本批节点）。
    let grantId: string
    try {
      grantId = await mintSpendGrant(plan.waves.flat())
    } catch (error) {
      set({ running: false })
      toast(
        error instanceof Error && error.message
          ? error.message
          : i18n.t('generationCommon.batchPlan.authorizationFailed'),
        'error',
      )
      return
    }
    set({ plan: null, running: false })
    // 计划 overlay 走的是 confirmAndRunPlan 之外的一条真人手势路径：托管同意同样必须先解析出来
    // （策略/KIE 判定 → 需要问就带披露块弹卡），不能省略成「让 runner 自己弹第二张」。
    const consent = await confirmPlanHostingConsent(plan.waves.flat())
    if (!consent) return
    await runPlanWithToasts(plan, { grantId, assetUploadConsent: consent })
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
 * 计划 overlay 的托管确认：这条路径的付费令牌在点「按计划生成」时就铸好了，
 * 所以披露必须自己弹一次（同一张 SpendConfirmDialog，只是这次只承载托管披露）。
 * 返回 null = 用户拒绝或策略 deny → 这批不跑。
 */
async function confirmPlanHostingConsent(ids: string[]): Promise<'allow' | 'not-needed' | null> {
  const hosting = await resolveBatchHosting(ids)
  if (!hosting) return null
  if (!hosting.needsConfirmation) return 'not-needed'
  const ok = await confirmGenerationSpend(
    ids.map((id) => useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)),
    {
      title: i18n.t('generationCommon.batchPlan.startTitle'),
      message: describeGenerationCost(ids.length, spendCostKindForNodes(ids), generationCostContextForNodes(ids.map((id) => useGenerationCanvasStore.getState().nodes.find((node) => node.id)))),
      confirmLabel: i18n.t('generationCommon.batchPlan.confirmGenerate'),
      light: true,
      ...hostingDisclosureFor(hosting),
    },
  )
  return ok ? 'allow' : null
}

/**
 * 用户直发批量（框选「生成 N 个」）：轻确认 + 铸令牌 + 跑。取消则零调用零扣费。
 * 抽到此处而非内联进 GenerationCanvas（巨壳 800 行顶格，不喂）。
 */
export async function confirmAndRunPlan(
  plan: DependencyWavePlan,
  options: { concurrency?: number } = {},
): Promise<void> {
  const ids = plan.waves.flat()
  if (ids.length === 0) {
    // 无可跑 → 复用人话 toast 报「为什么不能跑」。零节点也就没有素材要上传。
    await runPlanWithToasts(plan, { assetUploadConsent: 'not-needed' })
    return
  }
  const nodesById = new Map(useGenerationCanvasStore.getState().nodes.map((n) => [n.id, n]))
  const hosting = await resolveBatchHosting(ids)
  if (!hosting) return
  const grantId = await confirmAndMintGrant({
    nodeIds: ids,
    nodes: ids.map((id) => nodesById.get(id)),
    title: i18n.t('generationCommon.batchPlan.startTitle'),
    message: describeGenerationCost(ids.length, spendCostKindForNodes(ids), generationCostContextForNodes(ids.map((id) => nodesById.get(id)))),
    confirmLabel: i18n.t('generationCommon.batchPlan.confirmGenerate'),
    light: true,
    ...hostingDisclosureFor(hosting),
  })
  if (!grantId) return
  await runPlanWithToasts(plan, {
    grantId,
    concurrency: options.concurrency,
    // 用户刚在上面那张卡里同意了（或判定无需问）——决定在这里定死，波次里不再问第二次。
    assetUploadConsent: hosting.needsConfirmation ? 'allow' : 'not-needed',
  })
}

/** 按计划真实生成 + 进度人话 toast。「全部生成」与 S6b agent 受理路径共用(单一执行口)。
 * grantId：付费守卫令牌（确认后铸），随 plan 下到每个节点的 request.extras 供主进程核验。 */
export async function runPlanWithToasts(
  plan: DependencyWavePlan,
  // assetUploadConsent 必填：整批的托管同意在上面那张批量花钱卡里问过了，这里只是把答案带下去。
  // 缺省会让 runner 无从判断「谁问的用户」，那正是 F16b 第二张卡的来源。
  options: { grantId?: string; concurrency?: number; assetUploadConsent: 'allow' | 'not-needed' },
): Promise<void> {
  const waves = plan.waves
  const runnable = waves.flat().length
  const notice = describeBlockedNotice(plan)
  if (runnable === 0) {
    // 全被拦：别静默，说清原因
    toast(
      notice
        ? i18n.t('generationCommon.batchPlan.unavailable', { notice })
        : i18n.t('generationCommon.batchPlan.noRunnableNodes'),
      'error',
    )
    return
  }
  // 启动反馈（用户强调）：有依赖（多波）= 不是全并发，要先生成上游参考、再生成下游镜头。说清楚，
  // 否则用户以为"只跑一个/卡住了"。单波则直接并发（并发上限 6）。
  const firstWave = waves[0].length
  const startMsg =
    waves.length > 1
      ? i18n.t('generationCommon.batchPlan.multiWaveStart', {
          waves: waves.length,
          count: runnable,
          firstWave,
          remaining: runnable - firstWave,
        })
      : i18n.t('generationCommon.batchPlan.start', { count: runnable })
  useToastStore.getState().push({
    id: BATCH_RUN_TOAST_ID,
    message: startMsg,
    type: 'info',
    ttl: false,
    dismissible: true,
  })
  try {
    const result = await runGenerationNodesByPlan(plan, {
      assetUploadConsent: options.assetUploadConsent,
      ...(options.grantId ? { grantId: options.grantId } : {}),
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    })
    const okCount = result.successes.length
    const failCount = result.failures.length
    // 完成汇总：把「还有谁没跑、为什么」(notice) 并进同一条，不再跑完补弹第二条（消除连环弹，弹窗审计）。
    const tail = notice ? i18n.t('generationCommon.batchPlan.blockedTail', { notice }) : ''
    if (failCount === 0) {
      useToastStore.getState().push({
        id: BATCH_RUN_TOAST_ID,
        message: i18n.t('generationCommon.batchPlan.completed', { count: okCount, tail }),
        type: notice ? 'warning' : 'success',
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
      useToastStore.getState().push({
        id: BATCH_RUN_TOAST_ID,
        message,
        type: okCount === 0 ? 'error' : 'warning',
        ttl: 12_000,
        actionLabel: i18n.t('generationCommon.batchPlan.retryFailed', { count: failCount }),
        onAction: () => {
          const state = useGenerationCanvasStore.getState()
          void confirmAndRunPlan(
            buildDependencyWaves(failureIds, { nodes: state.nodes, edges: state.edges }),
            { concurrency: options.concurrency },
          )
        },
      })
    }
    // Stage 1:生成完成 → 对成功的「镜头」节点(有 shotIndex,排除锚卡)跑画面校验(fire-and-forget,
    // 不阻塞完成 toast;verify 失败静默,绝不把生成完成拖红)。
    if (okCount > 0) {
      const nodes = useGenerationCanvasStore.getState().nodes
      const shotIds = result.successes
        .map((s) => s.nodeId)
        .filter((id) => typeof nodes.find((n) => n.id === id)?.shotIndex === 'number')
      if (shotIds.length > 0) void verifyShotsAndReport(shotIds)
    }
  } catch (error: unknown) {
    useToastStore.getState().push({
      id: BATCH_RUN_TOAST_ID,
      message: error instanceof Error && error.message ? error.message : i18n.t('generationCommon.batchPlan.exception'),
      type: 'error',
    })
  }
}
