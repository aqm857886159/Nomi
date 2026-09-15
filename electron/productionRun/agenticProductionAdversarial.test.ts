import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { buildQaRetryPlans } from './productionQaVerdict'
import { assertStoryboardSourceFresh } from './productionRunArtifactOperations'
import type { ProductionArtifact, ProductionRun } from './productionRunTypes'

function qaRun(overrides: Partial<ProductionRun> = {}): ProductionRun {
  return {
    budget: { currency: 'CNY', authorized: 1, reserved: 0, actual: 0, unsettled: 0 },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: 100, maxAttemptsPerJob: 1, minimizeUploads: true },
    jobs: [{
      jobId: 'job-shot-1', stageId: 'generate', status: 'adopted', attempt: 0,
      provider: 'local', model: 'demo-video', idempotencyKey: 'job-shot-1', nodeId: 'node-shot-1',
      createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
    }],
    ...overrides,
  } as ProductionRun
}

function artifact(kind: ProductionArtifact['kind'], pathName: string, extra: Partial<ProductionArtifact> = {}): ProductionArtifact {
  return {
    artifactId: `artifact-${kind}-v1`, stageId: kind, kind, status: kind === 'script' ? 'adopted' : 'adopted',
    version: 1, contentHash: 'script-hash-v1', projectRelativePath: pathName,
    createdAt: '2026-08-21T00:00:00.000Z', adoptedAt: '2026-08-21T00:00:00.000Z',
    ...extra,
  }
}

describe('agentic production adversarial contracts', () => {
  it('does not retry an unassessable score, duplicate verdict, or exhausted attempt', () => {
    const duplicate = buildQaRetryPlans(qaRun(), [
      { shotNodeId: 'node-shot-1', passed: false, flagged: [{ dimension: 'identity', score: 2, reason: '重复行不能追加第二次预算' }] },
      { shotNodeId: 'node-shot-1', passed: false, flagged: [{ dimension: 'identity', score: 2, reason: '重复行不能追加第二次预算' }] },
    ])
    expect(duplicate).toHaveLength(1)
    expect(duplicate[0].eligible).toBe(true)

    expect(buildQaRetryPlans(qaRun(), [
      { shotNodeId: 'node-shot-1', passed: false, flagged: [{ dimension: 'identity', score: 0, reason: '无法判断' }] },
    ])).toEqual([])

    const exhausted = buildQaRetryPlans(qaRun({ jobs: [{
      ...qaRun().jobs[0], attempt: 1, retryCount: 1,
    }] }), [{ shotNodeId: 'node-shot-1', passed: false, flagged: [{ dimension: 'identity', score: 2 }] }])
    expect(exhausted[0]).toMatchObject({ eligible: false, blockedReason: 'attempt_limit' })
  })

  it('fails closed when a storyboard file disappears or is corrupted', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-adversarial-'))
    const storyboardPath = '.nomi/runs/run-1/storyboard-v1.json'
    const scriptPath = '.nomi/runs/run-1/script-v1.json'
    fs.mkdirSync(path.join(root, '.nomi/runs/run-1'), { recursive: true })
    const scriptContent = 'approved'
    const scriptHash = crypto.createHash('sha256').update(scriptContent).digest('hex')
    fs.writeFileSync(path.join(root, scriptPath), JSON.stringify({ kind: 'script', artifactId: 'artifact-script-v1', version: 1, content: scriptContent }))
    fs.writeFileSync(path.join(root, storyboardPath), JSON.stringify({ kind: 'storyboard', sourceScriptArtifactId: 'artifact-script-v1', sourceScriptVersion: 1, sourceScriptHash: scriptHash }))
    const run = {
      projectId: 'project-1', runId: 'run-1', artifacts: [
        artifact('script', scriptPath, { contentHash: scriptHash }),
        artifact('storyboard', storyboardPath, { sourceScriptArtifactId: 'artifact-script-v1', sourceScriptVersion: 1, sourceScriptHash: scriptHash }),
      ],
    } as ProductionRun
    expect(assertStoryboardSourceFresh(() => root, run, run.artifacts[1], {})).toMatchObject({ hash: scriptHash })
    fs.rmSync(path.join(root, storyboardPath))
    expect(() => assertStoryboardSourceFresh(() => root, run, run.artifacts[1], {})).toThrow(/unavailable|invalid/i)
    fs.writeFileSync(path.join(root, storyboardPath), '{not-json')
    expect(() => assertStoryboardSourceFresh(() => root, run, run.artifacts[1], {})).toThrow(/unavailable|invalid/i)
  })
})
