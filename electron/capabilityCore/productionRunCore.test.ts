import { describe, expect, it, vi } from 'vitest'

import { dispatch } from './dispatcher'

function context() {
  const productionRuns = {
    createDraft: vi.fn(async (input: unknown) => ({ runId: 'run-1', status: 'draft', input })),
    readProjection: vi.fn(async () => ({ runId: 'run-1', status: 'draft' })),
    readEvents: vi.fn(async () => ({ events: [], nextCursor: 4 })),
    readArtifactProjection: vi.fn(async () => ({ artifactId: 'artifact-1', kind: 'storyboard' })),
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

  it('surfaces an actionable unknown-run error', async () => {
    const { ctx, productionRuns } = context()
    productionRuns.readProjection.mockRejectedValueOnce(new Error('Production run not found: run-missing'))
    await expect(dispatch('production.get', {
      projectId: 'project-1', runId: 'run-missing',
    }, ctx as never)).rejects.toThrow(/run-missing/)
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
