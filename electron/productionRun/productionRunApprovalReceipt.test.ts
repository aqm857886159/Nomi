import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApprovalReceiptAuthority, ReceiptScopeError } from '../capabilityCore/approvalReceipt'
import { approvalReceiptForGate, assertCurrentProjectRevision } from './productionRunApprovalReceipt'
import type { RunCommand } from './productionRunTypes'

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
  const command = (payload: Record<string, unknown>): RunCommand => ({
    commandId: 'scope-command',
    expectedRevision: 2,
    type: 'gate.decide',
    payload: { gateId: 'gate-1', status: 'approved', receiptId: minted.receipt.receiptId, ...payload },
    issuedAt: now,
  })
  return { authority, receiptId: minted.receipt.receiptId, command }
}

describe('production approval receipt scope', () => {
  it('accepts the current safe project revision and returns it to the caller', () => {
    expect(assertCurrentProjectRevision('project-1', 2, () => 2)).toBe(2)
  })

  it.each([
    ['missing resolver', undefined, () => undefined],
    ['non-safe current revision', 2, () => Number.MAX_SAFE_INTEGER + 1],
    ['non-safe expected revision', Number.MAX_SAFE_INTEGER + 1, () => 2],
    ['different revision', 2, () => 3],
  ] as const)('rejects %s before a receipt can cross the scope boundary', (_label, expected, resolver) => {
    expect(() => assertCurrentProjectRevision('project-1', expected, resolver)).toThrowError(ReceiptScopeError)
  })

  it('returns no receipt for non-gate commands or without a receipt authority', () => {
    const { command } = fixture()
    expect(approvalReceiptForGate(undefined, 'project-1', 'run-1', command({}), () => 2)).toBeUndefined()
    expect(approvalReceiptForGate({} as never, 'project-1', 'run-1', { ...command({}), type: 'run.control' } as never, () => 2)).toBeUndefined()
  })

  it('rejects a gate approval without a receipt at the production command boundary', () => {
    const { authority, command } = fixture()
    expect(() => approvalReceiptForGate(authority, 'project-1', 'run-1', command({ receiptId: undefined }), () => 2))
      .toThrowError(expect.objectContaining({ code: 'human_approval_required' }))
  })

  it('verifies and returns a valid receipt using its signed token and current revision', () => {
    const { authority, receiptId, command } = fixture()
    const result = approvalReceiptForGate(authority, 'project-1', 'run-1', command({}), () => 2)
    expect(result).toMatchObject({ receipt: { receiptId, projectId: 'project-1', projectRevision: 2 } })
    expect(result?.token).toEqual(expect.any(String))
  })

  it('accepts a supplied receipt token and rejects a conflicting receipt id', () => {
    const { authority, receiptId, command } = fixture()
    const token = authority.resolveReceiptToken(receiptId)
    const result = approvalReceiptForGate(authority, 'project-1', 'run-1', command({ receiptId: undefined, receiptToken: token }), () => 2)
    expect(result).toMatchObject({ receipt: { receiptId } })
    expect(() => approvalReceiptForGate(authority, 'project-1', 'run-1', command({ receiptId: 'receipt-other', receiptToken: token }), () => 2))
      .toThrowError(expect.objectContaining({ code: 'receipt_invalid', message: 'Approval receipt id is invalid' }))
  })

  it('requires a revision resolver at the command boundary even for a signed receipt', () => {
    const { authority, command } = fixture()
    expect(() => approvalReceiptForGate(authority, 'project-1', 'run-1', command({}), undefined))
      .toThrowError(expect.objectContaining({ code: 'receipt_invalid' }))
  })

  it('maps an unexpected receipt decoder failure to receipt_invalid', () => {
    const { command } = fixture()
    const authority = {
      resolveReceiptToken: vi.fn(() => 'bad-token'),
      verifyReceipt: vi.fn(() => { throw new Error('sealed receipt cannot be decoded') }),
    }
    expect(() => approvalReceiptForGate(authority as never, 'project-1', 'run-1', command({}), () => 2))
      .toThrowError(expect.objectContaining({ code: 'receipt_invalid', message: 'sealed receipt cannot be decoded' }))
  })

  it('maps a non-Error receipt decoder failure to the generic receipt_invalid contract', () => {
    const { command } = fixture()
    const authority = {
      resolveReceiptToken: vi.fn(() => 'bad-token'),
      verifyReceipt: vi.fn(() => { throw 'malformed' }),
    }
    expect(() => approvalReceiptForGate(authority as never, 'project-1', 'run-1', command({}), () => 2))
      .toThrowError(expect.objectContaining({ code: 'receipt_invalid', message: 'Approval receipt is invalid' }))
  })

  it('rejects an explicitly stale command revision even when the signed receipt is current', () => {
    const { authority, command } = fixture()
    expect(() => approvalReceiptForGate(authority, 'project-1', 'run-1', command({ projectRevision: 3 }), () => 2))
      .toThrowError(expect.objectContaining({ code: 'receipt_invalid' }))
  })
})
