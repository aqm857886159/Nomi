import { HumanApprovalRequiredError, ReceiptExpiredError, ReceiptScopeError, type ApprovalReceiptAuthority } from './approvalReceipt'
import { decideRunOwnedGenerationGate } from './runOwnedGenerationGateAuthority'
import type { GenerationProviderBootstrap } from './generationProviderBootstrap'
import type { ExecutionContractV1 } from './executionContract'
import { GenerationProviderCapabilityError } from './generationRuntimeAdapter'
import type { ProductionRunService } from '../productionRun/productionRunService'
import {
  GenerationReworkRefusedError,
  prepareProductionGenerationReauthorization,
  type GenerationAuthorizationProjectIdentity,
} from '../productionRun/prepareProductionGenerationAuthorization'
import type { ProductionRun, ProductionShotActionFailure, ProductionShotActionResult } from '../productionRun/productionRunTypes'
import type { ShotPrice } from '../productionRun/shotPricing'
import type { WorkspaceProjectRecordV2 } from '../workspace/workspaceTypes'
import { ProductionRunParseError, ProductionRunRevisionConflictError } from '../productionRun/productionRunRepository'
import { ProductionRunLockBusyError } from '../productionRun/productionRunLock'
import { IllegalProductionTransitionError } from '../productionRun/productionRunState'
import { ProductionRunControlRefusedError } from '../productionRun/productionRunControl'
import { retryLiftsStop } from '../productionRun/productionRunLifecycle'
import { runStopReason } from '../shared/productionRunStop'
import { shotsAwaitingDispatch } from '../productionRun/shotLandingAdmission'
import { logError, logWarn } from '../logging/logger'

/** 这个 Run 现在驱动得起来吗；起不来是缺什么（与调度器构造同一份判断：appIntegration.submissionReadinessForRun）。 */
export type ProductionDriverReadiness = 'ready' | 'provider_missing' | 'project_missing'

type ActionDeps = {
  generationService: Pick<ProductionRunService, 'repository' | 'readFull' | 'command'>
  isProjectOpen: (projectId: string) => boolean
  readProviderBootstrap: () => GenerationProviderBootstrap
  readProject: (projectId: string) => WorkspaceProjectRecordV2 | null
  resolveShotPrice: (contract: ExecutionContractV1) => ShotPrice
  driverReadiness: (run: ProductionRun) => ProductionDriverReadiness
  /** 给这个 Run 的批次调度器一个 tick（已经有一趟在跑就记一笔，收尾时补踢）。 */
  kickScheduler: (projectId: string, runId: string) => void
  /**
   * 因为落地失败停下的批次，「继续」那一下先把还没落下的镜落到画布上（与开拍同一个准入点）。返回 null = 全落下了；
   * 否则逐镜报回（一镜都没落下时这次不继续、如实回「没放到画布上」）。
   */
  landBeforeResume?: (projectId: string, runId: string) => Promise<{ allNotPlaced: boolean } | null>
  receiptAuthority?: ApprovalReceiptAuthority
  confirmGenerationInNomi?: (input: { challengeToken: string }) => Promise<unknown>
}

/** 写项目记录时撞上的系统错误（磁盘满 / 只读 / 没有权限 / 被占用）：Node 给的是结构化的 errno 码，不是一句话。 */
const LEDGER_WRITE_ERRNO = new Set(['ENOSPC', 'EDQUOT', 'EROFS', 'EACCES', 'EPERM', 'EBUSY'])

/**
 * 一次没做成的返工 / 续拍是哪一种——只认源头已经结构化的错误类型与系统错误码，**不读英文原话**。
 * 认不出来的只剩 Nomi 自己的不变量断言（bug）：如实归到 `internal_error`，不装成「稍后再试」。
 */
export function productionShotActionFailureOf(error: unknown): ProductionShotActionFailure {
  if (error instanceof GenerationReworkRefusedError) return error.refusal
  if (error instanceof ProductionRunRevisionConflictError
    || error instanceof ProductionRunLockBusyError
    || error instanceof IllegalProductionTransitionError
    || error instanceof ProductionRunControlRefusedError) return 'run_changed'
  if (error instanceof ReceiptScopeError) return 'approval_stale'
  if (error instanceof ReceiptExpiredError) return 'approval_expired'
  if (error instanceof HumanApprovalRequiredError) return 'confirmation_unavailable'
  if (error instanceof GenerationProviderCapabilityError) return 'provider_unavailable'
  if (error instanceof ProductionRunParseError) return 'run_unreadable'
  const errno = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  if (typeof errno === 'string' && LEDGER_WRITE_ERRNO.has(errno)) return 'ledger_write_failed'
  return 'internal_error'
}

function failed(failure: ProductionShotActionFailure): ProductionShotActionResult {
  return { ok: false, code: 'failed', failure }
}

/** 没做成：原话连同堆栈进主进程日志（Nomi 自己的 bug 记 ERROR，其余是可预期的情形记 WARN），界面只拿语义码。 */
function failedWith(error: unknown): ProductionShotActionResult {
  const failure = productionShotActionFailureOf(error)
  if (failure === 'internal_error') logError('production-run', 'production-action-internal-error', error)
  else logWarn('production-run', 'production-action-failed', { failure }, error)
  return failed(failure)
}

function projectIdentity(projectId: string, record: WorkspaceProjectRecordV2 | null): GenerationAuthorizationProjectIdentity | null {
  if (!record?.immutableProjectUuid || !record.projectGeneration || !Number.isInteger(record.revision)) return null
  return {
    projectId,
    immutableProjectUuid: record.immutableProjectUuid,
    projectGeneration: record.projectGeneration,
    revocationEpoch: 0,
  }
}

/** 读这一批：读不出来（文件坏了 / 被占着）和已经不在了是两回事。 */
function readRun(deps: ActionDeps, projectId: string, runId: string): ProductionRun | ProductionShotActionResult {
  let run: ProductionRun | null
  try {
    run = deps.generationService.repository.read(projectId, runId)
  } catch (error) {
    logError('production-run', 'production-action-read-failed', error)
    return failed('run_unreadable')
  }
  if (!run) return failed('run_missing')
  if (!run.generationPlan?.shots || run.generationPlan.shots.length === 0) return failed('not_multishot')
  return run
}

/**
 * Build the user-triggered rework/resume actions for a capability-core
 * instance. These actions share the same scheduler and receipt authority as
 * initial generation, but live in their own module so startup wiring stays
 * below the giant-file gate.
 */
export function createProductionActionHooks(deps: ActionDeps): {
  reworkProductionShot: (input: { projectId: string; runId: string; shotId?: string }) => Promise<ProductionShotActionResult>
  resumeProductionBatch: (input: { projectId: string; runId: string }) => Promise<ProductionShotActionResult>
} {
  /**
   * 「继续」只有一条路：run.control resume（与任务卡、MCP 同一个口；服务的恢复钩子叫醒驱动这个 Run 的那一方）。
   * `humanGesture`：这一下是用户在 Nomi 窗口里点的「继续」（受信的 resume-batch IPC 进来的那一条）——它同时续上
   * 批过、还没发出去的那几镜的同意（付费卡① 第 13 条，`productionRunControl` 在 resume 时调续的写口）。
   * 重做之后顺手的那次 resume 不是这一下：它只为重做的那一镜（那一镜有自己新的一份批准），不替别的镜续。
   */
  async function resumeRun(run: ProductionRun, commandId: string, humanGesture: boolean): Promise<ProductionShotActionResult | null> {
    try {
      await deps.generationService.command(run.projectId, run.runId, {
        commandId,
        expectedRevision: run.revision,
        type: 'run.control',
        payload: { action: 'resume' },
        issuedAt: new Date().toISOString(),
        ...(humanGesture ? { humanGesture: true as const } : {}),
      })
      return null
    } catch (error) {
      return failedWith(error)
    }
  }

  const reworkProductionShot = async (input: { projectId: string; runId: string; shotId?: string }): Promise<ProductionShotActionResult> => {
    const { projectId, runId, shotId } = input
    if (!deps.isProjectOpen(projectId)) return failed('run_not_open')
    const read = readRun(deps, projectId, runId)
    if ('code' in read) return read
    let run = read
    // 多镜批次里重做的是「这一镜」：没带镜头编号就不知道重做谁。
    if (!shotId) return failed('request_invalid')
    const receiptAuthority = deps.receiptAuthority
    const confirm = deps.confirmGenerationInNomi
    if (!receiptAuthority || !confirm) return failed('confirmation_unavailable')
    const record = deps.readProject(projectId)
    const identity = projectIdentity(projectId, record)
    if (!record || !identity) return failed('project_unavailable')
    let authorization
    try {
      authorization = prepareProductionGenerationReauthorization({
        lease: identity,
        projectRevision: record.revision,
        run,
        shotId,
        providers: deps.readProviderBootstrap().providers,
        resolveShotPrice: deps.resolveShotPrice,
        now: new Date().toISOString(),
      })
      run = (await deps.generationService.command(projectId, runId, {
        commandId: `production-rework-authorize:${authorization.envelope.gateId}`,
        expectedRevision: run.revision,
        type: 'generation.reauthorize',
        payload: { authorization, shotId },
        issuedAt: new Date().toISOString(),
      })).run
    } catch (error) {
      return failedWith(error)
    }
    const shot = (run.generationPlan?.shots ?? []).find((candidate) => candidate.shotId === shotId)
    const shotContract = shot?.contract ?? run.generationPlan?.contract
    const modelLabel = shotContract?.modelId ?? run.generationPlan?.candidate.modelId ?? ''
    const shotSummary = typeof shot?.candidate.prompt === 'string' && shot.candidate.prompt.trim()
      ? shot.candidate.prompt.trim().slice(0, 80)
      : undefined
    try {
      const decision = await decideRunOwnedGenerationGate({
        owner: deps.generationService,
        receipts: receiptAuthority,
        confirm,
        lease: identity,
        operationId: runId,
        authorization,
        commandPrefix: 'production-rework',
        display: {
          model: modelLabel,
          ...(shotSummary ? { shotSummary } : {}),
          ...(shotContract?.references?.length ? { referenceCount: shotContract.references.length } : {}),
        },
      })
      if (!decision.approved) return { ok: false, code: 'rework_declined' }
      // 重做是这一镜的又一份授权（住在它自己那道门上），计划照旧在跑，不需要再「交一次方案」。
      run = decision.run
    } catch (error) {
      return failedWith(error)
    }
    // 停着的批次一镜都不派：这次停下若随重做解除（retryLiftsStop，生命周期 owner 判），就让它接着走，
    // 否则这一镜永远不开拍（例如因为有镜头失败而停下的批次——重做的正是那一镜）。
    const stopReason = runStopReason(run)
    if (stopReason && retryLiftsStop(stopReason)) {
      const refused = await resumeRun(run, `production-rework-resume:${authorization.envelope.gateId}`, false)
      if (refused) return refused
    }
    deps.kickScheduler(projectId, runId)
    return { ok: true, code: 'reworked' }
  }

  /**
   * 「继续」/「继续剩余」：接着拍这一批还没开拍的镜。只从受信的 resume-batch IPC 进来——这一下就是用户在 Nomi 窗口里的
   * 那一次点头，它续上批过、还没发出去的那几镜的同意（付费卡① 第 13 条），不再弹第二个确认。
   * 2026-10-01 删掉了「因预算停下 → 先续额度」那一支：授权按镜存之后没有 Run 级额度可续。
   */
  const resumeProductionBatch = async (input: { projectId: string; runId: string }): Promise<ProductionShotActionResult> => {
    const { projectId, runId } = input
    if (!deps.isProjectOpen(projectId)) return failed('run_not_open')
    const read = readRun(deps, projectId, runId)
    if ('code' in read) return read
    const run = read
    if (run.generationPlan?.state !== 'submitted') return failed('plan_not_submitted')
    if (run.status === 'completed' || run.status === 'cancelled') return failed('run_finished')
    const stopReason = runStopReason(run)
    if (stopReason === null && run.status !== 'running') return failed('not_stopped')
    if (stopReason === 'landing_failed') {
      // 落地失败停下的那一批（#1139 第二轮复审第 3 条）：继续 = 重落再派，不许只回一个 resumed 却什么都不发生。
      // 剩下没发的镜节点都被删掉了（detached）→ 制作流程不再派它们，没有可继续的，如实说；
      // 这一次还是一镜都落不下 → 不继续，如实说「没放到画布上」，再点一次就是重试。
      if (shotsAwaitingDispatch(run).length === 0) return failed('nothing_to_resume')
      const landing = await deps.landBeforeResume?.(projectId, runId)
      if (landing?.allNotPlaced) return failed('canvas_landing_failed')
    }
    if (stopReason !== null) {
      // 驱动不起来就别把 Run 改成 running——那只会是一次假继续。
      const readiness = deps.driverReadiness(run)
      if (readiness === 'provider_missing') return failed('provider_unavailable')
      if (readiness === 'project_missing') return failed('project_unavailable')
    }
    // 已经在跑（上一趟驱动歇下了）也走同一条 resume：这一下点击照样续同意，然后踢一下让它接着派。
    const refused = await resumeRun(run, `production-resume:${runId}:${run.revision}`, true)
    if (refused) return refused
    if (stopReason === null) deps.kickScheduler(projectId, runId)
    return { ok: true, code: 'resumed' }
  }

  return { reworkProductionShot, resumeProductionBatch }
}
