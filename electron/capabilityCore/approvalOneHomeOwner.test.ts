// 生成门主人那份只读结论（readApprovalDecision）的合同：重发等别处只读它，不自己判。
// 每一档都从真实的收据库走出来：等人、批了没用、用掉、过期（挑战 / 收据各一）、不认识；
// 策略放行（approveGateByPolicy）记的是策略、不是人；问人那一刻请求被取消，晚到的「是」不签。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const renderer = vi.hoisted(() => ({ asks: [] as Array<(value: unknown) => void>, authority: null as unknown }))
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() } }))
vi.mock('./approvalReceiptRuntime', () => ({ getApprovalReceiptAuthority: () => renderer.authority, currentProjectRevision: () => 2 }))
vi.mock('./rendererBridge', () => ({
  requestRendererDecision: () => new Promise((resolve) => { renderer.asks.push(resolve) }),
  rendererTargetIdentity: () => ({ webContentsId: 7, frameId: 1, origin: 'app://nomi' }),
}))
vi.mock('./projectSessionRuntime', () => ({ createProductionProjectSessionRuntime: () => ({ authority: undefined }) }))
vi.mock('./canvasReadSurfaceRuntime', () => ({ canvasReadSurfaceRuntime: { getCommittedProjectSelection: () => null } }))
import { createDefaultAuthorities } from './appIntegrationAuthorities'

import { createApprovalReceiptAuthority } from './approvalReceipt'
import { approveGateByPolicy, readApprovalDecision } from './runOwnedGenerationGateAuthority'

const roots: string[] = []
afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

function receiptsWithClock() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-approval-owner-'))
  roots.push(root)
  let tick = 0
  const authority = createApprovalReceiptAuthority({
    filePath: path.join(root, 'approval-receipts.json'),
    macKey: 'owner-key',
    now: () => new Date(Date.UTC(2026, 10, 20, 0, 0, 0) + tick * 1000).toISOString(),
  })
  return { authority, advance: (seconds: number) => { tick += seconds } }
}

function challengeOf(authority: ReturnType<typeof createApprovalReceiptAuthority>, key = 'generation_submit:op-1:digest-1', ttlMs = 5_000) {
  return authority.requestChallenge({
    challengeKey: key,
    immutableProjectUuid: 'uuid-1',
    projectGeneration: 1,
    projectId: 'project-1',
    runId: 'op-1',
    gateId: 'gate-1',
    contractHash: 'digest-1',
    targetHash: 'digest-1',
    projectRevision: 2,
    costScope: 'generation_submit',
    pricingSnapshotHash: 'digest-1',
    reservationPreview: { currency: 'CNY', maximum: 3 },
    display: { projectName: '短片', shotSummary: '3 镜', model: 'm-x', referenceCount: 0 },
    ttlMs,
  })
}

const gesture = { webContentsId: 7, frameId: 1, origin: 'app://nomi', decision: 'accept' as const }

describe('readApprovalDecision · 一笔批准此刻在哪一档', () => {
  it('等人 → 人批了 → 用掉：挑战和收据两种令牌读到同一档', () => {
    const { authority } = receiptsWithClock()
    const pending = challengeOf(authority)
    expect(readApprovalDecision(authority, { challengeToken: pending.token })).toEqual({ state: 'pending' })

    const minted = authority.mintReceipt(pending.token, authority.createMainProcessGestureAttestation(pending.token, gesture))
    const approved = { state: 'approved-unused', decidedBy: 'human:gesture', receiptId: minted.receipt.receiptId }
    expect(readApprovalDecision(authority, { challengeToken: pending.token })).toEqual(approved)
    expect(readApprovalDecision(authority, { receiptToken: minted.token })).toEqual(approved)

    authority.consumeReceipt(minted.token)
    const used = { ...approved, state: 'used' }
    expect(readApprovalDecision(authority, { challengeToken: pending.token })).toEqual(used)
    expect(readApprovalDecision(authority, { receiptToken: minted.token })).toEqual(used)
  })

  it('只读：读多少次都不写库、不改档', () => {
    const { authority } = receiptsWithClock()
    const pending = challengeOf(authority)
    const before = fs.readFileSync(authority.filePath, 'utf8')
    for (let i = 0; i < 3; i += 1) readApprovalDecision(authority, { challengeToken: pending.token })
    expect(fs.readFileSync(authority.filePath, 'utf8')).toBe(before)
  })

  it('没人答、挑战过了期 → expired；批了没花、收据过了期 → expired', () => {
    const { authority, advance } = receiptsWithClock()
    const idle = challengeOf(authority, 'generation_submit:op-1:idle')
    advance(6)
    expect(readApprovalDecision(authority, { challengeToken: idle.token })).toEqual({ state: 'expired' })

    const fresh = challengeOf(authority, 'generation_submit:op-1:fresh')
    const minted = authority.mintReceipt(fresh.token, authority.createMainProcessGestureAttestation(fresh.token, gesture))
    // 收据从人点下去那一刻起另算一段（默认 5 分钟），不继承挑战的剩余时间。
    advance(301)
    expect(readApprovalDecision(authority, { receiptToken: minted.token })).toMatchObject({ state: 'expired', receiptId: minted.receipt.receiptId })
  })

  it('不是这里签的 → unknown：伪造的挑战、别家库的收据、空串都不认', () => {
    const { authority } = receiptsWithClock()
    const other = receiptsWithClock().authority
    const foreign = challengeOf(other)
    const foreignReceipt = other.mintReceipt(foreign.token, other.createMainProcessGestureAttestation(foreign.token, gesture))

    expect(readApprovalDecision(authority, { challengeToken: 'not-a-token' })).toEqual({ state: 'unknown' })
    expect(readApprovalDecision(authority, { challengeToken: foreign.token })).toEqual({ state: 'unknown' })
    expect(readApprovalDecision(authority, { receiptToken: foreignReceipt.token })).toEqual({ state: 'unknown' })
    expect(readApprovalDecision(authority, { receiptToken: '' })).toEqual({ state: 'unknown' })
  })

  it('策略放行记的是策略：decidedBy = policy:full_auto，不是编一个人', () => {
    const { authority } = receiptsWithClock()
    const pending = challengeOf(authority)
    const minted = approveGateByPolicy(authority, pending.token, { policyMode: 'project', policySurface: 'nomi-app-agent' })
    expect(readApprovalDecision(authority, { receiptToken: minted.token })).toMatchObject({ state: 'approved-unused', decidedBy: 'policy:full_auto' })
  })
})

describe('createDefaultAuthorities · 旧入口问答合同', () => {
  it('问着的时候请求被取消：当场答「没批」，晚到的「是」不签收据，挑战仍是等人', async () => {
    const { authority } = receiptsWithClock()
    const pending = challengeOf(authority, 'generation_submit:op-1:abort', 600_000)
    renderer.authority = authority
    renderer.asks.length = 0
    const asks = renderer.asks
    const answers = createDefaultAuthorities()
    const controller = new AbortController()
    const confirm = answers.confirmGenerationInNomi as (input: { challengeToken: string }, options: { signal: AbortSignal }) => Promise<unknown>
    const settled = confirm({ challengeToken: pending.token }, { signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(asks).toHaveLength(1)

    controller.abort(new Error('client went away'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    asks[0]!({ confirmed: true })
    await expect(settled).resolves.toEqual({ confirmed: false, challengeId: pending.challenge.challengeId })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(Object.keys(JSON.parse(fs.readFileSync(authority.filePath, 'utf8')).receipts)).toHaveLength(0)
  })

  it('外部客户端：只有 accept + confirm=true 才签；签过、花掉之后再答「是」不再放行', async () => {
    const { authority } = receiptsWithClock()
    const pending = challengeOf(authority, 'generation_submit:op-1:client', 600_000)
    renderer.authority = authority
    const answers = createDefaultAuthorities()
    const yes = { action: 'accept', confirm: true }
    expect(await answers.verifyClientGenerationGateInMain!({ challengeToken: pending.token, authenticatedClient: 'codex', answer: { action: 'accept', confirm: 'true' } }))
      .toEqual({ confirmed: false })
    expect(await answers.verifyClientGenerationGateInMain!({ challengeToken: pending.token, authenticatedClient: '', answer: yes })).toEqual({ confirmed: false })

    const first = await answers.verifyClientGenerationGateInMain!({ challengeToken: pending.token, authenticatedClient: 'codex', answer: yes })
    expect(first).toMatchObject({ confirmed: true })
    expect(authority.verifyReceipt((first as { receiptToken: string }).receiptToken).decidedBy).toBe('human:elicitation')

    authority.consumeReceipt((first as { receiptToken: string }).receiptToken)
    expect(await answers.verifyClientGenerationGateInMain!({ challengeToken: pending.token, authenticatedClient: 'codex', answer: yes })).toEqual({ confirmed: false })
  })
})
