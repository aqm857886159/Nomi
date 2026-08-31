import crypto from 'node:crypto'

import type { ProductionRunRepository } from './productionRunRepository'
import type { ProductionRun, RunCommand, RunCommandResult } from './productionRunTypes'

export type ProductionProviderPreflight = (
  job: Pick<ProductionRun['jobs'][number], 'provider' | 'model' | 'taskKind'>,
) => void | Promise<void>

type RendererRequest = (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>

export class ProductionProviderUnavailableError extends Error {
  readonly provider: string
  readonly model: string

  constructor(provider: string, model: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`供应商「${provider}」当前不能执行模型「${model}」：${detail}`)
    this.name = 'ProductionProviderUnavailableError'
    this.provider = provider
    this.model = model
  }
}

export async function rebindProductionProvider(input: {
  projectId: string
  runId: string
  current: ProductionRun
  command: RunCommand
  repository: ProductionRunRepository
  requestRenderer: RendererRequest
  preflightProviderModel: ProductionProviderPreflight
}): Promise<RunCommandResult> {
  const { projectId, runId, current, command, repository, requestRenderer, preflightProviderModel } = input
  const rawReplacements = Array.isArray(command.payload.replacements) ? command.payload.replacements : []
  if (rawReplacements.length === 0) throw new Error('Production provider replacements are required')
  const replacements = rawReplacements.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid production replacement ${index}`)
    const replacement = value as Record<string, unknown>
    const jobId = typeof replacement.jobId === 'string' ? replacement.jobId.trim() : ''
    const provider = typeof replacement.provider === 'string' ? replacement.provider.trim() : ''
    const model = typeof replacement.model === 'string' ? replacement.model.trim() : ''
    const previous = current.jobs.find((job) => job.jobId === jobId)
    if (!previous || !previous.nodeId || !provider || !model) throw new Error(`Invalid production replacement ${index}`)
    if (previous.providerTaskId) throw new Error(`供应商任务已经存在，不能直接换供应商：${jobId}`)
    if (!['authorization_required', 'authorized', 'not_dispatched', 'needs_attention'].includes(previous.status)) {
      throw new Error(`当前任务状态不能安全换供应商：${jobId}`)
    }
    if (previous.provider === provider && previous.model === model) throw new Error('Replacement provider and model must change')
    return { previous, provider, model }
  })
  if (new Set(replacements.map((item) => item.previous.jobId)).size !== replacements.length) throw new Error('Duplicate production replacement job')
  const sourceGate = [...current.gates].reverse().find((gate) =>
    gate.scope === 'budget_envelope'
    && gate.status !== 'revoked'
    && gate.jobIds.some((jobId) => replacements.some((item) => item.previous.jobId === jobId)))
  if (!sourceGate) throw new Error('Production replacement contract scope is unavailable')
  const sourceJobs = sourceGate.jobIds.map((jobId) => {
    const job = current.jobs.find((candidate) => candidate.jobId === jobId)
    if (!job || job.providerTaskId || !['authorization_required', 'authorized', 'not_dispatched', 'needs_attention'].includes(job.status)) {
      throw new Error(`Production job cannot be safely carried into a replacement plan: ${jobId}`)
    }
    return job
  })
  const replacementByJobId = new Map(replacements.map((item) => [item.previous.jobId, item]))
  if (replacements.some((item) => !sourceJobs.some((job) => job.jobId === item.previous.jobId))) {
    throw new Error('Production replacement contains a job outside the active contract')
  }
  const projected = sourceJobs.map((previous) => {
    const replacement = replacementByJobId.get(previous.jobId)
    return {
      previous,
      provider: replacement?.provider ?? previous.provider,
      model: replacement?.model ?? previous.model,
    }
  })
  for (const replacement of projected) {
    try {
      await preflightProviderModel({ provider: replacement.provider, model: replacement.model, taskKind: replacement.previous.taskKind })
    } catch (error) {
      throw new ProductionProviderUnavailableError(replacement.provider, replacement.model, error)
    }
  }
  const reboundNodes = await requestRenderer('production.rebind-nodes', {
    projectId,
    runId,
    bindings: replacements.map((item) => ({
      nodeId: item.previous.nodeId,
      previousProvider: item.previous.provider,
      previousModel: item.previous.model,
      provider: item.provider,
      model: item.model,
    })),
  }, 60_000) as { previousBindings?: unknown[] }
  const planVersion = current.planVersion + 1
  const timestamp = new Date().toISOString()
  const jobs = projected.map((item) => ({
    jobId: `job:${runId}:v${planVersion}:${item.previous.nodeId}`,
    stageId: item.previous.stageId,
    status: 'authorization_required' as const,
    attempt: 0,
    provider: item.provider,
    model: item.model,
    idempotencyKey: `production:${runId}:v${planVersion}:${item.previous.nodeId}`,
    ...(item.previous.taskKind ? { taskKind: item.previous.taskKind } : {}),
    nodeId: item.previous.nodeId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
  const revokedGateIds = current.gates
    .filter((gate) => gate.scope === 'budget_envelope' && gate.jobIds.some((jobId) => sourceJobs.some((item) => item.jobId === jobId)))
    .map((gate) => gate.gateId)
  const planHash = crypto.createHash('sha256').update(JSON.stringify(jobs.map(({ jobId, provider, model, nodeId }) => ({ jobId, provider, model, nodeId })))).digest('hex')
  const gate = {
    gateId: `gate-contract-v${planVersion}`,
    scope: 'budget_envelope' as const,
    status: 'waiting' as const,
    planHash,
    jobIds: jobs.map((job) => job.jobId),
    title: 'Approve replacement production contract and budget',
    summary: 'The old provider binding is revoked. Review the replacement provider and production authorization limit before generation resumes.',
    contract: {
      specs: { durationSeconds: current.brief?.durationSeconds, shotCount: jobs.length },
      claims: (current.brief?.sellingPoints || []).map((text) => ({ text, evidenceIds: [] })),
      evidence: [],
      skills: [{ name: 'brand.promo', version: current.playbook.version }],
    },
    createdAt: timestamp,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }
  try {
    return repository.execute(projectId, runId, {
      ...command,
      type: 'plan.rebind',
      payload: {
        oldJobIds: sourceJobs.map((item) => item.jobId),
        jobs,
        revokedGateIds,
        gate,
        planVersion,
      },
    })
  } catch (error) {
    await requestRenderer('production.restore-node-bindings', {
      projectId,
      runId,
      bindings: reboundNodes.previousBindings || [],
    }, 60_000).catch(() => undefined)
    throw error
  }
}
