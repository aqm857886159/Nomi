import type {
  ProductionArtifact,
  ProductionJob,
  ProductionRun,
} from '../../../electron/productionRun/productionRunTypes'

export type ProductionRunTone = 'working' | 'attention' | 'danger' | 'success' | 'neutral'
export type ProductionRunPrimaryAction = 'open-stage' | 'open-gate' | 'review-storyboard' | 'reconcile' | 'review-rough-cut' | 'open-export' | null

export type ProductionRunView = {
  tone: ProductionRunTone
  titleKey: string
  descriptionKey: string
  percent?: number
  primaryAction: ProductionRunPrimaryAction
  targetId?: string
  originHost: string
  preview?: {
    artifactId: string
    kind: ProductionArtifact['kind']
    thumbnailRelativePath?: string
    projectRelativePath?: string
  }
  details: {
    completedStages: number
    totalStages: number
    budget: ProductionRun['budget']
    updatedAt: string
    stages: Array<Pick<ProductionRun['stages'][number], 'stageId' | 'title' | 'status'>>
    skills: Array<{ name: string; version: string }>
  }
}

function safeRelativePath(value: string | undefined): value is string {
  if (!value || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false
  return !value.split(/[\\/]+/).includes('..')
}

function latestSafePreview(artifacts: ProductionArtifact[]): ProductionRunView['preview'] {
  const latest = [...artifacts]
    .filter((artifact) => artifact.status !== 'rejected'
      && ['image', 'video', 'export'].includes(artifact.kind)
      && (safeRelativePath(artifact.thumbnailRelativePath) || safeRelativePath(artifact.projectRelativePath)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (!latest) return undefined
  return {
    artifactId: latest.artifactId,
    kind: latest.kind,
    ...(safeRelativePath(latest.thumbnailRelativePath) ? { thumbnailRelativePath: latest.thumbnailRelativePath } : {}),
    ...(safeRelativePath(latest.projectRelativePath) ? { projectRelativePath: latest.projectRelativePath } : {}),
  }
}

function latestJob(run: ProductionRun): ProductionJob | undefined {
  return [...run.jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

function validPercent(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined
}

export function buildProductionRunView(
  run: ProductionRun,
  now = Date.now(),
  options: { staleAfterMs?: number } = {},
): ProductionRunView {
  const staleAfterMs = options.staleAfterMs ?? 2 * 60_000
  const job = latestJob(run)
  const unknown = run.jobs.find((value) => value.status === 'submission_unknown')
  const waitingGate = run.gates.find((value) => value.status === 'waiting')
  const skills = [...new Map(
    run.gates.flatMap((gate) => gate.contract?.skills ?? [])
      .map((skill) => [`${skill.name}\u0000${skill.version}`, skill]),
  ).values()]
  const base = {
    originHost: ['nomi', 'claude', 'codex', 'cursor'].includes(run.origin.host)
      ? run.origin.host
      : (['claude', 'codex', 'cursor'].includes(run.origin.actorId || '') ? run.origin.actorId! : 'external'),
    preview: latestSafePreview(run.artifacts),
    details: {
      completedStages: run.stages.filter((stage) => stage.status === 'completed').length,
      totalStages: run.stages.length,
      budget: run.budget,
      updatedAt: run.updatedAt,
      stages: [...run.stages]
        .sort((left, right) => left.order - right.order)
        .map(({ stageId, title, status }) => ({ stageId, title, status })),
      skills,
    },
  }

  if (unknown) {
    return {
      ...base,
      tone: 'danger',
      titleKey: 'production.status.submissionUnknown',
      descriptionKey: 'production.description.submissionUnknown',
      primaryAction: 'reconcile',
      targetId: unknown.jobId,
    }
  }
  if (run.status === 'completed') {
    return {
      ...base,
      tone: 'success',
      titleKey: 'production.status.completed',
      descriptionKey: 'production.description.completed',
      primaryAction: null,
    }
  }
  if (run.status === 'awaiting_storyboard_review') {
    return {
      ...base,
      tone: 'attention',
      titleKey: 'production.status.storyboardReady',
      descriptionKey: 'production.description.storyboardReady',
      primaryAction: 'review-storyboard',
      targetId: run.stageId,
    }
  }
  if (run.status === 'awaiting_rough_cut_review') {
    return {
      ...base,
      tone: 'attention',
      titleKey: 'production.status.roughCutReady',
      descriptionKey: 'production.description.roughCutReady',
      primaryAction: 'review-rough-cut',
    }
  }
  if (run.status === 'awaiting_export') {
    return {
      ...base,
      tone: 'attention',
      titleKey: 'production.status.exportReady',
      descriptionKey: 'production.description.exportReady',
      primaryAction: waitingGate ? 'open-gate' : 'open-export',
      ...(waitingGate ? { targetId: waitingGate.gateId } : {}),
    }
  }
  const rejectedContract = run.status === 'awaiting_contract'
    ? [...run.gates].reverse().find((value) => value.scope === 'budget_envelope' && value.status === 'rejected')
    : undefined
  if (rejectedContract) {
    return {
      ...base,
      tone: 'neutral',
      titleKey: 'production.status.contractDeclined',
      descriptionKey: 'production.description.contractDeclined',
      primaryAction: null,
      targetId: rejectedContract.gateId,
    }
  }
  if (waitingGate) {
    return {
      ...base,
      tone: 'attention',
      titleKey: 'production.status.approvalRequired',
      descriptionKey: 'production.description.approvalRequired',
      primaryAction: 'open-gate',
      targetId: waitingGate.gateId,
    }
  }
  if (run.status === 'needs_attention' || job?.status === 'needs_attention') {
    return {
      ...base,
      tone: 'danger',
      titleKey: 'production.status.needsAttention',
      descriptionKey: 'production.description.needsAttention',
      primaryAction: 'open-stage',
      targetId: job?.jobId ?? run.stageId,
    }
  }
  const vendorStateAt = job?.lastVendorStateChangeAt ? Date.parse(job.lastVendorStateChangeAt) : Number.NaN
  const vendorIsStale = job && ['provider_accepted', 'polling', 'retry_wait'].includes(job.status)
    && Number.isFinite(vendorStateAt) && now - vendorStateAt >= staleAfterMs
  if (vendorIsStale) {
    return {
      ...base,
      tone: 'attention',
      titleKey: 'production.status.providerStale',
      descriptionKey: 'production.description.providerStale',
      primaryAction: 'open-stage',
      targetId: job.jobId,
    }
  }
  const percent = validPercent(job?.progressPercent)
  return {
    ...base,
    tone: run.status === 'draft' ? 'neutral' : 'working',
    titleKey: run.status === 'draft' ? 'production.status.draft' : 'production.status.running',
    descriptionKey: run.status === 'draft' ? 'production.description.draft' : 'production.description.running',
    ...(percent === undefined ? {} : { percent }),
    primaryAction: 'open-stage',
    targetId: job?.jobId ?? run.stageId,
  }
}
