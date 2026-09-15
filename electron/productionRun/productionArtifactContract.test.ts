import { describe, expect, it } from 'vitest'

import {
  applyProductionCommand,
  assertStoryboardSourceApproved,
  canAdoptArtifact,
  markDerivedArtifactsStale,
} from './productionRunReducer'
import type { ProductionArtifact, ProductionRun } from './productionRunTypes'

const now = '2026-08-21T00:00:00.000Z'

function stage(stageId: string, order: number) {
  return { stageId, title: stageId, status: 'completed' as const, order }
}

function runWithDirectionApproved(): ProductionRun {
  return {
    schemaVersion: 1,
    runId: 'run-contract',
    projectId: 'project-contract',
    revision: 1,
    status: 'running',
    stageId: 'direction',
    playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex' },
    brief: { goal: 'contract fixture' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1,
    snapshotCursor: 1,
    stages: ['brief', 'direction', 'script', 'storyboard', 'build'].map(stage),
    gates: [],
    jobs: [],
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  }
}

function scriptCandidate(id = 'script-v1', hash = 'hash-v1'): ProductionArtifact {
  return {
    artifactId: `artifact-${id}`,
    stageId: 'script',
    kind: 'script',
    status: 'candidate',
    version: Number(id.match(/v(\d+)$/)?.[1] || 1),
    source: 'nomi-agent',
    contentHash: hash,
    reviewStatus: 'waiting',
    projectRelativePath: `.nomi/runs/run-contract/${id}.json`,
    createdAt: now,
  }
}

describe('production artifact provenance contract', () => {
  it('creates script as candidate, never adopted before review', () => {
    const effect = applyProductionCommand(runWithDirectionApproved(), {
      commandId: 'propose-script',
      expectedRevision: 1,
      type: 'plan.proposed',
      payload: { artifacts: [scriptCandidate()] },
      issuedAt: now,
    }, now)

    expect(effect.run.artifacts.find((artifact) => artifact.kind === 'script')).toMatchObject({
      status: 'candidate',
      reviewStatus: 'waiting',
      source: 'nomi-agent',
      version: 1,
    })
    expect(effect.run.status).toBe('awaiting_script_review')
    expect(canAdoptArtifact(effect.run, 'artifact-script-v1')).toBe(false)
  })

  it('rejects storyboard proposal whose source script is not adopted', () => {
    const run = runWithDirectionApproved()
    const script = scriptCandidate()
    const withCandidate = { ...run, artifacts: [script], status: 'awaiting_script_review' as const, stageId: 'script' }

    expect(() => {
      applyProductionCommand(withCandidate, {
        commandId: 'propose-storyboard',
        expectedRevision: 2,
        type: 'plan.proposed',
        payload: {
          artifacts: [{
            artifactId: 'artifact-storyboard-v1',
            stageId: 'storyboard',
            kind: 'storyboard',
            status: 'candidate',
            version: 1,
            source: 'nomi-agent',
            sourceArtifactId: script.artifactId,
            sourceVersion: script.version,
            sourceContentHash: script.contentHash,
            reviewStatus: 'waiting',
            createdAt: now,
          }],
        },
        issuedAt: now,
      }, now)
    }).toThrow('approved script required')
  })

  it('marks storyboard stale when its source script hash changes', () => {
    const scriptV1 = { ...scriptCandidate('script-v1', 'hash-v1'), status: 'adopted' as const, reviewStatus: 'approved' as const, adoptedAt: now }
    const storyboard: ProductionArtifact = {
      artifactId: 'artifact-storyboard-v1',
      stageId: 'storyboard',
      kind: 'storyboard',
      status: 'adopted',
      version: 1,
      source: 'nomi-agent',
      sourceArtifactId: scriptV1.artifactId,
      sourceVersion: scriptV1.version,
      sourceContentHash: scriptV1.contentHash,
      reviewStatus: 'approved',
      createdAt: now,
      adoptedAt: now,
    }
    const run = { ...runWithDirectionApproved(), artifacts: [scriptV1, storyboard] }
    const changed = markDerivedArtifactsStale(run, scriptV1.artifactId)
    expect(changed.artifacts.find((artifact) => artifact.kind === 'storyboard')?.status).toBe('rejected')
  })

  it('asserts that storyboard provenance points to the approved script version', () => {
    const script = { ...scriptCandidate(), status: 'adopted' as const, reviewStatus: 'approved' as const, adoptedAt: now }
    const storyboard: ProductionArtifact = {
      artifactId: 'artifact-storyboard-v1', stageId: 'storyboard', kind: 'storyboard', status: 'candidate',
      version: 1, source: 'nomi-agent', sourceArtifactId: script.artifactId, sourceVersion: script.version,
      sourceContentHash: script.contentHash, reviewStatus: 'waiting', createdAt: now,
    }
    expect(() => assertStoryboardSourceApproved({ ...runWithDirectionApproved(), artifacts: [script, storyboard] }, storyboard.artifactId)).not.toThrow()
  })
})
