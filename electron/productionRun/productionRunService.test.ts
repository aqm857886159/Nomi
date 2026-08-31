import { describe, expect, it, vi } from 'vitest'

import { createProductionRunService } from './productionRunService'
import type { ProductionRun, RunEvent } from './productionRunTypes'

const run: ProductionRun = {
  schemaVersion: 1,
  runId: 'run-1',
  projectId: 'project-1',
  revision: 2,
  status: 'running',
  stageId: 'storyboard',
  playbook: { name: 'brand.promo', version: '1.0.0' },
  origin: { host: 'external', actorId: 'codex' },
  policy: { mode: 'balanced', trustedHosts: ['codex'], allowedProviders: ['secret-provider'], allowedModels: ['secret-model'], maxSpend: 20, maxAttemptsPerJob: 2, minimizeUploads: true },
  budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
  planVersion: 1,
  snapshotCursor: 3,
  stages: [{ stageId: 'storyboard', title: '分镜', status: 'running', order: 1 }],
  gates: [{ gateId: 'gate-1', scope: 'job_set', status: 'waiting', planHash: 'secret-plan', jobIds: ['job-1'], title: '确认', summary: '确认制作', contract: { specs: { shotCount: 1 }, claims: [{ text: 'claim', evidenceIds: ['e1'] }], evidence: [{ evidenceId: 'e1', label: '本地', projectRelativePath: '/Users/private/evidence.txt' }], skills: [{ name: 'director', version: '1' }] }, createdAt: '2026-08-08T10:00:00.000Z', expiresAt: '2026-08-08T11:00:00.000Z' }],
  jobs: [{ jobId: 'job-1', stageId: 'storyboard', status: 'polling', attempt: 1, provider: 'secret-provider', model: 'secret-model', idempotencyKey: 'secret-key', providerTaskId: 'secret-task', nodeId: 'secret-node', errorMessage: 'secret error', progressPercent: 42, createdAt: '2026-08-08T10:00:00.000Z', updatedAt: '2026-08-08T10:00:00.000Z' }],
  artifacts: [{ artifactId: 'artifact-1', stageId: 'storyboard', kind: 'storyboard', status: 'ready', createdAt: '2026-08-08T10:00:00.000Z' }],
  createdAt: '2026-08-08T10:00:00.000Z',
  updatedAt: '2026-08-08T10:00:00.000Z',
}

const event = (cursor: number, type: string): RunEvent => ({ schemaVersion: 1, eventId: `event-${cursor}`, cursor, runId: 'run-1', runRevision: cursor, commandId: `cmd-${cursor}`, type, message: type, emittedAt: '2026-08-08T10:00:00.000Z', payload: { secret: 'must not cross boundary' } })

describe('production run service projection boundary', () => {
  it('redacts policy, prompt/paths, vendor credentials and nested contract paths', () => {
    const repository = { read: vi.fn(() => run), readEvents: vi.fn(() => []) }
    const projection = createProductionRunService({ repository: repository as never, projectRootResolver: () => null }).readProjection('project-1', 'run-1')
    expect(projection).not.toHaveProperty('policy')
    expect(projection).not.toHaveProperty('brief')
    expect(projection.jobs[0]).not.toHaveProperty('provider')
    expect(projection.jobs[0]).not.toHaveProperty('model')
    expect(projection.jobs[0]).not.toHaveProperty('providerTaskId')
    expect(projection.jobs[0]).not.toHaveProperty('errorMessage')
    expect(projection.gates[0]).not.toHaveProperty('planHash')
    expect(projection.gates[0].contract?.evidence[0]).not.toHaveProperty('projectRelativePath')
    expect(projection.artifacts[0]).toHaveProperty('nomiUri', 'nomi://project/project-1/run/run-1/artifact/artifact-1')
  })

  it('omits hostile URLs and absolute paths from every nested external text field', () => {
    const hostile = '/Users/alice/My Secret/file.mp4 https://provider.example/private?id=secret C:\\Users\\alice\\secret.mp4'
    const hostileRun: ProductionRun = {
      ...run,
      stages: run.stages.map((stage) => ({ ...stage, title: hostile })),
      gates: run.gates.map((gate) => ({
        ...gate,
        title: hostile,
        summary: hostile,
        contract: gate.contract ? {
          ...gate.contract,
          claims: [{ text: hostile, evidenceIds: ['evidence-1'] }],
          evidence: [{ evidenceId: 'evidence-1', label: hostile, projectRelativePath: 'private/file.mp4' }],
          skills: [{ name: hostile, version: hostile }],
        } : undefined,
      })),
    }
    const repository = { read: vi.fn(() => hostileRun), readEvents: vi.fn(() => []) }
    const projection = createProductionRunService({ repository: repository as never, projectRootResolver: () => null }).readProjection('project-1', 'run-1')
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toMatch(/provider\.example|\/Users\/|My Secret|C:\\\\Users|secret\.mp4/i)
  })

  it('advances the cursor past filtered durable events', async () => {
    const repository = { read: vi.fn(() => run), readEvents: vi.fn(() => [event(4, 'internal.noise'), event(5, 'artifact.ready')]) }
    const result = await createProductionRunService({ repository: repository as never, sleep: async () => {} }).readEvents('project-1', 'run-1', 3, 0)
    expect(result.events).toHaveLength(1)
    expect(result.nextCursor).toBe(5)
  })
})
