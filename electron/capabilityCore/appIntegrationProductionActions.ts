import type { ApprovalReceiptAuthority } from './approvalReceipt'
import { decideRunOwnedGenerationGate } from './runOwnedGenerationGateAuthority'
import type { GenerationProviderBootstrap } from './generationProviderBootstrap'
import type { ExecutionContractV1 } from './executionContract'
import type { ProductionRunService } from '../productionRun/productionRunService'
import type { MultiShotBatchScheduler } from '../productionRun/multiShotBatchScheduler'
import {
  prepareProductionGenerationContinuationAuthorization,
  prepareProductionGenerationReauthorization,
  type GenerationAuthorizationProjectIdentity,
} from '../productionRun/prepareProductionGenerationAuthorization'
import type { ProductionActionResult, ProductionRun } from '../productionRun/productionRunTypes'
import type { ShotPrice } from '../productionRun/shotPricing'
import type { WorkspaceProjectRecordV2 } from '../workspace/workspaceTypes'

// Keep the extracted action hooks on the scheduler's real result contract.
// A reduced `{ quiescent }` shape is not assignable to the production
// scheduler callback because callers also rely on progress/checkpoint data.
type SchedulerLike = Pick<MultiShotBatchScheduler, 'runToQuiescence'>

type ActionDeps = {
  generationService: Pick<ProductionRunService, 'repository' | 'readFull' | 'command'>
  isProjectOpen: (projectId: string) => boolean
  readProviderBootstrap: () => GenerationProviderBootstrap
  readProject: (projectId: string) => WorkspaceProjectRecordV2 | null
  resolveShotPrice: (contract: ExecutionContractV1) => ShotPrice
  buildSchedulerForRun: (projectId: string, runId: string, run: Pick<ProductionRun, 'projectId' | 'generationPlan' | 'jobs'>) => SchedulerLike | null
  driveScheduler: (projectId: string, runId: string, scheduler: SchedulerLike, label: string) => void
  receiptAuthority?: ApprovalReceiptAuthority
  confirmGenerationInNomi?: (input: { challengeToken: string }) => Promise<unknown>
  projectRevisionResolver: (projectId: string) => number | undefined
}

function projectIdentity(projectId: string, record: WorkspaceProjectRecordV2): GenerationAuthorizationProjectIdentity {
  if (!record.immutableProjectUuid || !record.projectGeneration || !Number.isInteger(record.revision)) {
    throw new Error('project identity unavailable')
  }
  return {
    projectId,
    immutableProjectUuid: record.immutableProjectUuid,
    projectGeneration: record.projectGeneration,
    revocationEpoch: 0,
  }
}

/**
 * Build the user-triggered rework/resume actions for a capability-core
 * instance. These actions share the same scheduler and receipt authority as
 * initial generation, but live in their own module so startup wiring stays
 * below the giant-file gate.
 */
export function createProductionActionHooks(deps: ActionDeps): {
  reworkProductionShot: (input: { projectId: string; runId: string; shotId?: string }) => Promise<ProductionActionResult>
  resumeProductionBatch: (input: { projectId: string; runId: string; reason: 'budget' | 'manual' }) => Promise<ProductionActionResult>
} {
  const reworkProductionShot = async (input: { projectId: string; runId: string; shotId?: string }): Promise<ProductionActionResult> => {
    const { projectId, runId, shotId } = input
    if (!deps.isProjectOpen(projectId)) return { ok: false, code: 'run_not_open' }
    let run: ProductionRun | null
    try {
      run = deps.generationService.repository.read(projectId, runId)
    } catch {
      return { ok: false, code: 'failed', message: 'run read failed' }
    }
    if (!run || !run.generationPlan?.shots || run.generationPlan.shots.length === 0) return { ok: false, code: 'not_multishot' }
    const receiptAuthority = deps.receiptAuthority
    const confirm = deps.confirmGenerationInNomi
    const record = deps.readProject(projectId)
    if (!receiptAuthority || !confirm || !record) return { ok: false, code: 'unavailable' }
    let identity: GenerationAuthorizationProjectIdentity
    try {
      identity = projectIdentity(projectId, record)
    } catch {
      return { ok: false, code: 'unavailable' }
    }
    const providerBootstrap = deps.readProviderBootstrap()
    let authorization
    try {
      authorization = prepareProductionGenerationReauthorization({
        lease: identity,
        projectRevision: record.revision,
        run,
        ...(shotId ? { shotId } : {}),
        providers: providerBootstrap.providers,
        resolveShotPrice: deps.resolveShotPrice,
        now: new Date().toISOString(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/previous generation attempt|previously authorized generation plan/.test(message)) return { ok: false, code: 'no_prior_attempt' }
      return { ok: false, code: 'failed', message }
    }
    try {
      run = (await deps.generationService.command(projectId, runId, {
        commandId: `production-rework-authorize:${authorization.envelope.gateId}`,
        expectedRevision: run.revision,
        type: 'generation.reauthorize',
        payload: { authorization, ...(shotId ? { shotId } : {}) },
        issuedAt: new Date().toISOString(),
      })).run
    } catch (error) {
      return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
    const shot = shotId ? (run.generationPlan?.shots ?? []).find((candidate) => candidate.shotId === shotId) : undefined
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
        projectRevisionResolver: deps.projectRevisionResolver,
        display: {
          model: modelLabel,
          ...(shotSummary ? { shotSummary } : {}),
          ...(shotContract?.references?.length ? { referenceCount: shotContract.references.length } : {}),
        },
      })
      if (!decision.approved) return { ok: false, code: 'rework_declined' }
      const submitting = deps.generationService.repository.read(projectId, runId)
      if (submitting?.generationPlan?.state !== 'submitted') {
        if (!submitting) return { ok: false, code: 'failed', message: 'run gone before submit' }
        await deps.generationService.command(projectId, runId, {
          commandId: `production-rework-submit:${authorization.envelope.gateId}`,
          expectedRevision: submitting.revision,
          type: 'generation.submit',
          payload: {},
          issuedAt: new Date().toISOString(),
        })
      }
    } catch (error) {
      return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
    const kicking = deps.generationService.repository.read(projectId, runId)
    if (kicking) {
      const scheduler = deps.buildSchedulerForRun(projectId, runId, kicking)
      if (scheduler) deps.driveScheduler(projectId, runId, scheduler, 'rework dispatch tick')
    }
    return { ok: true, code: 'reworked' }
  }

  const resumeProductionBatch = async (input: { projectId: string; runId: string; reason: 'budget' | 'manual' }): Promise<ProductionActionResult> => {
    const { projectId, runId, reason } = input
    if (!deps.isProjectOpen(projectId)) return { ok: false, code: 'run_not_open' }
    let run: ProductionRun | null
    try {
      run = deps.generationService.repository.read(projectId, runId)
    } catch {
      return { ok: false, code: 'failed', message: 'run read failed' }
    }
    if (!run || !run.generationPlan?.shots || run.generationPlan.shots.length === 0) return { ok: false, code: 'not_multishot' }
    if (run.generationPlan.state !== 'submitted') return { ok: false, code: 'failed', message: 'plan not submitted' }
    if (reason === 'budget') {
      const providerBootstrap = deps.readProviderBootstrap()
      const receiptAuthority = deps.receiptAuthority
      const confirm = deps.confirmGenerationInNomi
      const record = deps.readProject(projectId)
      if (!receiptAuthority || !confirm || !record) return { ok: false, code: 'unavailable' }
      let identity: GenerationAuthorizationProjectIdentity
      try {
        identity = projectIdentity(projectId, record)
      } catch {
        return { ok: false, code: 'unavailable' }
      }
      let authorization
      try {
        authorization = prepareProductionGenerationContinuationAuthorization({
          lease: identity,
          projectRevision: record.revision,
          run,
          providers: providerBootstrap.providers,
          resolveShotPrice: deps.resolveShotPrice,
          now: new Date().toISOString(),
        })
        run = (await deps.generationService.command(projectId, runId, {
          commandId: `production-continuation-authorize:${authorization.envelope.gateId}`,
          expectedRevision: run.revision,
          type: 'generation.continue_authorization',
          payload: { authorization },
          issuedAt: new Date().toISOString(),
        })).run
      } catch (error) {
        return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
      const modelLabel = [...new Set(authorization.envelope.jobs.map((job) => job.modelId))].join(', ')
      try {
        const decision = await decideRunOwnedGenerationGate({
          owner: deps.generationService,
          receipts: receiptAuthority,
          confirm,
          lease: identity,
          operationId: runId,
          authorization,
          commandPrefix: 'production-continuation',
          projectRevisionResolver: deps.projectRevisionResolver,
          display: { model: modelLabel },
        })
        if (!decision.approved) return { ok: false, code: 'resume_declined' }
        run = decision.run
      } catch (error) {
        return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
    }
    if (run.status === 'paused' || run.status === 'needs_attention') {
      try {
        await deps.generationService.command(projectId, runId, {
          commandId: `production-resume:${runId}:${run.revision}`,
          expectedRevision: run.revision,
          type: 'run.status',
          payload: { status: 'running' },
          issuedAt: new Date().toISOString(),
        })
      } catch (error) {
        return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
    } else if (run.status !== 'running') {
      return { ok: false, code: 'failed', message: `run status ${run.status} is not resumable` }
    }
    const running = deps.generationService.repository.read(projectId, runId)
    if (!running) return { ok: false, code: 'failed', message: 'run gone after resume' }
    const scheduler = deps.buildSchedulerForRun(projectId, runId, running)
    if (!scheduler) return { ok: false, code: 'unavailable' }
    deps.driveScheduler(projectId, runId, scheduler, 'batch resume tick')
    return { ok: true, code: 'resumed' }
  }

  return { reworkProductionShot, resumeProductionBatch }
}
