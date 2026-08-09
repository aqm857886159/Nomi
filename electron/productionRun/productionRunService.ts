import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  createProductionRunRepository,
  type ProductionRunRepository,
} from './productionRunRepository'
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { getWorkspaceRepositoryDeps } from '../runtimePaths'
import {
  createArtifactProjection,
  getArtifactPreviewSecret,
  resolveOwnedArtifactFile,
  verifyArtifactPreviewHandle,
  type ArtifactProjection,
} from './artifactProjection'
import { buildProductionDeepLink } from './productionDeepLink'
import { safeExternalText, safeProductionContract } from './productionRunProjectionSanitizer'
import { readAutomationPolicySettings } from '../settings/automationPolicySettings'
import { assertProductionPolicyReady } from './productionPolicyReadiness'
import type {
  AutomationPolicy,
  CreateProductionRunInput,
  ProductionArtifact,
  ProductionRun,
  RunEvent,
  RunCommand,
} from './productionRunTypes'

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

type ServiceDeps = {
  repository?: ProductionRunRepository
  sleep?: (delayMs: number) => Promise<void>
  projectRootResolver?: (projectId: string) => string | null
  previewSecret?: string
  requestRenderer?: (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>
  policyResolver?: () => Partial<AutomationPolicy>
  reconcileProviderTask?: (job: ProductionRun['jobs'][number]) => Promise<{
    status?: string
    assets?: Array<{ type?: string; url?: string; thumbnailUrl?: string }>
    error?: string
  }>
}

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
  'job.submission_unknown',
  'job.needs_attention',
  'job.vendor_state_stale',
  'skill.loaded',
  'skill.applied',
  'plan.proposed',
  'plan.attached',
])

function identifier(value: string, label: string): string {
  const normalized = String(value || '').trim()
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized) || normalized === '.' || normalized === '..') throw new Error(`Invalid ${label} id`)
  return normalized
}

/** Job ids intentionally contain a namespace separator (`job:run:node`), but artifact ids are
 * public deep-link identifiers. Keep the mapping stable, collision-resistant, and URL-safe. */
function artifactIdentifierForJob(jobId: string): string {
  const base = jobId.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'job'
  const suffix = crypto.createHash('sha256').update(jobId).digest('hex').slice(0, 10)
  return `artifact-job-${base}-${suffix}`
}

function metadataProjection(run: ProductionRun, artifact: ProductionArtifact): Omit<ArtifactProjection, 'preview'> {
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

function runProjection(
  run: ProductionRun,
  projectRootResolver: (projectId: string) => string | null,
  previewSecret: string,
): ProductionRunProjection {
  const { artifacts } = run
  const safeRun = safeRunProjection(run)
  return {
    ...safeRun,
    artifacts: artifacts.map((artifact) => {
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
      const { runId: _runId, projectId: _projectId, openInNomi: _openInNomi, ...safeArtifact } = metadataProjection(run, artifact)
      return safeArtifact
    }),
    openInNomi: buildProductionDeepLink(run.projectId, run.runId),
  }
}

function eventProjection(event: RunEvent): ProductionEventProjection {
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

export function createProductionRunService(deps: ServiceDeps = {}) {
  const repository = deps.repository ?? createProductionRunRepository()
  const sleep = deps.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)))
  const projectRootResolver = deps.projectRootResolver ?? ((projectId: string) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()))
  const previewSecret = deps.previewSecret ?? getArtifactPreviewSecret()
  const requestRenderer = deps.requestRenderer ?? (async (op: string, payload: unknown, timeoutMs: number) => {
    const bridge = await import('../capabilityCore/rendererBridge')
    return bridge.requestRenderer(op, payload, timeoutMs)
  })
  const policyResolver = deps.policyResolver ?? (() => {
    const settings = readAutomationPolicySettings()
    return {
      mode: settings.mode,
      trustedHosts: [...settings.trustedHosts],
      allowedProviders: [...settings.allowedProviders],
      allowedModels: [...settings.allowedModels],
      maxSpend: settings.maxSpend,
      maxAttemptsPerJob: settings.maxAttemptsPerJob,
      minimizeUploads: settings.minimizeUploads,
    }
  })
  const inFlight = new Set<string>()
  const recoveryInFlight = new Set<string>()
  const reconciliationInFlight = new Set<string>()
  const reconcileProviderTask = deps.reconcileProviderTask ?? (async (job) => {
    if (!job.providerTaskId) throw new Error('供应商任务标识尚未收到，不能自动对账')
    const runtime = await import('../runtime')
    const response = await runtime.fetchTaskResult({
      taskId: job.providerTaskId,
      vendor: job.provider,
      taskKind: job.taskKind || 'text_to_video',
      prompt: '',
      modelKey: job.model,
    })
    return response.result
  })

  function requireRun(projectId: string, runId: string): ProductionRun {
    const safeProjectId = identifier(projectId, 'project')
    const safeRunId = identifier(runId, 'run')
    const run = repository.read(safeProjectId, safeRunId)
    if (!run) throw new Error(`Production run not found: ${safeRunId}`)
    if (run.projectId !== safeProjectId) throw new Error('Production run project mismatch')
    return run
  }

  function createDraft(input: CreateProductionRunInput): ProductionRunProjection {
    const run = repository.create({
      ...input,
      runId: input.runId ? identifier(input.runId, 'run') : undefined,
      policy: { ...policyResolver(), ...(input.policy || {}) },
    })
    if (!['draft', 'awaiting_direction'].includes(run.status) || run.jobs.length > 0 || (run.status === 'draft' && run.gates.length > 0) || run.budget.authorized !== 0) {
      throw new Error('Production draft invariant failed')
    }
    return runProjection(run, projectRootResolver, previewSecret)
  }

  function writeProjectJson(projectId: string, relativePath: string, value: unknown): void {
    const root = projectRootResolver(projectId)
    if (!root || relativePath.startsWith('/') || relativePath.split(/[\\/]+/).includes('..')) throw new Error('Production project artifact root unavailable')
    const target = path.resolve(root, relativePath)
    const rootWithSep = `${path.resolve(root)}${path.sep}`
    if (target !== path.resolve(root) && !target.startsWith(rootWithSep)) throw new Error('Production artifact path escapes project')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  function planValue(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Storyboard planner returned no plan')
    const record = value as Record<string, unknown>
    const plan = record.plan
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Storyboard planner returned no structured plan')
    return plan as Record<string, unknown>
  }

  async function proposeStoryboard(run: ProductionRun): Promise<void> {
    if (inFlight.has(run.runId)) return
    if (run.status !== 'running' || run.stageId !== 'direction') return
    inFlight.add(run.runId)
    try {
      const planResult = await requestRenderer('production.plan-storyboard', {
        projectId: run.projectId,
        runId: run.runId,
        brief: run.brief,
        playbook: run.playbook,
      }, 5 * 60_000)
      const plan = planValue(planResult)
      const hash = crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex')
      const current = requireRun(run.projectId, run.runId)
      const scriptPath = `.nomi/runs/${run.runId}/script-v${current.planVersion}.json`
      const storyboardPath = `.nomi/runs/${run.runId}/storyboard-v${current.planVersion}.json`
      writeProjectJson(run.projectId, scriptPath, { schemaVersion: 1, kind: 'script', planHash: hash, brief: run.brief, plan })
      writeProjectJson(run.projectId, storyboardPath, { schemaVersion: 1, kind: 'storyboard', planHash: hash, plan })
      const timestamp = new Date().toISOString()
      const artifacts = [
        { artifactId: `artifact-script-v${current.planVersion}`, stageId: 'script', kind: 'script' as const, status: 'adopted' as const, projectRelativePath: scriptPath, createdAt: timestamp, adoptedAt: timestamp },
        { artifactId: `artifact-storyboard-v${current.planVersion}`, stageId: 'storyboard', kind: 'storyboard' as const, status: 'candidate' as const, projectRelativePath: storyboardPath, createdAt: timestamp },
      ]
      const result = repository.execute(run.projectId, run.runId, {
        commandId: `driver:${run.runId}:plan-proposed:${hash.slice(0, 16)}`,
        expectedRevision: current.revision,
        type: 'plan.proposed',
        payload: { artifacts },
        issuedAt: timestamp,
      })
      // The skill evidence is a separate durable fact, so the user can see that the director skill actually ran.
      repository.execute(run.projectId, run.runId, {
        commandId: `driver:${run.runId}:skill:${hash.slice(0, 16)}`,
        expectedRevision: result.run.revision,
        type: 'skill.evidence',
        payload: { skillName: 'brand.promo', version: run.playbook.version },
        issuedAt: timestamp,
      })
    } catch (error) {
      const current = repository.read(run.projectId, run.runId)
      if (current && current.status === 'running') {
        try {
          repository.execute(run.projectId, run.runId, {
            commandId: `driver:${run.runId}:plan-error:${current.revision}`,
            expectedRevision: current.revision,
            type: 'run.status',
            payload: { status: 'needs_attention' },
            issuedAt: new Date().toISOString(),
          })
        } catch {
          // Preserve the original planning failure; the run remains inspectable on disk.
        }
      }
      console.error('[nomi:production] storyboard planning failed:', error instanceof Error ? error.message : String(error))
    } finally {
      inFlight.delete(run.runId)
    }
  }

  function executeInternal(projectId: string, runId: string, current: ProductionRun, type: string, payload: Record<string, unknown>, commandId: string) {
    return repository.execute(projectId, runId, { commandId, expectedRevision: current.revision, type, payload, issuedAt: new Date().toISOString() })
  }

  function localAssetPath(projectId: string, rawUrl: unknown): string | undefined {
    if (typeof rawUrl !== 'string' || !rawUrl.startsWith('nomi-local://asset/')) return undefined
    const rest = rawUrl.slice('nomi-local://asset/'.length).split(/[?#]/, 1)[0]
    const segments = rest.split('/').filter(Boolean)
    if (segments.length < 2) return undefined
    try {
      const owner = decodeURIComponent(segments[0])
      const relativePath = segments.slice(1).map((segment) => decodeURIComponent(segment)).join('/')
      if (owner !== projectId || !relativePath || relativePath.split(/[\\/]+/).includes('..') || relativePath.startsWith('/')) return undefined
      return relativePath
    } catch {
      return undefined
    }
  }

  function projectRelativePath(projectId: string, rawPath: unknown, options: { requireFile?: boolean } = {}): string {
    const relativePath = typeof rawPath === 'string' ? rawPath.trim() : ''
    const root = projectRootResolver(projectId)
    if (!root || !relativePath || relativePath.includes('\0') || relativePath.startsWith('/') || relativePath.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(relativePath) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(relativePath) || relativePath.split(/[\\/]+/).includes('..')) {
      throw new Error('导出必须返回项目目录内的相对路径')
    }
    const target = path.resolve(root, relativePath)
    const rootPath = path.resolve(root)
    const rootWithSep = `${rootPath}${path.sep}`
    if (target !== rootPath && !target.startsWith(rootWithSep)) throw new Error('导出路径不能离开项目目录')
    if (options.requireFile) {
      let stat: fs.Stats
      try { stat = fs.statSync(target) } catch { throw new Error('导出文件不存在') }
      if (!stat.isFile()) throw new Error('导出结果不是文件')
    }
    return relativePath.replaceAll('\\', '/')
  }

  function stageValue(run: ProductionRun, stageId: string, patch: Record<string, unknown>): Record<string, unknown> {
    const stage = run.stages.find((candidate) => candidate.stageId === stageId)
    if (!stage) throw new Error(`Production stage not found: ${stageId}`)
    return { ...stage, ...patch, stageId }
  }

  async function driveGeneration(run: ProductionRun): Promise<void> {
    if (inFlight.has(run.runId)) return
    inFlight.add(run.runId)
    try {
      let current = requireRun(run.projectId, run.runId)
      if (current.status === 'ready') {
        current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'running' }, `driver-${run.runId}-generation-start`).run
      }
      const jobs = current.jobs.filter((job) => job.status === 'authorized' || job.status === 'submit_intent_persisted')
      for (const job of jobs) {
        current = requireRun(run.projectId, run.runId)
        if (job.status === 'authorized') current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'submit_intent_persisted' }, `driver-${job.jobId}-intent`).run
        current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'submitting' }, `driver-${job.jobId}-submit`).run
        try {
          const result = await requestRenderer('production.generate-node', {
            projectId: run.projectId,
            runId: run.runId,
            jobId: job.jobId,
            nodeId: job.nodeId,
            maxAttemptsPerJob: current.policy.maxAttemptsPerJob,
            idempotencyKey: job.idempotencyKey,
          }, 30 * 60_000) as { assets?: Array<{ type?: string; url?: string; thumbnailUrl?: string }> }
          for (const status of ['provider_accepted', 'polling', 'downloading', 'validating_technical', 'validating_content'] as const) {
            current = requireRun(run.projectId, run.runId)
            current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status }, `driver-${job.jobId}-${status}`).run
          }
          const asset = result?.assets?.[0]
          const relativePath = localAssetPath(run.projectId, asset?.url)
          const thumbnailRelativePath = localAssetPath(run.projectId, asset?.thumbnailUrl)
          current = requireRun(run.projectId, run.runId)
          if (asset?.url && relativePath) {
            current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'ready' }, `driver-${job.jobId}-ready`).run
            const kind = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
            current = executeInternal(run.projectId, run.runId, current, 'artifact.add', {
              artifact: { artifactId: artifactIdentifierForJob(job.jobId), stageId: 'generate', jobId: job.jobId, kind, status: 'adopted', projectRelativePath: relativePath, ...(thumbnailRelativePath ? { thumbnailRelativePath } : {}), createdAt: new Date().toISOString(), adoptedAt: new Date().toISOString() },
            }, `driver-${job.jobId}-artifact`).run
            current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'adopted' }, `driver-${job.jobId}-adopted`).run
          } else {
            current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'needs_attention', patch: { errorCode: 'asset_not_localized', errorMessage: '生成已返回，但项目内没有可预览的本地素材' } }, `driver-${job.jobId}-asset-attention`).run
            if (current.status !== 'needs_attention') {
              current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'needs_attention' }, `driver-${run.runId}-asset-attention-${current.revision}`).run
            }
            return
          }
        } catch (error) {
          current = requireRun(run.projectId, run.runId)
          if (current.jobs.find((candidate) => candidate.jobId === job.jobId)?.status === 'submitting') {
            current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'submission_unknown', patch: { errorCode: 'renderer_or_provider_unknown', errorMessage: '生成提交结果无法确认' } }, `driver-${job.jobId}-unknown-${current.revision}`).run
          }
          if (current.status !== 'needs_attention') {
            try { current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'needs_attention' }, `driver-${run.runId}-generation-attention-${current.revision}`).run } catch { /* preserve unknown job state */ }
          }
          console.error('[nomi:production] generation driver stopped:', error instanceof Error ? error.message : String(error))
          return
        }
      }
      current = requireRun(run.projectId, run.runId)
      if (current.jobs.some((job) => !['adopted', 'cancelled_remote', 'detached'].includes(job.status))) return
      current = executeInternal(run.projectId, run.runId, current, 'stage.upsert', { stage: stageValue(current, 'generate', { status: 'completed', completedAt: new Date().toISOString() }) }, `driver-${run.runId}-stage-generate`).run
      current = executeInternal(run.projectId, run.runId, current, 'stage.upsert', { stage: stageValue(current, 'qa', { status: 'completed', completedAt: new Date().toISOString() }) }, `driver-${run.runId}-stage-qa`).run
      current = executeInternal(run.projectId, run.runId, current, 'stage.upsert', { stage: stageValue(current, 'assemble', { status: 'running', startedAt: new Date().toISOString() }) }, `driver-${run.runId}-stage-assemble`).run
      const arrangement = await requestRenderer('production.arrange', { projectId: run.projectId, runId: run.runId }, 5 * 60_000)
      const timelinePath = `.nomi/runs/${run.runId}/timeline-v${current.planVersion}.json`
      writeProjectJson(run.projectId, timelinePath, { schemaVersion: 1, kind: 'timeline', arrangement })
      current = requireRun(run.projectId, run.runId)
      current = executeInternal(run.projectId, run.runId, current, 'artifact.add', { artifact: { artifactId: `artifact-timeline-v${current.planVersion}`, stageId: 'assemble', kind: 'timeline', status: 'adopted', projectRelativePath: timelinePath, createdAt: new Date().toISOString(), adoptedAt: new Date().toISOString() } }, `driver-${run.runId}-timeline`).run
      const exportGate = { gateId: `gate-export-v${current.planVersion}`, scope: 'export' as const, status: 'waiting' as const, planHash: crypto.createHash('sha256').update(JSON.stringify(arrangement)).digest('hex'), jobIds: [], title: 'Review rough cut and approve export', summary: 'Check pacing and media in Preview before explicitly approving the MP4 export.', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
      current = executeInternal(run.projectId, run.runId, current, 'gate.add', { gate: exportGate }, `driver-${run.runId}-export-gate`).run
      current = executeInternal(run.projectId, run.runId, current, 'stage.upsert', { stage: stageValue(current, 'assemble', { status: 'completed', completedAt: new Date().toISOString() }) }, `driver-${run.runId}-stage-assemble-complete`).run
      current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'awaiting_rough_cut_review' }, `driver-${run.runId}-rough-cut`).run
    } catch (error) {
      console.error('[nomi:production] generation/assembly driver failed:', error instanceof Error ? error.message : String(error))
    } finally {
      inFlight.delete(run.runId)
    }
  }

  async function driveExport(run: ProductionRun): Promise<void> {
    if (inFlight.has(run.runId)) return
    inFlight.add(run.runId)
    try {
      let current = requireRun(run.projectId, run.runId)
      current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'exporting' }, `driver-${run.runId}-export-start`).run
      const result = await requestRenderer('production.export', { projectId: run.projectId, runId: run.runId, outputName: `nomi-${run.runId}.mp4` }, 30 * 60_000) as { relativePath?: string; size?: number }
      const relativePath = projectRelativePath(run.projectId, result?.relativePath, { requireFile: true })
      current = requireRun(run.projectId, run.runId)
      current = executeInternal(run.projectId, run.runId, current, 'artifact.add', { artifact: { artifactId: `artifact-export-v${current.planVersion}`, stageId: 'export', kind: 'export', status: 'adopted', projectRelativePath: relativePath, createdAt: new Date().toISOString(), adoptedAt: new Date().toISOString() } }, `driver-${run.runId}-export-artifact`).run
      current = executeInternal(run.projectId, run.runId, current, 'stage.upsert', { stage: stageValue(current, 'export', { status: 'completed', completedAt: new Date().toISOString() }) }, `driver-${run.runId}-stage-export`).run
      executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'completed' }, `driver-${run.runId}-completed`)
    } catch (error) {
      const current = repository.read(run.projectId, run.runId)
      if (current && current.status === 'exporting') {
        try { executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'needs_attention' }, `driver-${run.runId}-export-attention-${current.revision}`) } catch { /* preserve export error */ }
      }
      console.error('[nomi:production] export driver failed:', error instanceof Error ? error.message : String(error))
    } finally {
      inFlight.delete(run.runId)
    }
  }

  async function driveReconciliation(projectId: string, runId: string, jobId: string): Promise<void> {
    const key = `${projectId}:${runId}:${jobId}`
    if (reconciliationInFlight.has(key)) return
    reconciliationInFlight.add(key)
    try {
      while (true) {
        let current = requireRun(projectId, runId)
        let job = current.jobs.find((candidate) => candidate.jobId === jobId)
        if (!job || !['reconciling', 'provider_accepted', 'polling'].includes(job.status)) return
        const result = await reconcileProviderTask(job)
        const status = String(result.status || '').toLowerCase()
        if (['queued', 'running', 'processing', 'pending'].includes(status)) {
          if (job.status === 'reconciling') {
            current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'provider_accepted' }, `reconcile-${jobId}-accepted-${current.revision}`).run
            current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'polling' }, `reconcile-${jobId}-polling-${current.revision}`).run
          }
          if (current.status === 'needs_attention') {
            current = executeInternal(projectId, runId, current, 'run.status', { status: 'running' }, `reconcile-${runId}-running-${current.revision}`).run
          }
          await sleep(2_000)
          continue
        }
        if (status !== 'succeeded') {
          current = requireRun(projectId, runId)
          job = current.jobs.find((candidate) => candidate.jobId === jobId)
          if (job && ['reconciling', 'polling'].includes(job.status)) {
            if (job.status === 'reconciling') {
              current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'needs_attention', patch: { errorCode: 'reconcile_failed', errorMessage: result.error || '供应商任务未找到或已失败' } }, `reconcile-${jobId}-failed-${current.revision}`).run
            } else {
              current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'needs_attention', patch: { errorCode: 'reconcile_failed', errorMessage: result.error || '供应商任务未找到或已失败' } }, `reconcile-${jobId}-failed-${current.revision}`).run
            }
          }
          return
        }

        current = requireRun(projectId, runId)
        job = current.jobs.find((candidate) => candidate.jobId === jobId)
        if (!job) return
        if (job.status === 'reconciling') {
          current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'provider_accepted' }, `reconcile-${jobId}-accepted-${current.revision}`).run
          current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'polling' }, `reconcile-${jobId}-polling-${current.revision}`).run
        }
        for (const nextStatus of ['downloading', 'validating_technical', 'validating_content'] as const) {
          current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: nextStatus }, `reconcile-${jobId}-${nextStatus}-${current.revision}`).run
        }
        const asset = result.assets?.[0]
        const relativePath = localAssetPath(projectId, asset?.url)
        const thumbnailRelativePath = localAssetPath(projectId, asset?.thumbnailUrl)
        if (!asset?.url || !relativePath) {
          executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'needs_attention', patch: { errorCode: 'reconcile_asset_not_local', errorMessage: '对账找到了任务，但结果尚未落入本地项目' } }, `reconcile-${jobId}-asset-${current.revision}`)
          return
        }
        current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'ready' }, `reconcile-${jobId}-ready-${current.revision}`).run
        const kind = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
        current = executeInternal(projectId, runId, current, 'artifact.add', {
          artifact: { artifactId: artifactIdentifierForJob(jobId), stageId: job.stageId, jobId, kind, status: 'adopted', projectRelativePath: relativePath, ...(thumbnailRelativePath ? { thumbnailRelativePath } : {}), createdAt: new Date().toISOString(), adoptedAt: new Date().toISOString() },
        }, `reconcile-${jobId}-artifact-${current.revision}`).run
        current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'adopted' }, `reconcile-${jobId}-adopted-${current.revision}`).run
        if (current.status === 'needs_attention') {
          current = executeInternal(projectId, runId, current, 'run.status', { status: 'running' }, `reconcile-${runId}-resume-${current.revision}`).run
        }
        void driveGeneration(current)
        return
      }
    } catch (error) {
      let current = repository.read(projectId, runId)
      const job = current?.jobs.find((candidate) => candidate.jobId === jobId)
      if (current && job && ['reconciling', 'polling'].includes(job.status)) {
        try {
          current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'needs_attention', patch: { errorCode: 'reconcile_error', errorMessage: error instanceof Error ? error.message : String(error) } }, `reconcile-${jobId}-error-${current.revision}`).run
        } catch { /* Preserve the latest durable state. */ }
      }
    } finally {
      reconciliationInFlight.delete(key)
    }
  }

  async function command(projectId: string, runId: string, runCommand: RunCommand) {
    const safeProjectId = identifier(projectId, 'project')
    const safeRunId = identifier(runId, 'run')
    const prior = repository.readEvents(safeProjectId, safeRunId).filter((event) => event.commandId === runCommand.commandId)
    if (prior.length > 0) return { run: requireRun(safeProjectId, safeRunId), events: prior }
    if (runCommand.type === 'policy.refresh') {
      const current = requireRun(safeProjectId, safeRunId)
      return repository.execute(safeProjectId, safeRunId, {
        ...runCommand,
        type: 'policy.set',
        payload: { policy: { ...current.policy, ...policyResolver() } },
      })
    }
    if (runCommand.type === 'job.reconcile') {
      const current = requireRun(safeProjectId, safeRunId)
      const jobId = typeof runCommand.payload.jobId === 'string' ? runCommand.payload.jobId.trim() : ''
      const outcome = runCommand.payload.outcome
      const job = current.jobs.find((candidate) => candidate.jobId === jobId)
      if (!job || job.status !== 'submission_unknown') throw new Error('Production job is not awaiting reconciliation')
      if (outcome === 'not_found') {
        return repository.execute(safeProjectId, safeRunId, {
          ...runCommand,
          type: 'job.status',
          payload: { jobId, status: 'needs_attention', patch: { errorCode: 'provider_task_not_found', errorMessage: '已核对供应商：没有找到原任务；Nomi 未自动重新提交' } },
        })
      }
      if (outcome !== 'found') throw new Error('Invalid production reconciliation outcome')
      if (!job.providerTaskId) throw new Error('尚未收到供应商任务标识，不能自动恢复；请保持暂停并联系供应商核对')
      const result = repository.execute(safeProjectId, safeRunId, {
        ...runCommand,
        type: 'job.status',
        payload: { jobId, status: 'reconciling' },
      })
      void driveReconciliation(safeProjectId, safeRunId, jobId)
      return result
    }
    if (runCommand.type === 'plan.attach') {
      const current = requireRun(safeProjectId, safeRunId)
      const artifactId = typeof runCommand.payload.artifactId === 'string' ? runCommand.payload.artifactId : ''
      const artifact = current.artifacts.find((item) => item.artifactId === artifactId && item.kind === 'storyboard')
      if (!artifact) throw new Error('Storyboard artifact is not ready to attach')
      const bindings = Array.isArray(runCommand.payload.bindings) ? runCommand.payload.bindings : []
      const jobs = bindings.map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid storyboard binding ${index}`)
        const binding = value as Record<string, unknown>
        const nodeId = typeof binding.nodeId === 'string' ? binding.nodeId.trim() : ''
        const provider = typeof binding.provider === 'string' ? binding.provider.trim() : ''
        const model = typeof binding.model === 'string' ? binding.model.trim() : ''
        const stageId = typeof binding.stageId === 'string' && binding.stageId.trim() ? binding.stageId.trim() : 'generate'
        if (!nodeId || !provider || !model) throw new Error('Every production shot must have a provider and model before approval')
        return {
          jobId: `job:${safeRunId}:${nodeId}`,
          stageId,
          status: 'authorization_required' as const,
          attempt: 0,
          provider,
          model,
          idempotencyKey: `production:${safeRunId}:${nodeId}`,
          nodeId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      })
      const maxSpend = current.policy.maxSpend
      const gate = {
        gateId: `gate-contract-v${current.planVersion}`,
        scope: 'budget_envelope' as const,
        status: 'waiting' as const,
        planHash: typeof runCommand.payload.planHash === 'string' ? runCommand.payload.planHash : crypto.createHash('sha256').update(JSON.stringify(runCommand.payload.bindings)).digest('hex'),
        jobIds: jobs.map((job) => job.jobId),
        title: 'Approve production contract and budget',
        summary: 'Review shots, models, and the hard spend limit before Nomi submits any paid generation.',
        contract: {
          specs: { durationSeconds: current.brief?.durationSeconds, shotCount: jobs.length },
          claims: (current.brief?.sellingPoints || []).map((text, index) => ({ text, evidenceIds: [`brief-${index + 1}`] })),
          evidence: (current.brief?.sellingPoints || []).map((label, index) => ({ evidenceId: `brief-${index + 1}`, label })),
          skills: [{ name: 'brand.promo', version: current.playbook.version }],
          ...(maxSpend !== null ? { estimatedCost: { currency: current.budget.currency, minimum: 0, maximum: maxSpend } } : {}),
        },
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }
      const result = repository.execute(safeProjectId, safeRunId, {
        ...runCommand,
        type: 'plan.attach',
        payload: { artifactId, jobs, gate },
      })
      return result
    }
    if (runCommand.type === 'gate.decide' && runCommand.payload.status === 'approved') {
      const current = requireRun(safeProjectId, safeRunId)
      const gateId = typeof runCommand.payload.gateId === 'string' ? runCommand.payload.gateId.trim() : ''
      const gate = current.gates.find((item) => item.gateId === gateId)
      if (gate?.scope === 'export' && current.status !== 'awaiting_export') {
        throw new Error('请先完成粗剪审看，再单独批准导出')
      }
      if (gate?.scope === 'budget_envelope' && gate.jobIds.length > 0) {
        const jobs = gate.jobIds
          .map((jobId) => current.jobs.find((job) => job.jobId === jobId))
          .filter((job): job is ProductionRun['jobs'][number] => Boolean(job))
        assertProductionPolicyReady(current.policy, jobs)
      }
    }
    const result = repository.execute(safeProjectId, safeRunId, runCommand)
    if (runCommand.type === 'gate.decide' && runCommand.payload.status === 'approved' && runCommand.payload.gateId === 'gate-direction-v1') {
      void proposeStoryboard(result.run)
    }
    if (runCommand.type === 'gate.decide' && runCommand.payload.status === 'approved' && runCommand.payload.gateId === `gate-contract-v${result.run.planVersion}`) {
      void driveGeneration(result.run)
    }
    if (runCommand.type === 'gate.decide' && runCommand.payload.status === 'approved' && runCommand.payload.gateId === `gate-export-v${result.run.planVersion}`) {
      void driveExport(result.run)
    }
    return result
  }

  async function resumeUnfinishedRuns(projectId: string): Promise<void> {
    const safeProjectId = identifier(projectId, 'project')
    if (recoveryInFlight.has(safeProjectId)) return
    recoveryInFlight.add(safeProjectId)
    try {
      const summaries = typeof repository.list === 'function' ? repository.list(safeProjectId) : []
      for (const summary of summaries) {
        let current = repository.read(safeProjectId, summary.runId)
        if (!current || ['completed', 'cancelled'].includes(current.status)) continue
        let changedUnknown = false
        for (const job of current.jobs) {
          if (!['submitting', 'provider_accepted', 'polling', 'retry_wait', 'downloading', 'validating_technical', 'validating_content'].includes(job.status)) continue
          try {
            current = executeInternal(safeProjectId, current.runId, current, 'job.status', {
              jobId: job.jobId,
              status: 'submission_unknown',
              patch: { errorCode: 'restart_recovery_required', errorMessage: 'Nomi 重启后无法确认供应商状态，请先对账' },
            }, `recovery-${current.runId}-${job.jobId}-${current.revision}`).run
            changedUnknown = true
          } catch {
            // A concurrent command may have already reconciled this job.
          }
        }
        current = requireRun(safeProjectId, current.runId)
        if (changedUnknown && current.status !== 'needs_attention') {
          try { current = executeInternal(safeProjectId, current.runId, current, 'run.status', { status: 'needs_attention' }, `recovery-${current.runId}-attention-${current.revision}`).run } catch { /* preserve the durable job state */ }
        }
        if (current.status === 'exporting') {
          try { current = executeInternal(safeProjectId, current.runId, current, 'run.status', { status: 'needs_attention' }, `recovery-${current.runId}-export-attention-${current.revision}`).run } catch { /* preserve exporting state for inspection */ }
        }
        if (current.status === 'running' && current.stageId === 'direction') void proposeStoryboard(current)
        if (current.status === 'ready') void driveGeneration(current)
      }
    } catch (error) {
      console.error('[nomi:production] recovery scan failed:', error instanceof Error ? error.message : String(error))
    } finally {
      recoveryInFlight.delete(safeProjectId)
    }
  }

  function readProjection(projectId: string, runId: string): ProductionRunProjection {
    void resumeUnfinishedRuns(projectId)
    return runProjection(requireRun(projectId, runId), projectRootResolver, previewSecret)
  }

  function readFull(projectId: string, runId: string): ProductionRun {
    return requireRun(projectId, runId)
  }

  async function readEvents(projectId: string, runId: string, afterCursor = 0, waitMs = 0): Promise<{
    events: ProductionEventProjection[]
    nextCursor: number
  }> {
    const run = requireRun(projectId, runId)
    const cursor = Number.isInteger(afterCursor) && afterCursor >= 0 ? afterCursor : 0
    const boundedWaitMs = Math.min(25_000, Math.max(0, Math.floor(waitMs)))
    const deadline = Date.now() + boundedWaitMs
    let durableEvents = repository.readEvents(run.projectId, run.runId, cursor)
    while (durableEvents.length === 0 && Date.now() < deadline) {
      await sleep(Math.min(250, Math.max(1, deadline - Date.now())))
      durableEvents = repository.readEvents(run.projectId, run.runId, cursor)
    }
    const nextCursor = durableEvents.reduce((latest, event) => Math.max(latest, event.cursor), cursor)
    return { events: durableEvents.filter((event) => MEANINGFUL_EVENT_TYPES.has(event.type)).map(eventProjection), nextCursor }
  }

  function readArtifactProjection(projectId: string, runId: string, artifactId: string): ProductionArtifactProjection {
    const run = requireRun(projectId, runId)
    const safeArtifactId = identifier(artifactId, 'artifact')
    const artifact = run.artifacts.find((candidate) => candidate.artifactId === safeArtifactId)
    if (!artifact) throw new Error(`Production artifact not found in run ${run.runId}: ${safeArtifactId}`)
    const root = projectRootResolver(run.projectId)
    if (root && (artifact.projectRelativePath || artifact.thumbnailRelativePath)) {
      try {
        return createArtifactProjection({ projectRoot: root, run, artifact, secret: previewSecret })
      } catch {
        // Return safe metadata when a previously-ready file has been moved or removed.
      }
    }
    return metadataProjection(run, artifact)
  }

  function resolveArtifactPreview(token: string): { filePath: string; expiresAt: string } {
    const claims = verifyArtifactPreviewHandle({ token, secret: previewSecret })
    const run = requireRun(claims.projectId, claims.runId)
    const artifact = run.artifacts.find((candidate) => candidate.artifactId === claims.artifactId)
    if (!artifact) throw new Error('Production artifact preview scope mismatch')
    const relativePath = artifact.thumbnailRelativePath || artifact.projectRelativePath
    if (!relativePath || relativePath.replaceAll('\\', '/') !== claims.relativePath) {
      throw new Error('Production artifact preview path mismatch')
    }
    const root = projectRootResolver(run.projectId)
    if (!root) throw new Error('Production artifact preview root unavailable')
    return { filePath: resolveOwnedArtifactFile(root, claims.relativePath), expiresAt: claims.expiresAt }
  }

  function listProjections(projectId: string): ProductionRunProjection[] {
    return repository.list(identifier(projectId, 'project')).map((summary) => runProjection(requireRun(projectId, summary.runId), projectRootResolver, previewSecret))
  }

  function listFull(projectId: string): ProductionRun[] {
    void resumeUnfinishedRuns(projectId)
    return repository.list(identifier(projectId, 'project')).map((summary) => requireRun(projectId, summary.runId))
  }

  return { createDraft, readProjection, readFull, readEvents, readArtifactProjection, resolveArtifactPreview, command, proposeStoryboard, resumeUnfinishedRuns, listProjections, listFull }
}

export type ProductionRunService = ReturnType<typeof createProductionRunService>
