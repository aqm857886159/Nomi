import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { PRODUCTION_DRIVER_TEST_TIMEOUT_MS, waitForProduction } from './productionRunTestHelpers'

const WAIT_MS = 1000

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-script-review-'))
  const repository = createProductionRunRepository({ projectDirResolver: () => root })
  const calls: string[] = []
  const requestRenderer = async (operation: string) => {
    calls.push(operation)
    if (operation === 'production.plan-directions') {
      return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
    }
    if (operation === 'production.plan-script') return { text: '完整剧本文稿：雨夜里，主角推开门。' }
    if (operation === 'production.plan-storyboard') return { plan: { title: '分镜', shots: [] } }
    throw new Error(`unexpected paid/render operation: ${operation}`)
  }
  const service = createProductionRunService({ repository, projectRootResolver: () => root, requestRenderer })
  service.createDraft({
    runId: 'run-script-review', projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex' }, brief: { goal: 'script review fixture' },
  })
  return { root, service, calls }
}

describe('ProductionRun script review', { timeout: PRODUCTION_DRIVER_TEST_TIMEOUT_MS }, () => {
  it('creates only a script candidate after direction approval and plans storyboard after adoption', async () => {
    const { root, service, calls } = createFixture()
    await service.command('project-1', 'run-script-review', {
      commandId: 'direction-approved', expectedRevision: 0, type: 'gate.decide',
      payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitForProduction(() => service.readFull('project-1', 'run-script-review').artifacts.some((artifact) => artifact.kind === 'script'), WAIT_MS)

    const candidate = service.readFull('project-1', 'run-script-review')
    expect(candidate.status).toBe('awaiting_script_review')
    expect(candidate.artifacts.find((artifact) => artifact.kind === 'script')).toMatchObject({
      status: 'candidate', reviewStatus: 'waiting',
      skillEvidence: expect.arrayContaining([
        expect.objectContaining({ name: 'writer-screenwriter', stageId: 'script' }),
        expect.objectContaining({ name: 'writer-review', stageId: 'script' }),
      ]),
    })
    expect(calls).toContain('production.plan-script')
    expect(calls).not.toContain('production.plan-storyboard')

    const script = candidate.artifacts.find((artifact) => artifact.kind === 'script')!
    const approved = await service.command('project-1', 'run-script-review', {
      commandId: 'script-approved', expectedRevision: candidate.revision, type: 'script.review',
      payload: { artifactId: script.artifactId, decision: 'approved' }, issuedAt: new Date().toISOString(),
    })
    expect(approved.run.artifacts.find((artifact) => artifact.kind === 'script')).toMatchObject({ status: 'adopted', reviewStatus: 'approved' })
    await waitForProduction(() => calls.includes('production.plan-storyboard'), WAIT_MS)
    expect(service.readFull('project-1', 'run-script-review').artifacts.some((artifact) => artifact.kind === 'storyboard')).toBe(true)
    expect(fs.existsSync(path.join(root, '.nomi/runs/run-script-review/script-v1.json'))).toBe(true)
  })

  it('does not make a paid request when the user requests script changes', async () => {
    const { service, calls } = createFixture()
    await service.command('project-1', 'run-script-review', {
      commandId: 'direction-changes', expectedRevision: 0, type: 'gate.decide',
      payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitForProduction(() => service.readFull('project-1', 'run-script-review').artifacts.some((artifact) => artifact.kind === 'script'), WAIT_MS)
    const candidate = service.readFull('project-1', 'run-script-review')
    const script = candidate.artifacts.find((artifact) => artifact.kind === 'script')!
    await service.command('project-1', 'run-script-review', {
      commandId: 'script-changes', expectedRevision: candidate.revision, type: 'script.review',
      payload: { artifactId: script.artifactId, decision: 'changes_requested' }, issuedAt: new Date().toISOString(),
    })
    expect(service.readFull('project-1', 'run-script-review').jobs).toHaveLength(0)
    expect(calls.filter((operation) => operation === 'production.plan-storyboard')).toHaveLength(0)
  })

  it('re-reads a complete script snapshot by project, run, and artifact id', async () => {
    const { service } = createFixture()
    await service.command('project-1', 'run-script-review', {
      commandId: 'direction-read', expectedRevision: 0, type: 'gate.decide',
      payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitForProduction(() => service.readFull('project-1', 'run-script-review').artifacts.some((artifact) => artifact.kind === 'script'), WAIT_MS)
    const run = service.readFull('project-1', 'run-script-review')
    const script = run.artifacts.find((artifact) => artifact.kind === 'script')!
    expect(service.readScriptDraft('project-1', 'run-script-review', script.artifactId)).toMatchObject({
      kind: 'script', content: '完整剧本文稿：雨夜里，主角推开门。', contentHash: script.contentHash,
    })
  })
})
