import type { ExecutionContractV1, PlanCandidate } from './executionContract'
import type { GenerationSealMultiShot } from './mcpGenerationMultiShot'
import { stableAuthorizationJson } from '../productionRun/productionGenerationAuthorization'
import type { ProjectLeaseV2 } from './projectLease'
import type { ProductionRun } from '../productionRun/productionRunTypes'
import type { WorkspaceProjectRecordV2 } from '../workspace/workspaceTypes'

type ProjectIdentity = Pick<WorkspaceProjectRecordV2, 'id' | 'immutableProjectUuid' | 'projectGeneration'>
type GenerationOperationScope = Readonly<{
  operationId: string
  projectId: string
  candidate: PlanCandidate
  planVersion?: number
}>

type ScopeUnit = Readonly<{ shotId: string; candidate: PlanCandidate; contract: ExecutionContractV1 }>

type GenerationReferenceScopeFieldOwner = 'user-approved' | 'nomi-owned'

type GenerationReferenceScopeField = Readonly<{
  key: string
  owner: GenerationReferenceScopeFieldOwner
  path: readonly string[]
}>

/**
 * The only declaration of what the delayed reference upload is allowed to observe.
 * `user-approved` fields fail closed when they change; `nomi-owned` fields are
 * recorded here so a new projection/cache field cannot silently become a scope
 * check without a matching class-level test.
 */
export const GENERATION_REFERENCE_SCOPE_DECLARATION = [
  { key: 'project.id', owner: 'user-approved', path: ['project', 'id'] },
  { key: 'project.immutableProjectUuid', owner: 'user-approved', path: ['project', 'immutableProjectUuid'] },
  { key: 'project.projectGeneration', owner: 'user-approved', path: ['project', 'projectGeneration'] },
  { key: 'operation.operationId', owner: 'user-approved', path: ['operation', 'operationId'] },
  { key: 'operation.projectId', owner: 'user-approved', path: ['operation', 'projectId'] },
  { key: 'operation.planVersion', owner: 'user-approved', path: ['operation', 'planVersion'] },
  { key: 'operation.candidates', owner: 'user-approved', path: ['operation', 'candidates'] },
  { key: 'run.currentCandidates', owner: 'user-approved', path: ['run', 'currentCandidates'] },
  { key: 'run.status', owner: 'user-approved', path: ['run', 'status'] },
  { key: 'run.stageId', owner: 'user-approved', path: ['run', 'stageId'] },
  { key: 'run.stop', owner: 'user-approved', path: ['run', 'stop'] },
  { key: 'run.planVersion', owner: 'user-approved', path: ['run', 'planVersion'] },
  { key: 'run.planState', owner: 'user-approved', path: ['run', 'planState'] },
  { key: 'run.jobs', owner: 'user-approved', path: ['run', 'jobs'] },
  { key: 'project.revision', owner: 'nomi-owned', path: ['project', 'revision'] },
  { key: 'project.updatedAt', owner: 'nomi-owned', path: ['project', 'updatedAt'] },
  { key: 'run.revision', owner: 'nomi-owned', path: ['run', 'revision'] },
  { key: 'run.snapshotCursor', owner: 'nomi-owned', path: ['run', 'snapshotCursor'] },
  { key: 'run.updatedAt', owner: 'nomi-owned', path: ['run', 'updatedAt'] },
  { key: 'run.canvasPlanUpdatedAt', owner: 'nomi-owned', path: ['run', 'canvasPlanUpdatedAt'] },
  { key: 'run.canvasBindings', owner: 'nomi-owned', path: ['run', 'canvasBindings'] },
] as const satisfies readonly GenerationReferenceScopeField[]

type GenerationReferenceScopeContext = Readonly<{
  project: Readonly<Record<string, unknown>>
  operation: Readonly<Record<string, unknown>>
  run: Readonly<Record<string, unknown>> | null
}>

export type GenerationReferenceScopeGuardInput = Readonly<{
  lease: Pick<ProjectLeaseV2, 'projectId' | 'immutableProjectUuid' | 'projectGeneration'>
  operation: GenerationOperationScope
  contract: ExecutionContractV1
  multiShot?: GenerationSealMultiShot
  initialRun: ProductionRun
  readProject: () => ProjectIdentity | null | undefined
  readRun: () => ProductionRun | null | undefined
}>

function unitsFor(input: Pick<GenerationReferenceScopeGuardInput, 'operation' | 'contract' | 'multiShot'>): readonly ScopeUnit[] {
  if (!input.multiShot) return [{ shotId: input.operation.candidate.candidateId, candidate: input.operation.candidate, contract: input.contract }]
  const scope = new Set(input.multiShot.scope)
  return input.multiShot.shots
    .filter((shot) => shot.included !== false && scope.has(shot.shotId) && shot.contract)
    .map((shot) => ({ shotId: shot.shotId, candidate: shot.candidate, contract: shot.contract! }))
}

function candidateForShot(run: ProductionRun, shotId: string): PlanCandidate | undefined {
  const plan = run.generationPlan
  if (!plan) return undefined
  if (plan.shots && plan.shots.length > 0) return plan.shots.find((shot) => shot.shotId === shotId)?.candidate
  return plan.candidate.candidateId === shotId ? plan.candidate : undefined
}

/**
 * Run state that can change the user's generation decision. Revision counters, updatedAt,
 * canvas node bindings and detached projection flags are deliberately excluded: those are
 * Nomi-owned projection/cache writes and are not user scope.
 */
function semanticRunState(run: ProductionRun, shotIds: readonly string[]): unknown {
  const selected = new Set(shotIds)
  return {
    status: run.status,
    stageId: run.stageId,
    stop: run.stop,
    planVersion: run.planVersion,
    planState: run.generationPlan?.state,
    jobs: run.jobs
      .filter((job) => selected.has(typeof job.metadata?.shotId === 'string' ? job.metadata.shotId : ''))
      .map((job) => ({
        jobId: job.jobId,
        shotId: job.metadata?.shotId,
        attempt: job.attempt,
        status: job.status,
        providerTaskId: job.providerTaskId,
        stageId: job.stageId,
      }))
      .sort((left, right) => left.jobId.localeCompare(right.jobId)),
  }
}

function projectIdentityOf(project: ProjectIdentity | null | undefined): unknown {
  if (!project) return null
  return { id: project.id, immutableProjectUuid: project.immutableProjectUuid, projectGeneration: project.projectGeneration }
}

function readPath(source: unknown, path: readonly string[]): unknown {
  let value = source
  for (const segment of path) {
    if (!value || typeof value !== 'object' || !(segment in value)) return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

export function generationReferenceScopeContext(input: GenerationReferenceScopeGuardInput, project: ProjectIdentity | null | undefined, run: ProductionRun | null | undefined): GenerationReferenceScopeContext {
  const units = unitsFor(input)
  const shotIds = units.map((unit) => unit.shotId)
  const plan = run?.generationPlan
  const canvasBindings = plan
    ? [
      { shotId: plan.candidate.candidateId, nodeId: plan.nodeId, canvasDetached: plan.canvasDetached },
      ...(plan.shots ?? []).map((shot) => ({ shotId: shot.shotId, nodeId: shot.nodeId, canvasDetached: shot.canvasDetached })),
    ]
    : null
  const identity = projectIdentityOf(project)
  return {
    project: {
      ...(identity && typeof identity === 'object' ? identity : {}),
      revision: (project as (ProjectIdentity & { revision?: number }) | null | undefined)?.revision,
      updatedAt: (project as (ProjectIdentity & { updatedAt?: string }) | null | undefined)?.updatedAt,
    },
    operation: {
      operationId: input.operation.operationId,
      projectId: input.operation.projectId,
      planVersion: input.operation.planVersion,
      candidates: units.map((unit) => ({
        shotId: unit.shotId,
        candidate: unit.candidate,
        contractHash: unit.contract.contractHash,
        references: unit.contract.references,
      })),
    },
    run: run ? {
      currentCandidates: shotIds.map((shotId) => ({ shotId, candidate: candidateForShot(run, shotId) ?? null })),
      ...semanticRunState(run, shotIds) as Record<string, unknown>,
      revision: run.revision,
      snapshotCursor: run.snapshotCursor,
      updatedAt: run.updatedAt,
      canvasPlanUpdatedAt: plan?.updatedAt,
      canvasBindings,
    } : null,
  }
}

export function generationReferenceScopeSnapshotFromContext(context: GenerationReferenceScopeContext): Readonly<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {}
  for (const field of GENERATION_REFERENCE_SCOPE_DECLARATION) {
    if (field.owner === 'user-approved') snapshot[field.key] = readPath(context, field.path)
  }
  return snapshot
}

export function generationReferenceScopeDeclarationSnapshot(input: GenerationReferenceScopeGuardInput, project: ProjectIdentity | null | undefined, run: ProductionRun | null | undefined): Readonly<Record<string, unknown>> {
  return generationReferenceScopeSnapshotFromContext(generationReferenceScopeContext(input, project, run))
}

function scopeSnapshot(input: GenerationReferenceScopeGuardInput, project: ProjectIdentity | null | undefined, run: ProductionRun | null | undefined): string {
  return stableAuthorizationJson(generationReferenceScopeDeclarationSnapshot(input, project, run))
}

/**
 * Shared upload-time guard for both app and authenticated-MCP hosts.
 * It compares semantic generation scope, never the mutable project/Run revision counters.
 */
export function createGenerationReferenceScopeGuard(input: GenerationReferenceScopeGuardInput): () => void {
  const initialProject = input.readProject()
  const initialRun = input.initialRun
  const expectedProject = {
    id: input.lease.projectId,
    immutableProjectUuid: input.lease.immutableProjectUuid,
    projectGeneration: input.lease.projectGeneration,
  }
  if (!initialProject || stableAuthorizationJson(projectIdentityOf(initialProject)) !== stableAuthorizationJson(expectedProject)) {
    throw new Error('generation_reference_scope_changed')
  }
  const expected = scopeSnapshot(input, initialProject, initialRun)
  return () => {
    const currentProject = input.readProject()
    const currentRun = input.readRun()
    if (!currentProject || !currentRun || scopeSnapshot(input, currentProject, currentRun) !== expected) {
      throw new Error('generation_reference_scope_changed')
    }
  }
}
