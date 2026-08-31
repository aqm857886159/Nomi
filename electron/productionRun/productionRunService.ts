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
} from './artifactProjection'
import { readAutomationPolicySettings } from '../settings/automationPolicySettings'
import { assertProductionPolicyReady } from './productionPolicyReadiness'
import { findExecutableModel } from '../catalog/executableModel'
import {
  ProductionProviderUnavailableError,
  rebindProductionProvider,
  type ProductionProviderPreflight,
} from './productionProviderRecovery'
import {
  SubmissionNotDispatchedError,
  createSubmissionOutbox,
} from './submissionOutbox'
import {
  createProductionArtifactMetadataProjection,
  createProductionEventProjection,
  createProductionRunProjection,
  isMeaningfulProductionEvent,
  type ProductionArtifactProjection,
  type ProductionEventProjection,
  type ProductionRunProjection,
} from './productionRunProjection'
import type {
  AutomationPolicy,
  CreateProductionRunInput,
  ProductionRun,
  RunCommand,
} from './productionRunTypes'

export type {
  ProductionArtifactProjection,
  ProductionEventProjection,
  ProductionRunProjection,
} from './productionRunProjection'

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
  preflightProviderModel?: ProductionProviderPreflight
}

function rendererDispatchState(error: unknown): 'not_dispatched' | 'submission_unknown' | 'provider_accepted' | undefined {
  if (!error || typeof error !== 'object') return undefined
  const state = (error as { dispatchState?: unknown }).dispatchState
  if (state === 'not_dispatched' || state === 'submission_unknown' || state === 'provider_accepted') return state
  if ((error as { name?: unknown }).name === 'RendererUnavailableError') return 'not_dispatched'
  return undefined
}

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
  const preflightProviderModel = deps.preflightProviderModel ?? ((job) => {
    findExecutableModel(job.provider, job.model)
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
  const submissionOutbox = createSubmissionOutbox({
    repository,
    dispatch: async (input) => {
      try {
        const result = await requestRenderer('production.generate-node', {
          projectId: input.run.projectId,
          runId: input.run.runId,
          jobId: input.job.jobId,
          nodeId: input.job.nodeId,
          provider: input.job.provider,
          model: input.job.model,
          maxAttemptsPerJob: input.run.policy.maxAttemptsPerJob,
          idempotencyKey: input.idempotencyKey,
        }, 30 * 60_000) as {
          providerTaskId?: string
          assets?: Array<{ type?: string; url?: string; thumbnailUrl?: string }>
        }
        const providerTaskId = typeof result?.providerTaskId === 'string' ? result.providerTaskId.trim() : ''
        if (!providerTaskId) throw new Error('Provider completed without a durable task receipt')
        return { providerTaskId, result }
      } catch (error) {
        if (rendererDispatchState(error) === 'not_dispatched') {
          throw new SubmissionNotDispatchedError(
            error instanceof Error ? error.message : String(error),
            {
              code: typeof (error as { code?: unknown })?.code === 'string'
                ? (error as { code: string }).code
                : 'renderer_not_dispatched',
              retryable: false,
            },
          )
        }
        throw error
      }
    },
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
    return createProductionRunProjection(run, projectRootResolver, previewSecret)
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
      const approvedGate = current.gates.find((gate) =>
        gate.gateId === `gate-contract-v${current.planVersion}`
        && gate.scope === 'budget_envelope'
        && gate.status === 'approved')
      if (!approvedGate) throw new Error('Production generation has no approved contract for the active plan')
      const approvedJobIds = new Set(approvedGate.jobIds)
      const jobs = current.jobs.filter((job) =>
        approvedJobIds.has(job.jobId)
        && (job.status === 'authorized' || job.status === 'submit_intent_persisted'))
      const approval = repository.readApprovals(run.projectId, run.runId)
        .find((item) => item.approvalId === `approval:${approvedGate.gateId}`)
      if (!approval) throw new Error('Production contract approval record is missing')
      const perJobCeiling = approvedGate.jobIds.length > 0
        ? approval.maxSpend / approvedGate.jobIds.length
        : 0
      for (const job of jobs) {
        current = requireRun(run.projectId, run.runId)
        const currentJob = current.jobs.find((candidate) => candidate.jobId === job.jobId)
        if (!currentJob || !['authorized', 'submit_intent_persisted'].includes(currentJob.status)) continue
        try {
          await preflightProviderModel(currentJob)
        } catch (error) {
          current = executeInternal(run.projectId, run.runId, current, 'job.status', {
            jobId: job.jobId,
            status: 'not_dispatched',
            patch: {
              errorCode: 'provider_preflight_failed',
              errorMessage: error instanceof Error ? error.message : String(error),
            },
          }, `driver-${job.jobId}-not-dispatched-${current.revision}`).run
          if (current.status !== 'needs_attention') {
            current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'needs_attention' }, `driver-${run.runId}-preflight-attention-${current.revision}`).run
          }
          return
        }
        try {
          const submission = await submissionOutbox.submit({
            projectId: run.projectId,
            runId: run.runId,
            jobId: job.jobId,
            approvalId: approval.approvalId,
            planHash: approvedGate.planHash,
            costCeiling: perJobCeiling,
            currency: approval.currency,
          })
          const result = submission.result as { assets?: Array<{ type?: string; url?: string; thumbnailUrl?: string }> } | undefined
          current = submission.run
          for (const status of ['polling', 'downloading', 'validating_technical', 'validating_content'] as const) {
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
    if (runCommand.type === 'plan.rebind-provider') {
      const current = requireRun(safeProjectId, safeRunId)
      return rebindProductionProvider({
        projectId: safeProjectId,
        runId: safeRunId,
        current,
        command: runCommand,
        repository,
        requestRenderer,
        preflightProviderModel,
      })
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
      const gate = {
        gateId: `gate-contract-v${current.planVersion}`,
        scope: 'budget_envelope' as const,
        status: 'waiting' as const,
        planHash: typeof runCommand.payload.planHash === 'string' ? runCommand.payload.planHash : crypto.createHash('sha256').update(JSON.stringify(runCommand.payload.bindings)).digest('hex'),
        jobIds: jobs.map((job) => job.jobId),
        title: 'Approve production contract and budget',
        summary: 'Review shots, models, and the production authorization limit before Nomi submits any paid generation.',
        contract: {
          specs: { durationSeconds: current.brief?.durationSeconds, shotCount: jobs.length },
          claims: (current.brief?.sellingPoints || []).map((text) => ({ text, evidenceIds: [] })),
          evidence: [],
          skills: [{ name: 'brand.promo', version: current.playbook.version }],
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
        const activeUnsubmittedJobIds = current.jobs
          .filter((job) => !job.providerTaskId && [
            'authorization_required',
            'authorized',
            'submit_intent_persisted',
            'not_dispatched',
            'needs_attention',
          ].includes(job.status))
          .map((job) => job.jobId)
          .sort()
        const gateJobIds = [...gate.jobIds].sort()
        if (jobs.length !== gate.jobIds.length || JSON.stringify(activeUnsubmittedJobIds) !== JSON.stringify(gateJobIds)) {
          throw new Error('制作合同任务范围不完整；请重新生成合同后再批准')
        }
        assertProductionPolicyReady(current.policy, jobs)
        for (const job of jobs) {
          try {
            await preflightProviderModel(job)
          } catch (error) {
            throw new ProductionProviderUnavailableError(job.provider, job.model, error)
          }
        }
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
            const recoveryStatus = job.status === 'submitting' ? 'submission_unknown' : 'reconciling'
            current = executeInternal(safeProjectId, current.runId, current, 'job.status', {
              jobId: job.jobId,
              status: recoveryStatus,
              patch: {
                errorCode: job.status === 'submitting' ? 'restart_recovery_required' : 'restart_reconciling',
                errorMessage: job.status === 'submitting'
                  ? 'Nomi 重启时提交尚未落回执，请先对账'
                  : 'Nomi 正在从已有供应商任务恢复进度，不会重新提交',
              },
            }, `recovery-${current.runId}-${job.jobId}-${current.revision}`).run
            changedUnknown = true
            if (recoveryStatus === 'reconciling') void driveReconciliation(safeProjectId, current.runId, job.jobId)
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
    return createProductionRunProjection(requireRun(projectId, runId), projectRootResolver, previewSecret)
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
    return { events: durableEvents.filter(isMeaningfulProductionEvent).map(createProductionEventProjection), nextCursor }
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
    return createProductionArtifactMetadataProjection(run, artifact)
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
    return repository.list(identifier(projectId, 'project')).map((summary) => createProductionRunProjection(requireRun(projectId, summary.runId), projectRootResolver, previewSecret))
  }

  function listFull(projectId: string): ProductionRun[] {
    void resumeUnfinishedRuns(projectId)
    return repository.list(identifier(projectId, 'project')).map((summary) => requireRun(projectId, summary.runId))
  }

  return { createDraft, readProjection, readFull, readEvents, readArtifactProjection, resolveArtifactPreview, command, proposeStoryboard, resumeUnfinishedRuns, listProjections, listFull }
}

export type ProductionRunService = ReturnType<typeof createProductionRunService>
