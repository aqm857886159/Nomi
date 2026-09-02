import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildToolOutcome } from '../capabilityCore/mcpToolResults'
import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { approveLatestScript, approveLatestStoryboard, waitForProduction as waitFor } from './productionRunTestHelpers'

function makeRuntime(root: string, submissions: string[]) {
  fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
  fs.writeFileSync(path.join(root, 'assets/generated/shot.mp4'), 'video', 'utf8')
  const repository = createProductionRunRepository({ projectDirResolver: () => root })
  const service = createProductionRunService({
    repository,
    projectRootResolver: () => root,
    requestRenderer: async (op, payload) => {
      if (op === 'production.plan-directions') return { candidates: [
        { key: 'a', title: 'Direction A', oneLiner: 'Quiet product story' },
        { key: 'b', title: 'Direction B', oneLiner: 'Fast product montage' },
      ] }
      if (op === 'production.plan-script') return { text: 'shot gate script' }
      if (op === 'production.plan-storyboard') return { plan: {
        title: 'promo', anchors: [], shots: [
          { index: 1, shotKind: 'video', prompt: 'shot one' },
          { index: 2, shotKind: 'video', prompt: 'shot two' },
        ],
      } }
      if (op === 'production.generate-node') {
        submissions.push(String((payload as { jobId?: string }).jobId))
        return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
      }
      if (op === 'production.arrange') return { arranged: 2, total: 2 }
      throw new Error(`unexpected renderer op: ${op}`)
    },
    policyResolver: () => ({
      trustedHosts: ['codex'],
      allowedProviders: ['local'],
      allowedModels: ['demo-video'],
      maxSpend: 10,
      maxAttemptsPerJob: 1,
    }),
  })
  return { repository, service }
}

async function driveToFirstShotGate(
  service: ReturnType<typeof createProductionRunService>,
  runId: string,
): Promise<void> {
  service.createDraft({
    runId,
    projectId: 'project-1',
    playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex' },
    brief: { goal: 'Confirm every shot', durationSeconds: 30 },
    policy: { trustLevel: 'confirm_all' },
  })
  await waitFor(() => (service.readFull('project-1', runId)?.gates
    .find((gate) => gate.gateId === 'gate-direction-v1')?.directionCandidates?.length ?? 0) === 2)
  let current = service.readFull('project-1', runId)!
  await service.command('project-1', runId, {
    commandId: 'approve-direction', expectedRevision: current.revision, type: 'gate.decide',
    payload: { gateId: 'gate-direction-v1', status: 'approved', choiceKey: 'a' }, issuedAt: new Date().toISOString(),
  })
  await approveLatestScript(service, 'project-1', runId)
  await approveLatestStoryboard(service, 'project-1', runId)
  current = service.readFull('project-1', runId)!
  const storyboard = current.artifacts.find((artifact) => artifact.kind === 'storyboard')!
  const attached = await service.command('project-1', runId, {
    commandId: 'attach-plan', expectedRevision: current.revision, type: 'plan.attach',
    payload: { artifactId: storyboard.artifactId, bindings: [
      { nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' },
      { nodeId: 'shot-2', provider: 'local', model: 'demo-video', stageId: 'generate' },
    ] },
    issuedAt: new Date().toISOString(),
  })
  const contract = attached.run.gates.find((gate) => gate.scope === 'budget_envelope')!
  expect(contract.status).toBe('waiting')
  await service.command('project-1', runId, {
    commandId: 'approve-contract', expectedRevision: attached.run.revision, type: 'gate.decide',
    payload: { gateId: contract.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
  })
  await waitFor(() => service.readFull('project-1', runId)!.gates
    .some((gate) => gate.gateId.startsWith('gate-shot-') && gate.status === 'waiting'))
}

describe('confirm_all per-shot provider boundary', () => {
  it('stops before every submission and one approval submits exactly one shot', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-shot-gate-'))
    const submissions: string[] = []
    const { service } = makeRuntime(root, submissions)
    const runId = 'run-shot-1'
    await driveToFirstShotGate(service, runId)

    let current = service.readFull('project-1', runId)!
    let shotGate = current.gates.find((gate) => gate.gateId.startsWith('gate-shot-') && gate.status === 'waiting')!
    expect(shotGate.scope).toBe('job_set')
    expect(shotGate.jobIds).toEqual([current.jobs[0].jobId])
    expect(submissions).toEqual([])
    expect(current.gates.find((gate) => gate.scope === 'budget_envelope')?.status).toBe('approved')

    const narration = buildToolOutcome('nomi_read', { target: 'run', projectId: 'project-1', runId }, service.readProjection('project-1', runId), 'zh-CN')
    expect(narration.text).toContain('第 1 镜')
    expect(narration.text).toContain('shot-1')
    expect(narration.text).toContain('local · demo-video')
    expect(narration.text).toContain('请回 Nomi 决定')
    expect(narration.outcome).toMatchObject({ shotGateId: shotGate.gateId, shotJobId: current.jobs[0].jobId, nextActions: ['review_shot_in_nomi'] })

    await service.command('project-1', runId, {
      commandId: 'approve-shot-1', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: shotGate.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', runId)!.gates
      .some((gate) => gate.gateId.startsWith('gate-sample-') && gate.status === 'waiting'))
    expect(submissions).toEqual([current.jobs[0].jobId])

    current = service.readFull('project-1', runId)!
    const sampleGate = current.gates.find((gate) => gate.gateId.startsWith('gate-sample-') && gate.status === 'waiting')!
    await service.command('project-1', runId, {
      commandId: 'approve-sample', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: sampleGate.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', runId)!.gates
      .filter((gate) => gate.gateId.startsWith('gate-shot-') && gate.status === 'waiting').length === 1)

    current = service.readFull('project-1', runId)!
    shotGate = current.gates.find((gate) => gate.gateId.startsWith('gate-shot-') && gate.status === 'waiting')!
    expect(shotGate.jobIds).toEqual([current.jobs[1].jobId])
    expect(submissions).toHaveLength(1)
    await service.command('project-1', runId, {
      commandId: 'approve-shot-2', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: shotGate.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', runId)!.status === 'awaiting_rough_cut_review')
    expect(submissions).toEqual([current.jobs[0].jobId, current.jobs[1].jobId])

    const completed = service.readFull('project-1', runId)!
    await service.command('project-1', runId, {
      commandId: 'duplicate-approve-shot-2', expectedRevision: completed.revision, type: 'gate.decide',
      payload: { gateId: shotGate.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(submissions).toHaveLength(2)
  })

  it('recovers a waiting shot gate after restart without submitting until approval', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-shot-restart-'))
    const submissions: string[] = []
    const first = makeRuntime(root, submissions)
    const runId = 'run-shot-restart'
    await driveToFirstShotGate(first.service, runId)
    expect(submissions).toEqual([])

    const restarted = makeRuntime(root, submissions).service
    await restarted.resumeUnfinishedRuns('project-1')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(submissions).toEqual([])
    const current = restarted.readFull('project-1', runId)!
    const gate = current.gates.find((candidate) => candidate.gateId.startsWith('gate-shot-') && candidate.status === 'waiting')!
    await restarted.command('project-1', runId, {
      commandId: 'approve-after-restart', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: gate.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => submissions.length === 1)
    expect(submissions).toEqual([current.jobs[0].jobId])
  })

  it('re-kicks an approved but not yet submitted shot after restart exactly once', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-shot-approved-restart-'))
    const submissions: string[] = []
    const first = makeRuntime(root, submissions)
    const runId = 'run-shot-approved-restart'
    await driveToFirstShotGate(first.service, runId)
    const current = first.service.readFull('project-1', runId)!
    const gate = current.gates.find((candidate) => candidate.gateId.startsWith('gate-shot-') && candidate.status === 'waiting')!

    // Persist the human decision without invoking the service's post-command driver hook, which
    // models a process exit in the narrow window after the decision reached disk.
    first.repository.execute('project-1', runId, {
      commandId: 'approve-then-crash', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: gate.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    expect(submissions).toEqual([])

    const restarted = makeRuntime(root, submissions).service
    await restarted.resumeUnfinishedRuns('project-1')
    await waitFor(() => submissions.length === 1)
    expect(submissions).toEqual([current.jobs[0].jobId])
  })

  it('rejecting a shot pauses the run and makes no provider call', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-shot-reject-'))
    const submissions: string[] = []
    const { service } = makeRuntime(root, submissions)
    const runId = 'run-shot-reject'
    await driveToFirstShotGate(service, runId)
    const current = service.readFull('project-1', runId)!
    const gate = current.gates.find((candidate) => candidate.gateId.startsWith('gate-shot-') && candidate.status === 'waiting')!
    await service.command('project-1', runId, {
      commandId: 'reject-shot', expectedRevision: current.revision, type: 'gate.decide',
      payload: { gateId: gate.gateId, status: 'rejected' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', runId)!.status === 'paused')
    expect(submissions).toEqual([])
    expect(service.readFull('project-1', runId)!.gates.find((candidate) => candidate.gateId === gate.gateId)?.status).toBe('rejected')

    const paused = service.readFull('project-1', runId)!
    await service.command('project-1', runId, {
      commandId: 'resume-after-shot-reject', expectedRevision: paused.revision, type: 'run.control',
      payload: { action: 'resume' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', runId)!.gates
      .some((candidate) => candidate.gateId !== gate.gateId && candidate.gateId.startsWith('gate-shot-') && candidate.status === 'waiting'))
    const retried = service.readFull('project-1', runId)!
    const retryGate = retried.gates.find((candidate) => candidate.gateId !== gate.gateId && candidate.gateId.startsWith('gate-shot-') && candidate.status === 'waiting')!
    expect(retryGate.gateId).toMatch(/-r2$/)
    expect(submissions).toEqual([])

    await service.command('project-1', runId, {
      commandId: 'approve-retried-shot', expectedRevision: retried.revision, type: 'gate.decide',
      payload: { gateId: retryGate.gateId, status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => submissions.length === 1)
    expect(submissions).toEqual([retried.jobs[0].jobId])
  }, 15_000)
})
