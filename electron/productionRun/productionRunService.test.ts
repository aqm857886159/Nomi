import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProductionRunService } from './productionRunService'
import type { ProductionRun, RunEvent } from './productionRunTypes'
import { createApprovalReceiptAuthority } from '../capabilityCore/approvalReceipt'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function makeApprovalReceipt(clock: () => string = () => '2026-08-23T00:00:00.000Z') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-service-receipt-'))
  tempDirs.push(dir)
  const authority = createApprovalReceiptAuthority({
    filePath: path.join(dir, 'receipts.json'),
    macKey: 'service-receipt-key',
    storeMacKey: 'service-receipt-store-key',
    keyId: 'service-receipt-v1',
    now: clock,
    randomId: (() => {
      let index = 0
      return () => 'service-receipt-id-' + ++index
    })(),
  })
  const challenge = authority.requestChallenge({
    challengeKey: 'run-1:contract-1:generation_submit:revision-2',
    immutableProjectUuid: 'uuid-1',
    projectGeneration: 1,
    projectId: 'project-1',
    runId: 'run-1',
    gateId: 'gate-1',
    contractHash: 'contract-1',
    targetHash: 'contract-1',
    projectRevision: 2,
    costScope: 'CNY:5',
    pricingSnapshotHash: 'price-1',
    reservationPreview: { currency: 'CNY', maximum: 5 },
  })
  const gesture = authority.createMainProcessGestureAttestation(challenge.token, {
    webContentsId: 1,
    frameId: 1,
    origin: 'app://nomi',
    decision: 'accept',
  })
  const minted = authority.mintReceipt(challenge.token, gesture)
  return { authority, receiptId: minted.receipt.receiptId }
}

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
  it('keeps readProjection pure and leaves restart recovery explicit', async () => {
    const repository = {
      read: vi.fn(() => run),
      readEvents: vi.fn(() => []),
      list: vi.fn(() => [{ runId: run.runId }]),
      execute: vi.fn(),
    }
    const service = createProductionRunService({ repository: repository as never, projectRootResolver: () => null })

    service.readProjection('project-1', 'run-1')
    await Promise.resolve()

    expect(repository.list).not.toHaveBeenCalled()
    expect(repository.execute).not.toHaveBeenCalled()
  })

  it('keeps listFull read-only and leaves restart recovery explicit', () => {
    const repository = {
      read: vi.fn(() => run),
      readEvents: vi.fn(() => []),
      list: vi.fn(() => [{ runId: run.runId }]),
      execute: vi.fn(),
    }
    const service = createProductionRunService({ repository: repository as never, projectRootResolver: () => null })

    expect(service.listFull('project-1')).toHaveLength(1)
    expect(repository.execute).not.toHaveBeenCalled()
  })

  it('does not let legacy restart recovery rewrite a semantic single-shot job', async () => {
    const semanticRun = {
      ...run,
      playbook: { name: 'generation.single-shot', version: '1.0.0' },
      generationPlan: { operationId: run.runId } as ProductionRun['generationPlan'],
      jobs: [{
        ...run.jobs[0],
        jobId: 'generation-run-1-contract-attempt-1',
        status: 'provider_accepted' as const,
        executionBinding: { runId: run.runId, contractHash: 'contract', providerNamespace: run.jobs[0].provider } as never,
        runtimeEnvelopeRef: '.nomi/runs/run-1/jobs/generation-run-1-contract-attempt-1/runtime-envelope.json',
      }],
    } satisfies ProductionRun
    const repository = {
      read: vi.fn(() => semanticRun),
      readEvents: vi.fn(() => []),
      list: vi.fn(() => [{ runId: semanticRun.runId }]),
      execute: vi.fn(),
    }
    const service = createProductionRunService({ repository: repository as never, projectRootResolver: () => null })

    await service.resumeUnfinishedRuns('project-1')

    expect(repository.execute).not.toHaveBeenCalled()
  })

  it('keeps actionable submission identity while redacting policy, credentials and paths', () => {
    const repository = { read: vi.fn(() => run), readEvents: vi.fn(() => []) }
    const projection = createProductionRunService({ repository: repository as never, projectRootResolver: () => null }).readProjection('project-1', 'run-1')
    expect(projection).not.toHaveProperty('policy')
    expect(projection).not.toHaveProperty('brief')
    expect(projection.jobs[0]).toMatchObject({ provider: 'secret-provider', model: 'secret-model', nodeId: 'secret-node' })
    expect(projection.jobs[0]).not.toHaveProperty('providerTaskId')
    expect(projection.jobs[0]).not.toHaveProperty('idempotencyKey')
    expect(projection.jobs[0]).not.toHaveProperty('errorMessage')
    expect(projection.gates[0]).not.toHaveProperty('planHash')
    expect(projection.gates[0].contract?.evidence[0]).not.toHaveProperty('projectRelativePath')
    expect(projection.artifacts[0]).toHaveProperty('nomiUri', 'nomi://project/project-1/run/run-1/artifact/artifact-1')
  })

  it('carries shot lineage and the project-relative artifact path so a local agent can verify its own batch', () => {
    // 这两格是「agent 自己传进来的 id」和「项目内相对路径」——扣着不发，agent 读回来认不出哪个 job 是哪一镜、
    // 也找不到产物文件（S6.5 付费验收就因此 ffprobe 腿降级、返工腿恒失败）。发，但都按值校验后再发。
    const lineageRun: ProductionRun = {
      ...run,
      jobs: [
        { ...run.jobs[0], jobId: 'job-shot-1', metadata: { shotId: 'shot-1', dialogue: '不该外发的台词长文本' } },
        { ...run.jobs[0], jobId: 'job-hostile', metadata: { shotId: '/Users/private/../../etc/passwd' } },
        { ...run.jobs[0], jobId: 'job-legacy' },
      ],
      artifacts: [
        { ...run.artifacts[0], artifactId: 'artifact-video', kind: 'video', projectRelativePath: '.nomi/out/shot-1.mp4' },
        { ...run.artifacts[0], artifactId: 'artifact-absolute', kind: 'video', projectRelativePath: '/Users/private/leak.mp4' },
      ],
    }
    const repository = { read: vi.fn(() => lineageRun), readEvents: vi.fn(() => []) }
    const projection = createProductionRunService({ repository: repository as never, projectRootResolver: () => null }).readProjection('project-1', 'run-1')

    expect(projection.jobs[0].metadata).toEqual({ shotId: 'shot-1' }) // 只 shotId 一格，台词没跟着漏出来
    expect(projection.jobs[1]).not.toHaveProperty('metadata') // 不合法 id 宁可缺，不外发未校验串
    expect(projection.jobs[2]).not.toHaveProperty('metadata') // 单镜/老 run 无谱系 → 不发
    expect(projection.artifacts[0]).toHaveProperty('projectRelativePath', '.nomi/out/shot-1.mp4')
    expect(projection.artifacts[1]).not.toHaveProperty('projectRelativePath') // 绝对路径一律省略
    expect(JSON.stringify(projection)).not.toContain('/Users/private')
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

  it('requires and consumes a verified approval receipt inside the Run gate owner', async () => {
    const approval = makeApprovalReceipt()
    const execute = vi.fn(() => ({
      run: {
        ...run,
        revision: 3,
        gates: run.gates.map((gate) => ({ ...gate, status: 'approved' as const })),
      },
      events: [],
    }))
    const repository = {
      read: vi.fn(() => run),
      readEvents: vi.fn(() => []),
      execute,
    }
    const consume = vi.spyOn(approval.authority, 'consumeReceipt')
    const service = createProductionRunService({
      repository: repository as never,
      projectRootResolver: () => null,
      approvalReceiptAuthority: approval.authority,
      projectRevisionResolver: () => 2,
    })

    await expect(service.command('project-1', 'run-1', {
      commandId: 'gate-without-receipt',
      expectedRevision: 2,
      type: 'gate.decide',
      payload: { gateId: 'gate-1', status: 'approved' },
      issuedAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: 'human_approval_required' })
    expect(execute).not.toHaveBeenCalled()

    const decided = await service.command('project-1', 'run-1', {
      commandId: 'gate-with-receipt',
      expectedRevision: 2,
      type: 'gate.decide',
      payload: { gateId: 'gate-1', status: 'approved', receiptId: approval.receiptId },
      issuedAt: new Date().toISOString(),
    })
    expect(decided.run.gates[0].status).toBe('approved')
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale receipt before execute and also checks receipts on duplicate decisions', async () => {
    const approval = makeApprovalReceipt()
    const execute = vi.fn(() => ({ run, events: [] }))
    const repository = {
      read: vi.fn(() => ({
        ...run,
        gates: run.gates.map((gate) => ({ ...gate, status: 'approved' as const })),
      })),
      readEvents: vi.fn(() => []),
      execute,
    }
    let projectRevision = 2
    const consume = vi.spyOn(approval.authority, 'consumeReceipt')
    const service = createProductionRunService({
      repository: repository as never,
      projectRootResolver: () => null,
      approvalReceiptAuthority: approval.authority,
      projectRevisionResolver: () => projectRevision,
    })

    projectRevision = 3
    await expect(service.command('project-1', 'run-1', {
      commandId: 'duplicate-with-stale-receipt',
      expectedRevision: 2,
      type: 'gate.decide',
      payload: { gateId: 'gate-1', status: 'approved', receiptId: approval.receiptId, projectRevision: 2 },
      issuedAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: 'receipt_invalid' })
    expect(execute).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
  })

  it('verifies a valid receipt before returning a duplicate approved gate no-op', async () => {
    const approval = makeApprovalReceipt()
    const execute = vi.fn(() => ({ run, events: [] }))
    const repository = {
      read: vi.fn(() => ({
        ...run,
        gates: run.gates.map((gate) => ({ ...gate, status: 'approved' as const })),
      })),
      readEvents: vi.fn(() => []),
      execute,
    }
    const verify = vi.spyOn(approval.authority, 'verifyReceipt')
    const service = createProductionRunService({
      repository: repository as never,
      projectRootResolver: () => null,
      approvalReceiptAuthority: approval.authority,
      projectRevisionResolver: () => 2,
    })

    const result = await service.command('project-1', 'run-1', {
      commandId: 'duplicate-with-valid-receipt',
      expectedRevision: 2,
      type: 'gate.decide',
      payload: { gateId: 'gate-1', status: 'approved', receiptId: approval.receiptId, projectRevision: 2 },
      issuedAt: new Date().toISOString(),
    })

    expect(result).toEqual({ run: expect.objectContaining({ revision: 2 }), events: [] })
    expect(verify).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })

  it('keeps a receipt-free duplicate no-op and verifies a token-only duplicate', async () => {
    const approval = makeApprovalReceipt()
    const token = approval.authority.resolveReceiptToken(approval.receiptId)
    const execute = vi.fn(() => ({ run, events: [] }))
    const repository = {
      read: vi.fn(() => ({
        ...run,
        gates: run.gates.map((gate) => ({ ...gate, status: 'approved' as const })),
      })),
      readEvents: vi.fn(() => []),
      execute,
    }
    const verify = vi.spyOn(approval.authority, 'verifyReceipt')
    const service = createProductionRunService({
      repository: repository as never,
      projectRootResolver: () => null,
      approvalReceiptAuthority: approval.authority,
      projectRevisionResolver: () => 2,
    })

    await expect(service.command('project-1', 'run-1', {
      commandId: 'duplicate-without-receipt',
      expectedRevision: 2,
      type: 'gate.decide',
      payload: { gateId: 'gate-1', status: 'approved' },
      issuedAt: new Date().toISOString(),
    })).resolves.toEqual({ run: expect.objectContaining({ revision: 2 }), events: [] })
    expect(verify).not.toHaveBeenCalled()

    await expect(service.command('project-1', 'run-1', {
      commandId: 'duplicate-with-token-only',
      expectedRevision: 2,
      type: 'gate.decide',
      payload: { gateId: 'gate-1', status: 'approved', receiptToken: token, projectRevision: 2 },
      issuedAt: new Date().toISOString(),
    })).resolves.toEqual({ run: expect.objectContaining({ revision: 2 }), events: [] })
    expect(verify).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not enter the receipt gate for a non-gate production command', async () => {
    const approval = makeApprovalReceipt()
    const execute = vi.fn(() => ({ run, events: [] }))
    const repository = { read: vi.fn(() => run), readEvents: vi.fn(() => []), execute }
    const service = createProductionRunService({
      repository: repository as never,
      projectRootResolver: () => null,
      approvalReceiptAuthority: approval.authority,
      projectRevisionResolver: () => 2,
    })

    await expect(service.command('project-1', 'run-1', {
      commandId: 'non-gate-command',
      expectedRevision: 2,
      type: 'job.status',
      payload: { jobId: 'job-1', status: 'polling' },
      issuedAt: new Date().toISOString(),
    })).resolves.toEqual({ run, events: [] })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps malformed gate identity on the normal command path without receipt lookup', async () => {
    const execute = vi.fn(() => ({ run, events: [] }))
    const repository = { read: vi.fn(() => run), readEvents: vi.fn(() => []), execute }
    const service = createProductionRunService({ repository: repository as never, projectRootResolver: () => null })

    await expect(service.command('project-1', 'run-1', {
      commandId: 'gate-without-id',
      expectedRevision: 2,
      type: 'gate.decide',
      payload: { status: 'approved' },
      issuedAt: new Date().toISOString(),
    })).resolves.toEqual({ run, events: [] })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('rejects a receipt whose verified scope belongs to another project before execute', async () => {
    const approval = makeApprovalReceipt()
    const token = approval.authority.resolveReceiptToken(approval.receiptId)
    const verified = approval.authority.verifyReceipt(token)
    const foreignAuthority = {
      resolveReceiptToken: vi.fn(() => token),
      verifyReceipt: vi.fn(() => ({ ...verified, projectId: 'project-other' })),
      consumeReceipt: vi.fn(),
    }
    const execute = vi.fn(() => ({ run, events: [] }))
    const repository = { read: vi.fn(() => run), readEvents: vi.fn(() => []), execute }
    const service = createProductionRunService({
      repository: repository as never,
      projectRootResolver: () => null,
      approvalReceiptAuthority: foreignAuthority as never,
      projectRevisionResolver: () => 2,
    })

    await expect(service.command('project-1', 'run-1', {
      commandId: 'foreign-scope-receipt',
      expectedRevision: 2,
      type: 'gate.decide',
      payload: { gateId: 'gate-1', status: 'approved', receiptId: approval.receiptId },
      issuedAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: 'receipt_invalid', message: expect.stringContaining('projectId') })
    expect(execute).not.toHaveBeenCalled()
  })

  it('maps a malformed verified receipt failure to receipt_invalid before execute', async () => {
    const authority = {
      resolveReceiptToken: vi.fn(() => 'malformed-token'),
      verifyReceipt: vi.fn(() => { throw new Error('malformed sealed receipt') }),
      consumeReceipt: vi.fn(),
    }
    const execute = vi.fn(() => ({ run, events: [] }))
    const repository = { read: vi.fn(() => run), readEvents: vi.fn(() => []), execute }
    const service = createProductionRunService({
      repository: repository as never,
      projectRootResolver: () => null,
      approvalReceiptAuthority: authority as never,
      projectRevisionResolver: () => 2,
    })

    await expect(service.command('project-1', 'run-1', {
      commandId: 'malformed-receipt',
      expectedRevision: 2,
      type: 'gate.decide',
      payload: { gateId: 'gate-1', status: 'approved', receiptId: 'receipt-malformed' },
      issuedAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: 'receipt_invalid', message: 'malformed sealed receipt' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects an expired receipt before execute and leaves it available for audit', async () => {
    let clock = '2026-08-23T00:00:00.000Z'
    const approval = makeApprovalReceipt(() => clock)
    const execute = vi.fn(() => ({ run, events: [] }))
    const repository = {
      read: vi.fn(() => run),
      readEvents: vi.fn(() => []),
      execute,
    }
    const consume = vi.spyOn(approval.authority, 'consumeReceipt')
    const service = createProductionRunService({
      repository: repository as never,
      projectRootResolver: () => null,
      approvalReceiptAuthority: approval.authority,
      projectRevisionResolver: () => 2,
    })

    clock = '2026-08-23T00:06:00.000Z'
    await expect(service.command('project-1', 'run-1', {
      commandId: 'expired-receipt',
      expectedRevision: 2,
      type: 'gate.decide',
      payload: { gateId: 'gate-1', status: 'approved', receiptId: approval.receiptId },
      issuedAt: clock,
    })).rejects.toMatchObject({ code: 'receipt_expired' })
    expect(execute).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
  })
})
