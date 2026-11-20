// 生成门主人那份只读结论（readApprovalDecision）的合同：重发等别处只读它，不自己判。
// 每一档都从真实的收据库走出来：等人、批了没用、用掉、过期（挑战 / 收据各一）、不认识；
// 策略放行（approveGateByPolicy）记的是策略、不是人；问人那一刻请求被取消，晚到的「是」不签。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { createApprovalReceiptAuthority } from './approvalReceipt'
import { approveGateByPolicy, createGenerationGateAnswers, readApprovalDecision } from './runOwnedGenerationGateAuthority'

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

describe('createGenerationGateAnswers · 问人这件事只在主人这里', () => {
  it('问着的时候请求被取消：当场答「没批」，晚到的「是」不签收据，挑战仍是等人', async () => {
    const { authority } = receiptsWithClock()
    const pending = challengeOf(authority, 'generation_submit:op-1:abort', 600_000)
    const asks: Array<(value: unknown) => void> = []
    const answers = createGenerationGateAnswers({
      receipts: authority,
      requestRendererDecision: () => new Promise((resolve) => { asks.push(resolve) }),
      rendererTargetIdentity: () => ({ webContentsId: 7, frameId: 1, origin: 'app://nomi' }),
    })
    const controller = new AbortController()
    const settled = answers.confirmInNomi({ challengeToken: pending.token }, { signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(asks).toHaveLength(1)

    controller.abort(new Error('client went away'))
    await expect(settled).resolves.toEqual({ confirmed: false, challengeId: pending.challenge.challengeId })
    asks[0]!({ confirmed: true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(readApprovalDecision(authority, { challengeToken: pending.token })).toEqual({ state: 'pending' })
  })

  it('外部客户端：只有 accept + confirm=true 才签；签过、花掉之后再答「是」不再放行', () => {
    const { authority } = receiptsWithClock()
    const pending = challengeOf(authority, 'generation_submit:op-1:client', 600_000)
    const answers = createGenerationGateAnswers({
      receipts: authority,
      requestRendererDecision: async () => ({ confirmed: false }),
      rendererTargetIdentity: () => null,
    })
    const yes = { action: 'accept', confirm: true }
    expect(answers.answerFromClient({ challengeToken: pending.token, client: 'codex', answer: { action: 'accept', confirm: 'true' } }))
      .toEqual({ confirmed: false })
    expect(answers.answerFromClient({ challengeToken: pending.token, client: '', answer: yes })).toEqual({ confirmed: false })

    const first = answers.answerFromClient({ challengeToken: pending.token, client: 'codex', answer: yes })
    expect(first).toMatchObject({ confirmed: true })
    expect(readApprovalDecision(authority, { challengeToken: pending.token })).toMatchObject({ state: 'approved-unused', decidedBy: 'human:elicitation' })

    authority.consumeReceipt((first as { receiptToken: string }).receiptToken)
    expect(answers.answerFromClient({ challengeToken: pending.token, client: 'codex', answer: yes })).toEqual({ confirmed: false })
  })
})
