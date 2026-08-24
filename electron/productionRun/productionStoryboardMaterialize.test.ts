import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { PRODUCTION_DRIVER_TEST_TIMEOUT_MS, waitForProduction } from './productionRunTestHelpers'

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-storyboard-materialize-'))
}

const WAIT_MS = 2000

async function approvedStoryboard(options: { stale?: boolean } = {}) {
  const root = makeRoot()
  const materializePayloads: unknown[] = []
  const repository = createProductionRunRepository({ projectDirResolver: () => root })
  const service = createProductionRunService({
    repository,
    projectRootResolver: () => root,
    requestRenderer: async (op, payload) => {
      if (op === 'production.plan-directions') return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
      if (op === 'production.plan-script') return { text: 'approved script text' }
      if (op === 'production.plan-storyboard') {
        return {
          plan: {
            title: '雨夜找猫', anchors: [],
            shots: [{ index: 1, shotId: 'shot-1', shotKind: 'video', durationSec: 5, anchorIds: [], prompt: 'rain', subtitle: '别怕，我来找你。' }],
          },
        }
      }
      if (op === 'production.materialize-storyboard') {
        // Keep the renderer receipt visible to the test: retries must carry the
        // same operation id even when the main process did not attach the first
        // response yet.
        materializePayloads.push(payload)
        return {
          createdNodeIds: ['node-shot-1'], connectedCount: 0,
          bindings: [{ nodeId: 'node-shot-1', provider: 'local', model: 'demo-video', stageId: 'generate', metadata: { shotId: 'shot-1' } }],
        }
      }
      throw new Error(`unexpected renderer operation: ${op}`)
    },
  })
  const runId = 'run-materialize-1'
  service.createDraft({
    runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex' }, brief: { goal: 'materialize storyboard' },
  })
  await service.command('project-1', runId, {
    commandId: 'direction', expectedRevision: 0, type: 'gate.decide',
    payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
  })
  let run = service.readFull('project-1', runId)
  const script = run.artifacts.find((artifact) => artifact.kind === 'script')!
  await service.command('project-1', runId, {
    commandId: 'script-review', expectedRevision: run.revision, type: 'script.review',
    payload: { artifactId: script.artifactId, decision: 'approved' }, issuedAt: new Date().toISOString(),
  })
  await waitForProduction(() => Boolean(service.readFull('project-1', runId)?.artifacts.some((artifact) => artifact.kind === 'storyboard')), WAIT_MS)
  run = service.readFull('project-1', runId)
  const storyboard = run.artifacts.find((artifact) => artifact.kind === 'storyboard')!
  if (options.stale) {
    // Simulate an out-of-band source edit: the storyboard still points to the
    // reviewed script artifact id/version, but its persisted source hash no
    // longer matches the adopted script.
    const file = path.join(root, storyboard.projectRelativePath!)
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    raw.sourceContentHash = 'stale-hash'
    raw.sourceScriptHash = 'stale-hash'
    fs.writeFileSync(file, `${JSON.stringify(raw)}\n`, 'utf8')
  }
  await service.reviewArtifact({
    projectId: 'project-1', runId, artifactId: storyboard.artifactId,
    expectedVersion: storyboard.version || 1, decision: 'approved',
  })
  return { root, service, runId, storyboard, materializePayloads }
}

describe('external storyboard materialization', { timeout: PRODUCTION_DRIVER_TEST_TIMEOUT_MS }, () => {
  it('materializes only an approved storyboard and attaches one durable contract', async () => {
    const { service, runId, storyboard, materializePayloads } = await approvedStoryboard()
    const result = await service.materializeStoryboard({
      projectId: 'project-1', runId, artifactId: storyboard.artifactId, expectedVersion: storyboard.version || 1,
    })

    expect(result.materialized).toBe(true)
    expect(result.createdNodeIds).toEqual(['node-shot-1'])
    expect(result.bindings[0]).toMatchObject({ nodeId: 'node-shot-1', provider: 'local', model: 'demo-video' })
    expect(result.gates.filter((gate) => gate.scope === 'budget_envelope')).toHaveLength(1)
    expect(result.jobs).toHaveLength(1)

    const replay = await service.materializeStoryboard({
      projectId: 'project-1', runId, artifactId: storyboard.artifactId, expectedVersion: storyboard.version || 1,
    })
    expect(replay.revision).toBe(result.revision)
    expect(replay.gates.filter((gate) => gate.scope === 'budget_envelope')).toHaveLength(1)
    expect(materializePayloads).toHaveLength(1)
    expect((materializePayloads[0] as Record<string, unknown>).materializationOperationId)
      .toBe('materialize:project-1:run-materialize-1:artifact-storyboard-v1:v1')
  })

  it('rejects a stale storyboard before asking the renderer to mutate the canvas', async () => {
    const { service, runId, storyboard } = await approvedStoryboard({ stale: true })
    await expect(service.materializeStoryboard({
      projectId: 'project-1', runId, artifactId: storyboard.artifactId, expectedVersion: storyboard.version || 1,
    })).rejects.toThrow(/stale|approved script/i)
  })

  it('rejects a version mismatch before reading or materializing the artifact', async () => {
    const { service, runId, storyboard } = await approvedStoryboard()
    await expect(service.materializeStoryboard({
      projectId: 'project-1', runId, artifactId: storyboard.artifactId, expectedVersion: (storyboard.version || 1) + 1,
    })).rejects.toThrow(/version conflict/i)
  })
})
