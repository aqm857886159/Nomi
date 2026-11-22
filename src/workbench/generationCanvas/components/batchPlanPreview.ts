import { paidNodeLedger, spendCostKind, spendCostKindForNodes } from '../spend/spendConfirm'
import { classifyGenerationError } from '../../observability/classifyError'
import { generationFailureActions } from '../../observability/generationFailureActions'
import { declareStoreLifetime } from '../../project/storeLifetime'
// 批量执行计划预览态(harness S2b,样张方案 A:画布原位确认)。
// 语义铁律:进入预览 ≠ 开始生成——确认前零 vendor 调用零扣费;取消即散,画布零变化。
import { create } from 'zustand'
import { reportCanvasFeedback } from './canvasFeedback'
import { notify, revealNotificationTarget } from '../../../ui/notificationPolicy'
import { isProjectExecutionContextCurrent, isProjectOpen, withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { captureApprovedGenerationInputs, type RunGraph, type RunProjectTarget } from '../runner/runProjectDelivery'
import { type GenerationConfirmationGuards } from '../runner/generationRunController'
import { runGenerationNodesByPlan } from '../runner/generationRunWaves'
import { confirmGenerationSpend, describeGenerationCost, generationCostContextForNodes, withGenerationEtaStats } from '../spend/spendConfirm'
import { canvasOpenRuns, consentCanvasShots, withdrawCanvasShots, type CanvasConsentShot } from '../../api/taskApi'
import { selectedModelKey, selectedVendor } from '../runner/catalogTaskResolve'
import { createRunId } from '../store/canvasIds'
import { narrowGenerationScope, type GenerationScopePlan } from '../../../../electron/shared/agentCapabilities/generationShotScope'
import { planCanvasGenerationScope, scopeFactsOf, type ScopeGraph } from '../runner/generationScopeFacts'
import type { GenerationRunOutcome } from '../runner/generationRunOutcome'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import i18n from '../../../i18n'
import { normalizeCanvasBatchConcurrency } from './canvasProductionScope'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { PlanRow } from '../../shared/PlanRows'

/** 逐项勾选的批量：候选行（id = 节点 id）。默认勾哪些、哪些锁住由调用方在行里写好；确认后按用户勾的重建执行计划。 */
export type ItemizedBatch = { rows: readonly PlanRow[] }

export const BATCH_RUN_TOAST_ID = 'canvas-batch-run'

export type DeferredStoryboardPlan = {
  draftNodes: readonly GenerationCanvasNode[]
  materialize: () => Promise<GenerationScopePlan>
}

type BatchPlanPreviewState = {
  plan: GenerationScopePlan | null
  running: boolean
  open: (plan: GenerationScopePlan) => void
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
      await confirmAndRunPlan(plan, { initiator: 'user' })
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
export function describeBlockedNotice(plan: Pick<GenerationScopePlan, 'blocked'>): string | null {
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
 * 卡上点了确认之后，把这一批里要花钱的每一个节点在主进程开一份出价（一镜一个单镜 Run，出价开着 = 这一镜他同意了）。
 * 不花钱的本地 / 文本节点不在里面。返回节点 → 运行记录号与主进程的 Run 号；一个要花钱的都没有时都是空的。
 */
async function consentPaidNodes(ids: readonly string[], projectId: string): Promise<{ recordIds: Map<string, string>; runIds: string[] }> {
  const nodesById = new Map(useGenerationCanvasStore.getState().nodes.map((n) => [n.id, n]))
  const shots: CanvasConsentShot[] = []
  for (const id of ids) {
    const node = nodesById.get(id)
    if (!node || paidNodeLedger(node) !== 'run') continue
    shots.push({ nodeId: id, runRecordId: createRunId(id), vendor: selectedVendor(node), modelKey: selectedModelKey(node), kind: node.kind })
  }
  if (shots.length === 0) return { recordIds: new Map(), runIds: [] }
  const runIds = await consentCanvasShots({ projectId, shots })
  return { recordIds: new Map(shots.map((shot) => [shot.nodeId, shot.runRecordId])), runIds }
}

/**
 * 用户直发批量（框选「生成 N 个」）：轻确认 + 卡上这一批开出价 + 跑。取消则零调用零扣费。
 * 一张批量卡 = 一份授权，盖住卡上列出的节点（发动机收敛第一刀第 3 步）：点了确认，主进程为其中要花钱的每一个节点
 * 开一份出价；排队里被去掉的、整批 × 掉的，主进程收回出价、再也交不出去。
 * 抽到此处而非内联进 GenerationCanvas（巨壳 800 行顶格，不喂）。
 *
 * `onConsented`：出价开好、开始跑的那一刻回调一次（Agent 对文稿方案的 `generate` 据此当场交回，不等整批跑完）。
 */
export async function confirmAndRunPlan(
  plan: GenerationScopePlan,
  options: { filterBeforeEnqueue?: (nodeIds: string[]) => string[]; concurrency?: number; onConsented?: (runIds: string[]) => void; /** A storyboard batch already showed its checklist before materialization. */ skipSpendConfirmation?: boolean; deferredMaterialization?: DeferredStoryboardPlan; /** 同一张付费确认里按项勾选（画布组框与列表分区头「生成全部」）。 */ itemized?: ItemizedBatch } & GenerationConfirmationGuards,
): Promise<GenerationRunOutcome> {
  // 点「生成」即动作起点：签发此刻打开的项目。提交前换了项目 = 取消（没花钱）；提交后整批归原项目。
  const project = withProjectAction((issued) => issued)
  if (!project) return 'unavailable'
  const deferred = options.deferredMaterialization
  let executionPlan = plan
  const occupied = new Set((await canvasOpenRuns({ projectId: project.binding.projectId })).map(entry => entry.nodeId))
  // 范围缩小一律再问共用主人（不从旧波次里直接删）：被剔掉的上游没结果，下游拦下「等上游」，不裸跑。
  // 还没摆上画布的分镜草稿（确认之后才落地）按草稿问，和它的规划同一份事实。
  const draftGraph = (): ScopeGraph => deferred ? { nodes: deferred.draftNodes, edges: [] } : useGenerationCanvasStore.getState()
  let skippedBeforeStart = 0
  if (occupied.size) {
    skippedBeforeStart = new Set([...plan.waves.flat(), ...(options.itemized?.rows.map(row => row.id).filter((id): id is string => Boolean(id)) ?? [])].filter(id => occupied.has(id))).size
    if (plan.members.some(id => occupied.has(id))) executionPlan = narrowGenerationScope(plan, plan.members.filter(id => !occupied.has(id)), scopeFactsOf(draftGraph(), { occupied }))
  }
  const priceTargets = options.itemized && options.filterBeforeEnqueue ? new Set(options.filterBeforeEnqueue(options.itemized.rows.flatMap(row => row.id ? [row.id] : []))) : null
  const itemized = options.itemized ? { rows: options.itemized.rows.filter(row => !row.id || (!occupied.has(row.id) && (!priceTargets || priceTargets.has(row.id)))) } : undefined
  // 逐项勾选时候选 = 行里没锁的全部（含默认没勾的）：托管披露、出价前的输入快照都按这个超集算，勾什么由用户在卡上定。
  const selectableIds = itemized ? itemized.rows.filter((row) => !row.disabled && row.id).map((row) => row.id!) : []
  let toggled = false
  const checkedIds = new Set(itemized ? itemized.rows.filter((row) => row.checked && !row.disabled && row.id).map((row) => row.id!) : [])
  let ids = deferred ? deferred.draftNodes.map((node) => node.id) : itemized ? selectableIds : executionPlan.waves.flat()
  if (ids.length === 0) {
    if (skippedBeforeStart) reportOpenRunSkips(project.binding.projectId, skippedBeforeStart)
    // 无可跑 → 复用人话 toast 报「为什么不能跑」。零节点也就没有素材要上传。
    if (executionPlan.blocked.length) await runPlanWithToasts(executionPlan, { project })
    return 'nothing-to-run'
  }
  let assertApprovedInputs = deferred ? undefined : captureApprovedGenerationInputs(ids)
  const nodesById = new Map(useGenerationCanvasStore.getState().nodes.map((n) => [n.id, n]))
  const draftNodes = deferred ? deferred.draftNodes : ids.map((id) => nodesById.get(id)).filter((node): node is GenerationCanvasNode => Boolean(node))
  const draftKinds = new Set(draftNodes.map((node) => spendCostKind(node.kind)))
  const draftCostKind = draftKinds.size === 1 ? [...draftKinds][0] : draftKinds.size === 0 ? 'image' : 'mixed'
  const ok = options.skipSpendConfirmation
    ? true
    : await confirmGenerationSpend(ids.map((id) => nodesById.get(id)), {
      initiator: options.initiator,
      title: i18n.t('generationCommon.batchPlan.startTitle'),
      message: describeGenerationCost(ids.length, deferred ? draftCostKind : spendCostKindForNodes(ids), await withGenerationEtaStats({
        ...generationCostContextForNodes(draftNodes, project.binding.projectId),
        concurrency: normalizeCanvasBatchConcurrency(options.concurrency),
        waveSizes: executionPlan.waves.map((wave) => wave.length),
      })),
      confirmLabel: i18n.t('generationCommon.batchPlan.confirmGenerate'),
      ...(itemized ? {
        message: '',
        planRows: itemized.rows,
        onPlanToggle: (row: PlanRow, checked: boolean) => { if (!row.id || row.disabled) return; toggled = true; if (checked) checkedIds.add(row.id); else checkedIds.delete(row.id) },
      } : {}),
    })
  // **这一行就是那个结局**：2026-09-22 之前它是一个裸 `return`，Agent 那一侧因此读不到
  // 「他点了取消」，`generate` 只好报 `generation_approval_unavailable`（见 `generationRunOutcome.ts`）。
  if (!ok) return 'declined'
  await options.assertCurrent?.()
  project.assertCurrent()
  if (!isProjectExecutionContextCurrent(project)) return 'unavailable'
  if (itemized) {
    // 按用户在卡上勾的重建执行计划：取消的那一项不进计划、不开出价、不派发。派发前再读一次节点现状，打开卡之后在别处开始生成的不再派。
    // 再问共用主人（按此刻的事实：卡开着时在别处开始生成 / 变成可找回的不进；依赖重算）。
    const chosen = selectableIds.filter((id) => checkedIds.has(id))
    executionPlan = narrowGenerationScope(plan, chosen, scopeFactsOf(draftGraph(), { occupied }))
    if (executionPlan.members.length === 0) {
      // 用户在卡上亲手去掉了全部 = 他的决定，不吵；没弹卡（不要确认的批）而默认一个都没勾 = 要说一句为什么没动静。
      if (!toggled) reportCanvasFeedback(i18n.t('generationCommon.canvas.group.generateEmpty'), 'warning', { projectId: project.binding.projectId, identity: `batch-plan:itemized-empty:${selectableIds.slice().sort().join(':')}`, reason: 'empty', nodeIds: selectableIds })
      return 'declined'
    }
    ids = executionPlan.waves.flat()
    if (ids.length === 0) {
      await runPlanWithToasts(executionPlan, { project })
      return 'nothing-to-run'
    }
  }
  if (deferred) {
    executionPlan = await deferred.materialize()
    ids = executionPlan.waves.flat()
    assertApprovedInputs = captureApprovedGenerationInputs(ids)
  }
  const consented = await consentPaidNodes(ids, project.binding.projectId)
  const consentNodeIds = [...consented.recordIds.keys()]
  const canvasRunRecordIds = consented.recordIds
  // 开出价那一下（一次 IPC）里换了项目：还没交任何东西，收回刚开的出价，这一批算没开始（与提交前换项目 = 取消同一条）。
  if (!isProjectExecutionContextCurrent(project)) {
    withdrawCanvasShots({ projectId: project.binding.projectId, runRecordIds: [...canvasRunRecordIds.values()], by: 'stopped' })
    return 'unavailable'
  }
  // All asynchronous approval and consent work has completed. Nothing may await before enqueue.
  if (options.filterBeforeEnqueue) {
    const kept = new Set(options.filterBeforeEnqueue(ids))
    if (ids.some(id => !kept.has(id))) {
      // 出价已开：「生成中」只读节点自己的状态（这一批刚开的出价会把节点标成归制作流程，按全量读会把自己剔掉）。
      executionPlan = narrowGenerationScope(executionPlan, executionPlan.members.filter(id => kept.has(id)), scopeFactsOf(useGenerationCanvasStore.getState(), { busy: 'status' }))
      ids = executionPlan.waves.flat()
      // 剔掉的、以及因此拦下「等上游」的，出价都收回。
      const running = new Set(ids)
      const removed = [...canvasRunRecordIds].filter(([id]) => !running.has(id))
      if (removed.length) withdrawCanvasShots({ projectId: project.binding.projectId, runRecordIds: removed.map(([, record]) => record), by: 'stopped' })
      for (const [id] of removed) canvasRunRecordIds.delete(id)
    }
  }
  if (!ids.length) return 'nothing-to-run'
  options.onConsented?.(consented.runIds.filter((_, index) => ids.includes(consentNodeIds[index])))
  await runPlanWithToasts(executionPlan, {
    project, skippedOpenRuns: skippedBeforeStart,
    assertAuthorCurrent: options.assertAuthorCurrent,
    assertApprovedInputs,
    canvasRunRecordIds,
    concurrency: options.concurrency,
  })
  return 'started'
}

/** 按计划真实生成 + 可行动的失败反馈。「全部生成」与 S6b agent 受理路径共用(单一执行口)。
 * canvasRunRecordIds：卡上点了确认后主进程为要花钱的节点开好的出价（节点 → 运行记录号），每个节点交的时候认它。 */
export async function runPlanWithToasts(
  plan: GenerationScopePlan,
  options: { skippedOpenRuns?: number; assertAuthorCurrent?: (graph: RunGraph, executingNodeId: string) => Promise<void>; assertApprovedInputs?: (graph: RunGraph, executingNodeId: string) => void; canvasRunRecordIds?: ReadonlyMap<string, string>; concurrency?: number; project: ProjectExecutionContext },
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
  const consentKey = options.canvasRunRecordIds?.size ? [...options.canvasRunRecordIds.values()].sort()[0] : undefined
  const notificationId = `${BATCH_RUN_TOAST_ID}:${projectId}:${consentKey ?? waves.flat().slice().sort().map(encodeURIComponent).join(':')}`
  try {
    const result = await runGenerationNodesByPlan(plan, {
      assertAuthorCurrent: options.assertAuthorCurrent,
      assertApprovedInputs: options.assertApprovedInputs,
      target,
      ...(options.canvasRunRecordIds?.size ? { canvasRunRecordIds: options.canvasRunRecordIds } : {}),
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    })
    const okCount = result.successes.length
    const failures = result.failures.filter(failure => classifyGenerationError(failure.error.message).kind !== 'local-refusal')
    const skippedCount = (options.skippedOpenRuns ?? 0) + (result.skipped?.length ?? 0) + result.failures.length - failures.length
    if (skippedCount) reportOpenRunSkips(projectId, skippedCount)
    const failCount = failures.length
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
      // → 重新轻确认（新的一张卡、新开的出价，不绕付费闸）→ 并发重跑；成功的不重付。上游仍缺果的会再次被
      // 人话拦下（describeBlockedNotice），不静默。ttl 放宽到 12s 给动作留点击窗口。
      // 能不能一键重跑只读共享失败判定：结果不明（可能已扣钱）的那几张不在「重试」里，它们各自的节点上有「再发一次」那张卡。
      // 正文仍数全部失败；一张能直接重试的都没有时，动作换成去任务中心看。
      const failureIds = failures.filter((failure) => generationFailureActions(failure.error.message).canRetry).map((failure) => failure.nodeId)
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
        ...(failureIds.length === 0 ? {
          actionLabel: i18n.t('taskCenter.title'),
          onAction: () => { void revealNotificationTarget({ projectId, taskCenter: true }) },
        } : {
          actionLabel: i18n.t('generationCommon.batchPlan.retryFailed', { count: failureIds.length }),
          onAction: async () => {
            if (!isProjectOpen(projectId) && !(await revealNotificationTarget({ projectId, workspaceMode: 'generation' }))) return
            if (!isProjectOpen(projectId)) return
            void confirmAndRunPlan(
              planCanvasGenerationScope('retry-failed', failureIds, useGenerationCanvasStore.getState()),
              // 通知里的「重试失败的」是人按的这一下，不继承原批次的发起方。
              { concurrency: options.concurrency, initiator: 'user' },
            )
          },
        }),
      })
    }
    // 用户点「生成全部」只花生成的钱：跑完不再自动调文本模型审片（2026-09-26 用户拍板，TODO T-QA-36）。
    // 审片仍是 Agent 做片流程里写明的一步（capabilityApplyHandler.verifyShotsForProduction）；
    // 这里要自动审片，得等设置开关做出来（下一版），开关归 shotVerifyStore。
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

export function reportOpenRunSkips(projectId: string, count: number) {
  reportCanvasFeedback(i18n.t('generationCommon.batchPlan.openRunsSkipped', { count }), 'info', { identity: 'canvas-open-skipped', reason: 'generation-skipped', projectId })
}
