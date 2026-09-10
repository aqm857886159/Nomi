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

/**
 * 一个「已封存付费授权 + confirm_all（逐镜确认开着）」的 Run。降到 budget_only 就是把这几镜的
 * 逐镜确认一次性拿掉——付费放行，所以要收据。逐镜价目/合计/上限全部来自这个信封（唯一价格真相源）。
 */
function trustGrantRun(): ProductionRun {
  return {
    ...run,
    policy: { ...run.policy, trustLevel: 'confirm_all' },
    generationPlan: {
      operationId: 'run-1',
      state: 'sealed',
      candidate: {} as never,
      costCertainty: 'known',
      authorizationDigest: 'digest-trust',
      authorizationGateId: 'gate-1',
      authorizationEnvelope: {
        schemaVersion: 1,
        immutableProjectUuid: 'uuid-1',
        projectGeneration: 1,
        projectId: 'project-1',
        projectRevision: 2,
        runId: 'run-1',
        planVersion: 1,
        gateId: 'gate-1',
        costScope: 'generation.multi-shot:run-1',
        expiresAt: '2026-08-24T00:00:00.000Z',
        budget: { currency: 'CNY', maximum: 9, ledgerCeiling: 20 },
        jobs: [
          { jobId: 'job-1', shotId: 'shot-1', providerId: 'apimart', modelId: 'kling-v2', mode: 'i2v', price: { currency: 'CNY', maximum: 4 } },
          { jobId: 'job-2', shotId: 'shot-2', providerId: 'apimart', modelId: 'kling-v2', mode: 'i2v', price: { currency: 'CNY', maximum: 5 } },
        ],
      } as never,
      updatedAt: '2026-08-08T10:00:00.000Z',
    },
  }
}

/** 铸一张信任降档收据。costScope 里的 maximum 就是「¥X 内不再逐镜问」的那个 X。 */
function mintTrustReceipt(maximum: number, keySuffix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-trust-receipt-'))
  tempDirs.push(dir)
  const authority = createApprovalReceiptAuthority({
    filePath: path.join(dir, 'receipts.json'),
    macKey: 'trust-receipt-key',
    storeMacKey: 'trust-receipt-store-key',
    keyId: 'trust-receipt-v1',
    now: () => '2026-08-23T00:00:00.000Z',
    randomId: (() => { let index = 0; return () => `trust-receipt-${keySuffix}-${++index}` })(),
  })
  const challenge = authority.requestChallenge({
    challengeKey: `trust.budget-only:run-1:CNY:${maximum}:digest-trust`,
    immutableProjectUuid: 'uuid-1',
    projectGeneration: 1,
    projectId: 'project-1',
    runId: 'run-1',
    gateId: 'trust-budget-only-v1',
    contractHash: 'digest-trust',
    targetHash: 'digest-trust',
    projectRevision: 2,
    costScope: `trust.budget-only:run-1:CNY:${maximum}`,
    pricingSnapshotHash: 'digest-trust',
    reservationPreview: { currency: 'CNY', maximum },
  })
  const gesture = authority.createClientElicitationAttestation(challenge.token, 'codex')
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

  // 2026-09-10 根因回归闸（装配侧）：生产装配长期没注入收据权威，旧实现在权威缺席时直接放行付费门。
  // 这里用「没有权威的 service」复现那个装配，证明它现在**拒绝**，且只有主进程手势章过得去。
  it('fails closed on a spend gate when the service was assembled without a receipt authority', async () => {
    const execute = vi.fn(() => ({ run: { ...run, revision: 3 }, events: [] }))
    const repository = { read: vi.fn(() => run), readEvents: vi.fn(() => []), execute }
    const service = createProductionRunService({ repository: repository as never, projectRootResolver: () => null })
    const decide = (commandId: string, extra: Record<string, unknown> = {}) => service.command('project-1', 'run-1', {
      commandId,
      expectedRevision: 2,
      type: 'gate.decide',
      payload: { gateId: 'gate-1', status: 'approved' },
      issuedAt: new Date().toISOString(),
      ...extra,
    })

    await expect(decide('remote-approve-no-authority')).rejects.toMatchObject({ code: 'human_approval_required' })
    expect(execute).not.toHaveBeenCalled()

    // 带着收据也一样拒：验不动就是验不动，绝不「验不了就放行」。
    await expect(decide('remote-approve-with-unverifiable-receipt', {
      payload: { gateId: 'gate-1', status: 'approved', receiptId: 'receipt-from-nowhere' },
    })).rejects.toMatchObject({ code: 'human_approval_required' })
    expect(execute).not.toHaveBeenCalled()

    // Nomi 自己窗口里的真人手势（productionRunIpc 在受信发送方校验后盖的章）照常通过。
    await expect(decide('in-app-gesture', { humanGesture: true })).resolves.toMatchObject({ run: { revision: 3 } })
    expect(execute).toHaveBeenCalledTimes(1)
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
  // 2026-09-10 21:00 拍板：「以后 ¥X 内别再逐镜问」的确认弹在**客户端**里（elicitation），答「是」拿到的
  // 收据就是人证。收据把上限编在 costScope 里（trust.budget-only:<runId>:<币种>:<上限>）——服务端从
  // 已封存授权重算这个串再比对，所以改上限或换 run 的收据一律失配。
  it('accepts a ceiling-bound elicitation receipt for the budget_only downgrade and consumes it once', async () => {
    const current = trustGrantRun()
    const approval = mintTrustReceipt(9, 'ok')
    const execute = vi.fn(() => ({ run: { ...current, revision: 3 }, events: [] }))
    const repository = { read: vi.fn(() => current), readEvents: vi.fn(() => []), execute }
    const consume = vi.spyOn(approval.authority, 'consumeReceipt')
    const service = createProductionRunService({
      repository: repository as never,
      projectRootResolver: () => null,
      approvalReceiptAuthority: approval.authority,
      projectRevisionResolver: () => 2,
    })

    const result = await service.command('project-1', 'run-1', {
      commandId: 'trust-with-receipt',
      expectedRevision: 2,
      type: 'run.control',
      payload: { action: 'set_trust', trustLevel: 'budget_only', receiptId: approval.receiptId },
      issuedAt: new Date().toISOString(),
    })
    expect(result.run.revision).toBe(3)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it('rejects a budget_only downgrade whose receipt is bound to a different ceiling', async () => {
    const current = trustGrantRun()
    // 用户在客户端答的是「¥99 内不再问」，而这个 Run 真正要放行的是 ¥9——两个数字不是一回事，拒。
    const approval = mintTrustReceipt(99, 'mismatch')
    const execute = vi.fn(() => ({ run: current, events: [] }))
    const repository = { read: vi.fn(() => current), readEvents: vi.fn(() => []), execute }
    const service = createProductionRunService({
      repository: repository as never,
      projectRootResolver: () => null,
      approvalReceiptAuthority: approval.authority,
      projectRevisionResolver: () => 2,
    })

    await expect(service.command('project-1', 'run-1', {
      commandId: 'trust-with-wrong-ceiling',
      expectedRevision: 2,
      type: 'run.control',
      payload: { action: 'set_trust', trustLevel: 'budget_only', receiptId: approval.receiptId },
      issuedAt: new Date().toISOString(),
    })).rejects.toMatchObject({ code: 'receipt_invalid', message: expect.stringContaining('costScope') })
    expect(execute).not.toHaveBeenCalled()
  })
})
