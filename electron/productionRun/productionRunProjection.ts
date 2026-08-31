import {
  createArtifactProjection,
  type ArtifactProjection,
} from './artifactProjection'
import { buildProductionDeepLink } from './productionDeepLink'
import { safeExternalText, safeProductionContract } from './productionRunProjectionSanitizer'
import type { ProductionArtifact, ProductionRun, RunEvent } from './productionRunTypes'

type SafeProductionGate = Omit<ProductionRun['gates'][number], 'planHash' | 'jobIds' | 'contract'> & {
  contract?: ReturnType<typeof safeProductionContract>
}
type SafeProductionJob = Pick<ProductionRun['jobs'][number], 'jobId' | 'stageId' | 'status' | 'attempt' | 'progressPercent' | 'lastPollAt' | 'lastVendorStateChangeAt' | 'createdAt' | 'updatedAt' | 'errorCode'>

export type ProductionRunProjection = {
  schemaVersion: number
  runId: string
  projectId: string
  revision: number
  status: ProductionRun['status']
  stageId: string
  playbook: ProductionRun['playbook']
  origin: ProductionRun['origin']
  budget: ProductionRun['budget']
  planVersion: number
  snapshotCursor: number
  stages: ProductionRun['stages']
  gates: SafeProductionGate[]
  jobs: SafeProductionJob[]
  artifacts: Array<Omit<ArtifactProjection, 'projectId' | 'runId' | 'openInNomi'>>
  createdAt: string
  updatedAt: string
  openInNomi: string
}

export type ProductionEventProjection = Pick<RunEvent, 'schemaVersion' | 'eventId' | 'cursor' | 'runId' | 'runRevision' | 'commandId' | 'type' | 'message' | 'emittedAt' | 'stageId' | 'jobId' | 'artifactId' | 'causationId' | 'correlationId' | 'attemptId' | 'providerOccurredAt'>
export type ProductionArtifactProjection = ArtifactProjection

const MEANINGFUL_EVENT_TYPES = new Set([
  'run.created',
  'run.status.changed',
  'run.stage.changed',
  'stage.updated',
  'gate.waiting',
  'gate.decided',
  'artifact.ready',
  'artifact.adopted',
  'job.ready',
  'job.adopted',
  'job.not_dispatched',
  'job.submission_unknown',
  'job.needs_attention',
  'job.vendor_state_stale',
  'skill.loaded',
  'skill.applied',
  'plan.proposed',
  'plan.attached',
  'plan.rebound',
])

export function isMeaningfulProductionEvent(event: RunEvent): boolean {
  return MEANINGFUL_EVENT_TYPES.has(event.type)
}

export function createProductionArtifactMetadataProjection(
  run: ProductionRun,
  artifact: ProductionArtifact,
): Omit<ArtifactProjection, 'preview'> {
  return {
    artifactId: artifact.artifactId,
    runId: run.runId,
    projectId: run.projectId,
    stageId: artifact.stageId,
    ...(artifact.jobId ? { jobId: artifact.jobId } : {}),
    kind: artifact.kind,
    status: artifact.status,
    createdAt: artifact.createdAt,
    ...(artifact.adoptedAt ? { adoptedAt: artifact.adoptedAt } : {}),
    nomiUri: `nomi://project/${encodeURIComponent(run.projectId)}/run/${encodeURIComponent(run.runId)}/artifact/${encodeURIComponent(artifact.artifactId)}`,
    openInNomi: buildProductionDeepLink(run.projectId, run.runId, artifact.artifactId),
  }
}

function safeRunProjection(run: ProductionRun): Omit<ProductionRunProjection, 'artifacts' | 'openInNomi'> {
  return {
    schemaVersion: run.schemaVersion,
    runId: run.runId,
    projectId: run.projectId,
    revision: run.revision,
    status: run.status,
    stageId: run.stageId,
    playbook: { name: run.playbook.name, version: run.playbook.version },
    origin: { host: run.origin.host, ...(run.origin.actorId ? { actorId: run.origin.actorId } : {}) },
    budget: { ...run.budget },
    planVersion: run.planVersion,
    snapshotCursor: run.snapshotCursor,
    stages: run.stages.map((stage) => ({
      stageId: stage.stageId, title: safeExternalText(stage.title), status: stage.status, order: stage.order,
      ...(stage.startedAt ? { startedAt: stage.startedAt } : {}),
      ...(stage.completedAt ? { completedAt: stage.completedAt } : {}),
    })),
    gates: run.gates.map((gate) => ({
      gateId: gate.gateId, scope: gate.scope, status: gate.status, title: safeExternalText(gate.title), summary: safeExternalText(gate.summary),
      createdAt: gate.createdAt, expiresAt: gate.expiresAt, ...(gate.decidedAt ? { decidedAt: gate.decidedAt } : {}),
      ...(gate.contract ? { contract: safeProductionContract(gate.contract) } : {}),
    })),
    jobs: run.jobs.map((job) => ({
      jobId: job.jobId, stageId: job.stageId, status: job.status, attempt: job.attempt,
      ...(job.progressPercent !== undefined ? { progressPercent: job.progressPercent } : {}),
      ...(job.lastPollAt ? { lastPollAt: job.lastPollAt } : {}),
      ...(job.lastVendorStateChangeAt ? { lastVendorStateChangeAt: job.lastVendorStateChangeAt } : {}),
      ...(job.errorCode ? { errorCode: job.errorCode } : {}),
      createdAt: job.createdAt, updatedAt: job.updatedAt,
    })),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }
}

export function createProductionRunProjection(
  run: ProductionRun,
  projectRootResolver: (projectId: string) => string | null,
  previewSecret: string,
): ProductionRunProjection {
  const safeRun = safeRunProjection(run)
  return {
    ...safeRun,
    artifacts: run.artifacts.map((artifact) => {
      const root = projectRootResolver(run.projectId)
      if (root && (artifact.projectRelativePath || artifact.thumbnailRelativePath)) {
        try {
          const projected = createArtifactProjection({ projectRoot: root, run, artifact, secret: previewSecret })
          const { runId: _runId, projectId: _projectId, openInNomi: _openInNomi, ...safeArtifact } = projected
          return safeArtifact
        } catch {
          // Missing or changed files must not hide the Run itself; expose metadata without a preview.
        }
      }
      const { runId: _runId, projectId: _projectId, openInNomi: _openInNomi, ...safeArtifact } = createProductionArtifactMetadataProjection(run, artifact)
      return safeArtifact
    }),
    openInNomi: buildProductionDeepLink(run.projectId, run.runId),
  }
}

export function createProductionEventProjection(event: RunEvent): ProductionEventProjection {
  return {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    cursor: event.cursor,
    runId: event.runId,
    runRevision: event.runRevision,
    commandId: event.commandId,
    type: event.type,
    message: safeExternalText(event.message),
    emittedAt: event.emittedAt,
    ...(event.stageId ? { stageId: event.stageId } : {}),
    ...(event.jobId ? { jobId: event.jobId } : {}),
    ...(event.artifactId ? { artifactId: event.artifactId } : {}),
    ...(event.causationId ? { causationId: event.causationId } : {}),
    ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    ...(event.attemptId ? { attemptId: event.attemptId } : {}),
    ...(event.providerOccurredAt ? { providerOccurredAt: event.providerOccurredAt } : {}),
  }
}
