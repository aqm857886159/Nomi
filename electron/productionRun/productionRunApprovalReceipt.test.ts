import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApprovalReceiptAuthority, ReceiptScopeError } from '../capabilityCore/approvalReceipt'
import { createGateApprovalOwner, assertCurrentProjectRevision } from './productionRunApprovalReceipt'
import type { ProductionGate, ProductionRun, RunCommand } from './productionRunTypes'

const roots: string[] = []
const now = '2026-08-23T00:00:00.000Z'

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-approval-receipt-scope-'))
  roots.push(root)
  const authority = createApprovalReceiptAuthority({
    filePath: path.join(root, 'receipts.json'),
    macKey: 'scope-receipt-key',
    storeMacKey: 'scope-receipt-store-key',
    keyId: 'scope-receipt-v1',
    now: () => now,
    randomId: (() => { let i = 0; return () => `scope-receipt-${++i}` })(),
  })
  const challenge = authority.requestChallenge({
    challengeKey: 'run-1:gate-1:revision-2',
    immutableProjectUuid: 'uuid-1',
    projectGeneration: 1,
    projectId: 'project-1',
    runId: 'run-1',
    gateId: 'gate-1',
    contractHash: 'digest-1',
    targetHash: 'digest-1',
    projectRevision: 2,
    costScope: 'generation_submit',
    pricingSnapshotHash: 'digest-1',
    reservationPreview: { currency: 'CNY', maximum: 5 },
  })
  const attestation = authority.createMainProcessGestureAttestation(challenge.token, {
    webContentsId: 1,
    frameId: 1,
    origin: 'app://nomi',
    decision: 'accept',
  })
  const minted = authority.mintReceipt(challenge.token, attestation)
  const command = (payload: Record<string, unknown>, extra: Partial<RunCommand> = {}): RunCommand => ({
    commandId: 'scope-command',
    expectedRevision: 2,
    type: 'gate.decide',
    payload: { gateId: 'gate-1', status: 'approved', receiptId: minted.receipt.receiptId, ...payload },
    issuedAt: now,
    ...extra,
  })
  return { authority, receiptId: minted.receipt.receiptId, command }
}

function gate(gateId: string, scope: ProductionGate['scope']): ProductionGate {
  return {
    gateId,
    scope,
    status: 'waiting',
    planHash: 'digest-1',
    jobIds: ['job-1'],
    title: gateId,
    summary: gateId,
    createdAt: now,
    expiresAt: '2026-08-24T00:00:00.000Z',
  }
}

/** gate-1 = 付费门（预算门），gate-free = 免费创意门。付费与否只看 scope，见 isSpendGate。 */
const run = {
  gates: [gate('gate-1', 'budget_envelope'), gate('gate-free', 'stage')],
} as unknown as ProductionRun

const owner = (authority: unknown, resolver: ((projectId: string) => number | undefined) | undefined = () => 2) =>
  createGateApprovalOwner(authority as never, resolver)


describe('production approval receipt scope', () => {
  it('accepts the current safe project revision and returns it to the caller', () => {
    expect(assertCurrentProjectRevision('project-1', 2, () => 2)).toBe(2)
  })

  it.each([
    ['missing resolver', undefined, (): undefined => undefined],
    ['non-safe current revision', 2, () => Number.MAX_SAFE_INTEGER + 1],
    ['non-safe expected revision', Number.MAX_SAFE_INTEGER + 1, (): number => 2],
    ['different revision', 2, (): number => 3],
  ] as const)('rejects %s before a receipt can cross the scope boundary', (_label, expected, resolver) => {
    expect(() => assertCurrentProjectRevision('project-1', expected, resolver)).toThrowError(ReceiptScopeError)
  })

  it('returns no receipt for non-gate commands', () => {
    const { command } = fixture()
    expect(owner({}).verifyGateDecision('project-1', 'run-1', run, { ...command({}), type: 'run.control' })).toBeUndefined()
  })

  // 2026-09-10 根因回归闸：生产装配从没注入过收据权威，旧实现在权威缺席时返回 undefined，
  // productionRunService 便原样放行 gate.decide——付费门 fail-open。缺权威必须**拒绝**，不是跳过。
  it('rejects a paid gate decision when no receipt authority is assembled', () => {
    const { command } = fixture()
    expect(() => owner(undefined).verifyGateDecision('project-1', 'run-1', run, command({})))
      .toThrowError(expect.objectContaining({ code: 'human_approval_required' }))
    expect(() => owner(undefined).verifyGateDecision('project-1', 'run-1', run, command({ receiptId: undefined })))
      .toThrowError(expect.objectContaining({ code: 'human_approval_required' }))
    expect(() => owner(undefined).duplicateGateDecisionFor('project-1', 'run-1', {
      ...run, gates: run.gates.map((item) => ({ ...item, status: 'approved' as const })),
    }, command({}))).toThrowError(expect.objectContaining({ code: 'human_approval_required' }))
  })

  // 免费门（创意门/定妆检查点/导出）不进收据制：MCP 客户端经 elicitation 表态的可逆门必须照常通过。
  it('keeps free gates and rejections receipt-free', () => {
    const { authority, command } = fixture()
    expect(owner(authority).verifyGateDecision('project-1', 'run-1', run,
      command({ gateId: 'gate-free', receiptId: undefined }))).toBeUndefined()
    expect(owner(undefined).verifyGateDecision('project-1', 'run-1', run,
      command({ gateId: 'gate-free', receiptId: undefined }))).toBeUndefined()
    expect(owner(undefined).verifyGateDecision('project-1', 'run-1', run,
      command({ status: 'rejected', receiptId: undefined }))).toBeUndefined()
  })

  // 渲染层 IPC 过了 assertTrustedSender 后自己盖的真人手势章：Nomi 窗口里的确认卡照常批得动付费门。
  it('accepts the trusted in-app human gesture on a paid gate without a receipt', () => {
    const { command } = fixture()
    expect(owner(undefined).verifyGateDecision('project-1', 'run-1', run,
      command({ receiptId: undefined }, { humanGesture: true }))).toBeUndefined()
  })

  it('rejects a gate approval without a receipt at the production command boundary', () => {
    const { authority, command } = fixture()
    expect(() => owner(authority).verifyGateDecision('project-1', 'run-1', run, command({ receiptId: undefined })))
      .toThrowError(expect.objectContaining({ code: 'human_approval_required' }))
  })

  it('verifies and returns a valid receipt using its signed token and current revision', () => {
    const { authority, receiptId, command } = fixture()
    const result = owner(authority).verifyGateDecision('project-1', 'run-1', run, command({}))
    expect(result).toMatchObject({ receipt: { receiptId, projectId: 'project-1', projectRevision: 2 } })
    expect(result?.token).toEqual(expect.any(String))
  })

  it('accepts a supplied receipt token and rejects a conflicting receipt id', () => {
    const { authority, receiptId, command } = fixture()
    const token = authority.resolveReceiptToken(receiptId)
    const result = owner(authority).verifyGateDecision('project-1', 'run-1', run, command({ receiptId: undefined, receiptToken: token }))
    expect(result).toMatchObject({ receipt: { receiptId } })
    expect(() => owner(authority).verifyGateDecision('project-1', 'run-1', run, command({ receiptId: 'receipt-other', receiptToken: token })))
      .toThrowError(expect.objectContaining({ code: 'receipt_invalid', message: 'Approval receipt id is invalid' }))
  })

  it('requires a revision resolver at the command boundary even for a signed receipt', () => {
    const { authority, command } = fixture()
    expect(() => createGateApprovalOwner(authority, undefined).verifyGateDecision('project-1', 'run-1', run, command({})))
      .toThrowError(expect.objectContaining({ code: 'receipt_invalid' }))
  })

  it('maps an unexpected receipt decoder failure to receipt_invalid', () => {
    const { command } = fixture()
    const authority = {
      resolveReceiptToken: vi.fn(() => 'bad-token'),
      verifyReceipt: vi.fn(() => { throw new Error('sealed receipt cannot be decoded') }),
    }
    expect(() => owner(authority).verifyGateDecision('project-1', 'run-1', run, command({})))
      .toThrowError(expect.objectContaining({ code: 'receipt_invalid', message: 'sealed receipt cannot be decoded' }))
  })

  it('maps a non-Error receipt decoder failure to the generic receipt_invalid contract', () => {
    const { command } = fixture()
    const authority = {
      resolveReceiptToken: vi.fn(() => 'bad-token'),
      verifyReceipt: vi.fn(() => { throw 'malformed' }),
    }
    expect(() => owner(authority).verifyGateDecision('project-1', 'run-1', run, command({})))
      .toThrowError(expect.objectContaining({ code: 'receipt_invalid', message: 'Approval receipt is invalid' }))
  })

  it('rejects an explicitly stale command revision even when the signed receipt is current', () => {
    const { authority, command } = fixture()
    expect(() => owner(authority).verifyGateDecision('project-1', 'run-1', run, command({ projectRevision: 3 })))
      .toThrowError(expect.objectContaining({ code: 'receipt_invalid' }))
  })
})
