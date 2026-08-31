import { describe, expect, test } from 'vitest'

import {
  evaluateResidentProductionEvidence,
  providerRequestFingerprint,
} from './resident-production-evidence.mjs'

const hash = (value) => providerRequestFingerprint(value)

function validEvidence(overrides = {}) {
  const contract = {
    contractHash: 'contract-1', providerId: 'apimart', modelId: 'seedance',
    mode: 'text_to_video', prompt: 'shot', parameters: { duration: 15 }, references: [],
  }
  const request = { model: 'seedance', prompt: 'shot', duration: 15 }
  const job = {
    jobId: 'job-1', shotId: 'shot-1', attempt: 1, providerId: 'apimart',
    modelId: 'seedance', contractHash: 'contract-1', providerWirePayloadHash: hash(request),
    providerIdempotencyKey: 'idem-1', requestFingerprint: hash(contract),
  }
  return {
    synthetic: { mode: 'loopback', provider: 'apimart', paidCalls: 0 },
    finalText: '已提交，正在等待审阅。',
    run: {
      status: 'completed',
      generationPlan: { shots: [{ shotId: 'shot-1', contract }] },
      jobs: [{ ...job, providerTaskId: 'task-1', status: 'adopted' }],
      artifacts: [
        { artifactId: 'script-1', kind: 'script', status: 'adopted', reviewStatus: 'approved', version: 1, contentHash: 'a'.repeat(64), projectRelativePath: '.nomi/runs/run/script-v1.json' },
        { artifactId: 'storyboard-1', kind: 'storyboard', status: 'adopted', reviewStatus: 'approved', version: 1, contentHash: 'b'.repeat(64), projectRelativePath: '.nomi/runs/run/storyboard-v1.json' },
        { artifactId: 'video-1', kind: 'video', status: 'adopted', jobId: 'job-1', projectRelativePath: '.nomi/runs/run/shot-1.mp4' },
        { artifactId: 'timeline-1', kind: 'timeline', status: 'adopted', projectRelativePath: '.nomi/runs/run/timeline-v1.json' },
        { artifactId: 'export-1', kind: 'export', status: 'adopted', projectRelativePath: 'exports/run.mp4' },
      ],
    },
    requests: [{ method: 'POST', path: '/v1/videos/generations', sequence: 1, body: request, responseBody: { code: 200, data: [{ task_id: 'task-1' }] } }],
    taskQueries: [{ method: 'GET', path: '/v1/tasks/task-1', sequence: 2, responseBody: { code: 200, data: { id: 'task-1', status: 'completed' } } }],
    events: [
      { type: 'generation.plan.sealed', emittedAt: '2026-08-31T00:00:00.000Z', payload: { run: { generationPlan: { authorizationEnvelope: { jobs: [job] } } } } },
      { type: 'gate.decided', emittedAt: '2026-08-31T00:00:01.000Z', payload: { run: { gates: [{ scope: 'budget_envelope', status: 'approved', decidedAt: '2026-08-31T00:00:01.000Z' }] } } },
      { type: 'artifact.adopted', emittedAt: '2026-08-31T00:00:02.000Z' },
    ],
    media: [{ path: '.nomi/runs/run/shot-1.mp4', durationSeconds: 15, visualVariance: 12, exists: true }],
    timeline: { exists: true, durationSeconds: 15, clipCount: 1, latestVersion: 1, reassembledAfterRetry: true },
    export: { exists: true, durationSeconds: 15, sidecar: { schemaVersion: 1, owner: 'production-run', runId: 'run', output: { relativePath: 'exports/run.mp4', bytes: 123 } } },
    ...overrides,
  }
}

describe('resident production evidence contract', () => {
  test('accepts a complete, causally mapped synthetic run', () => {
    expect(evaluateResidentProductionEvidence(validEvidence())).toEqual([])
  })

  test('rejects missing script/storyboard and literal completion text', () => {
    const evidence = validEvidence({
      finalText: '已生成并完成五分钟粗剪。',
      run: { ...validEvidence().run, artifacts: validEvidence().run.artifacts.filter((item) => !['script', 'storyboard'].includes(item.kind)) },
    })
    const issues = evaluateResidentProductionEvidence(evidence)
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('script artifact'),
      expect.stringContaining('storyboard artifact'),
      expect.stringContaining('literal completion'),
    ]))
  })

  test('rejects an observed provider body whose wire hash is not authorized', () => {
    const evidence = validEvidence({
      requests: [{ ...validEvidence().requests[0], body: { model: 'seedance', prompt: 'tampered', duration: 15 } }],
    })
    expect(evaluateResidentProductionEvidence(evidence)).toEqual(expect.arrayContaining([
      expect.stringContaining('wire hash'),
    ]))
  })

  test('rejects short or visually uniform media and stale timeline evidence', () => {
    const evidence = validEvidence({
      media: [{ path: '.nomi/runs/run/shot-1.mp4', durationSeconds: 0.2, visualVariance: 0, exists: true }],
      timeline: { exists: true, durationSeconds: 15, clipCount: 1, latestVersion: 1, reassembledAfterRetry: false },
    })
    const issues = evaluateResidentProductionEvidence(evidence)
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('media duration'),
      expect.stringContaining('uniform'),
      expect.stringContaining('re-assembled'),
    ]))
  })
})
