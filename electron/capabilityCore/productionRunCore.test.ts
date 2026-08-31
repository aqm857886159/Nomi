import { describe, expect, it, vi } from 'vitest'

import { dispatch } from './dispatcher'

function context() {
  const productionRuns = {
    createDraft: vi.fn(async (input: unknown) => ({ runId: 'run-1', status: 'draft', input })),
    readProjection: vi.fn(async () => ({ runId: 'run-1', status: 'draft' })),
    readEvents: vi.fn(async () => ({ events: [], nextCursor: 4 })),
    readArtifactProjection: vi.fn(async () => ({ artifactId: 'artifact-1', kind: 'storyboard' })),
    materializeStoryboard: vi.fn(async (input: unknown) => ({ materialized: true, input })),
    readFull: vi.fn(() => null),
    command: vi.fn(async () => ({ run: {}, events: [] })),
  }
  return {
    productionRuns,
    ctx: {
      runTask: vi.fn(async () => ({ status: 'succeeded' })),
      makeGateway: vi.fn(() => { throw new Error('production methods must not resolve a canvas gateway') }),
      productionRuns,
      origin: { host: 'external' as const },
    },
  }
}

describe('production run capability methods', () => {
  it('starts a draft from a bounded brief and never dispatches paid work', async () => {
    const { ctx, productionRuns } = context()
    const result = await dispatch('production.start', {
      projectId: 'project-1',
      playbook: 'brand.promo',
      playbookVersion: '1.0.0',
      host: 'codex',
      brief: {
        goal: '介绍 Nomi',
        audience: 'AI 视频创作者',
        durationSeconds: 60,
        sellingPoints: ['本地保存', '可接任意 API'],
      },
    }, ctx as never)

    expect(result).toMatchObject({ runId: 'run-1', status: 'draft' })
    expect(productionRuns.createDraft).toHaveBeenCalledWith({
      projectId: 'project-1',
      playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'external' },
      brief: {
        goal: '介绍 Nomi',
        audience: 'AI 视频创作者',
        durationSeconds: 60,
        sellingPoints: ['本地保存', '可接任意 API'],
      },
    })
    expect(ctx.runTask).not.toHaveBeenCalled()
    expect(ctx.makeGateway).not.toHaveBeenCalled()
  })

  it.each(['nomi', 'codex', 'claude'])('does not trust a caller-supplied host %s', async (forgedHost) => {
    const { ctx, productionRuns } = context()
    await dispatch('production.start', {
      projectId: 'project-1',
      playbook: 'brand.promo',
      host: forgedHost,
      actorId: 'self-declared-client',
      brief: { goal: 'safe draft' },
    }, ctx as never)
    expect(productionRuns.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      origin: { host: 'external', actorId: 'self-declared-client' },
    }))
  })

  it.each([
    ['approval', { decision: 'approved' }],
    ['spendConfirmed', true],
    ['maxSpend', 100],
    ['vendor', 'paid-provider'],
    ['modelKey', 'paid-model'],
    ['autoApprove', true],
  ])('rejects forbidden production.start field %s', async (field, value) => {
    const { ctx, productionRuns } = context()
    await expect(dispatch('production.start', {
      projectId: 'project-1',
      playbook: 'brand.promo',
      host: 'codex',
      brief: { goal: 'safe draft' },
      [field]: value,
    }, ctx as never)).rejects.toThrow(/not allowed|不允许/i)
    expect(productionRuns.createDraft).not.toHaveBeenCalled()
  })

  it('reads projection, resumable events, and one artifact without resolving canvas state', async () => {
    const { ctx, productionRuns } = context()
    await expect(dispatch('production.get', { projectId: 'project-1', runId: 'run-1' }, ctx as never))
      .resolves.toMatchObject({ runId: 'run-1' })
    await expect(dispatch('production.events', {
      projectId: 'project-1', runId: 'run-1', afterCursor: 3, waitMs: 25_000,
    }, ctx as never)).resolves.toEqual({ events: [], nextCursor: 4 })
    await expect(dispatch('production.artifact', {
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-1',
    }, ctx as never)).resolves.toMatchObject({ artifactId: 'artifact-1' })

    expect(productionRuns.readProjection).toHaveBeenCalledWith('project-1', 'run-1')
    expect(productionRuns.readEvents).toHaveBeenCalledWith('project-1', 'run-1', 3, 25_000)
    expect(productionRuns.readArtifactProjection).toHaveBeenCalledWith('project-1', 'run-1', 'artifact-1')
    expect(ctx.makeGateway).not.toHaveBeenCalled()
  })

  it('materializes only through the versioned storyboard business seam', async () => {
    const { ctx, productionRuns } = context()
    await expect(dispatch('production.storyboard.materialize', {
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-storyboard-v2', expectedVersion: 2,
    }, ctx as never)).resolves.toMatchObject({ materialized: true })
    expect(productionRuns.materializeStoryboard).toHaveBeenCalledWith({
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-storyboard-v2', expectedVersion: 2,
    })
    await expect(dispatch('production.storyboard.materialize', {
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-storyboard-v2', expectedVersion: 0,
    }, ctx as never)).rejects.toThrow(/version/i)
  })

  it('surfaces an actionable unknown-run error', async () => {
    const { ctx, productionRuns } = context()
    productionRuns.readProjection.mockRejectedValueOnce(new Error('Production run not found: run-missing'))
    await expect(dispatch('production.get', {
      projectId: 'project-1', runId: 'run-missing',
    }, ctx as never)).rejects.toThrow(/run-missing/)
  })

  it.each([
    ['gate-contract-v1', 'budget_envelope'],
    ['gate-shot-v1-job', 'job_set'],
    ['gate-export-v1', 'export'],
  ] as const)('allows external Agent decisions for %s after dispatcher validation', async (gateId, scope) => {
    const { ctx, productionRuns } = context()
    productionRuns.readFull.mockReturnValueOnce({
      revision: 3,
      policy: { maxSpend: 0, allowedProviders: ['provider'], allowedModels: ['model'] },
      gates: [{ gateId, scope, status: 'waiting', jobIds: [] }],
    })
    const params = gateId === 'gate-contract-v1'
      ? {
          projectId: 'project-1', runId: 'run-1', gateId, decision: 'approved',
          policy: { maxSpend: 100, allowedProviders: ['provider'], allowedModels: ['model'] },
        }
      : { projectId: 'project-1', runId: 'run-1', gateId, decision: 'approved' }
    await expect(dispatch('production.decide-gate', params, ctx as never)).resolves.toMatchObject({ runId: 'run-1' })
    expect(productionRuns.command).toHaveBeenCalledWith('project-1', 'run-1', expect.objectContaining({ type: 'gate.decide' }))
  })

  it('keeps publish outside the reversible external approval surface', async () => {
    const { ctx, productionRuns } = context()
    productionRuns.readFull.mockReturnValueOnce({ revision: 3, gates: [{ gateId: 'gate-publish-v1', scope: 'publish', status: 'waiting' }] })
    await expect(dispatch('production.decide-gate', {
      projectId: 'project-1', runId: 'run-1', gateId: 'gate-publish-v1', decision: 'approved',
    }, ctx as never)).rejects.toMatchObject({ httpStatus: 403 })
    expect(productionRuns.command).not.toHaveBeenCalled()
  })

  it('moves an external Run from rough-cut review through the export gate in one approval', async () => {
    const { ctx, productionRuns } = context()
    productionRuns.readFull.mockReturnValueOnce({ revision: 8, status: 'awaiting_rough_cut_review' })
    productionRuns.readFull.mockReturnValueOnce({
      revision: 9,
      status: 'awaiting_export',
      gates: [{ gateId: 'gate-export-v1', scope: 'export', status: 'waiting' }],
    })
    await expect(dispatch('production.approve-rough-cut', {
      projectId: 'project-1', runId: 'run-1',
    }, ctx as never)).resolves.toMatchObject({ runId: 'run-1' })
    expect(productionRuns.command).toHaveBeenNthCalledWith(1, 'project-1', 'run-1', expect.objectContaining({
      type: 'run.status', expectedRevision: 8, payload: { status: 'awaiting_export' },
    }))
    expect(productionRuns.command).toHaveBeenNthCalledWith(2, 'project-1', 'run-1', expect.objectContaining({
      type: 'gate.decide', payload: { gateId: 'gate-export-v1', status: 'approved' },
    }))
  })

  it('allows a reversible sample decision through the guarded dispatcher path', async () => {
    const { ctx, productionRuns } = context()
    productionRuns.readFull.mockReturnValueOnce({
      revision: 3,
      gates: [{ gateId: 'gate-sample-v1', scope: 'stage', status: 'waiting' }],
    })
    await dispatch('production.decide-gate', {
      projectId: 'project-1', runId: 'run-1', gateId: 'gate-sample-v1', decision: 'approved',
    }, ctx as never)
    expect(productionRuns.command).toHaveBeenCalledWith('project-1', 'run-1', expect.objectContaining({
      type: 'gate.decide', payload: { gateId: 'gate-sample-v1', status: 'approved' },
    }))
  })

  it('does not let MCP change trust to bypass a waiting per-shot gate', async () => {
    const { ctx, productionRuns } = context()
    productionRuns.readFull.mockReturnValueOnce({
      revision: 4,
      gates: [{ gateId: 'gate-shot-v1-job', scope: 'job_set', status: 'waiting' }],
    })
    await expect(dispatch('production.control', {
      projectId: 'project-1', runId: 'run-1', action: 'set_trust', trustLevel: 'budget_only',
    }, ctx as never)).rejects.toMatchObject({ httpStatus: 403 })
    expect(productionRuns.command).not.toHaveBeenCalled()
  })

  it('lets MCP tune only the next independent generation wave', async () => {
    const { ctx, productionRuns } = context()
    productionRuns.readFull.mockReturnValueOnce({ revision: 4, gates: [] })
    productionRuns.readProjection.mockReturnValue({ runId: 'run-1', policy: { maxConcurrentJobs: 3 } })
    await dispatch('production.control', {
      projectId: 'project-1', runId: 'run-1', action: 'set_concurrency', maxConcurrentJobs: 3,
    }, ctx as never)
    expect(productionRuns.command).toHaveBeenCalledWith('project-1', 'run-1', expect.objectContaining({
      type: 'run.control', payload: { action: 'set_concurrency', maxConcurrentJobs: 3 },
    }))
  })

  it('keeps provider reconciliation on the external MCP surface', async () => {
    const { ctx, productionRuns } = context()
    productionRuns.readFull.mockReturnValueOnce({ revision: 6, gates: [] })
    productionRuns.readProjection.mockReturnValue({ runId: 'run-1', status: 'needs_attention' })
    await dispatch('production.reconcile-job', {
      projectId: 'project-1', runId: 'run-1', jobId: 'job:run-1:shot-1', outcome: 'found',
    }, ctx as never)
    expect(productionRuns.command).toHaveBeenCalledWith('project-1', 'run-1', expect.objectContaining({
      type: 'job.reconcile', payload: { jobId: 'job:run-1:shot-1', outcome: 'found' },
    }))
  })

  it.each([
    ['production.get', { projectId: 'project-1', runId: 'run-1', path: '/tmp/private' }],
    ['production.events', { projectId: 'project-1', runId: 'run-1', cursorFile: '/tmp/private' }],
    ['production.artifact', { projectId: 'project-1', runId: 'run-1', path: '../private' }],
  ])('rejects unexpected fields for %s', async (method, params) => {
    const { ctx, productionRuns } = context()
    await expect(dispatch(method, params, ctx as never)).rejects.toThrow(/not allowed/i)
    expect(productionRuns.readProjection).not.toHaveBeenCalled()
    expect(productionRuns.readEvents).not.toHaveBeenCalled()
    expect(productionRuns.readArtifactProjection).not.toHaveBeenCalled()
  })
})
