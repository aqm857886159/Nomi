import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-approval-runtime-'))
vi.mock('electron', () => ({ app: { getPath: () => root, getAppPath: () => process.cwd() } }))
vi.mock('./security', () => ({
  capabilityCoreDir: () => root,
  ensureCapabilitySigningKey: (kind: string) => `isolated-${kind}`,
}))
import { getApprovalReceiptAuthority, resetApprovalReceiptAuthorityForTests } from './approvalReceiptRuntime'
import { createGenerationGateAnswers } from './runOwnedGenerationGateAuthority'

afterAll(() => { resetApprovalReceiptAuthorityForTests(); fs.rmSync(root, { recursive: true, force: true }) })

describe('生产装配只交出读/核销面', () => {
  it('拆字符串、Reflect、展开都取不到签发；主人仍能正常确认签出可核销的收据', async () => {
    const receipts = getApprovalReceiptAuthority()
    const pending = receipts.requestChallenge({
      challengeKey: 'runtime-gate', immutableProjectUuid: 'uuid', projectGeneration: 1, projectId: 'p',
      runId: 'r', gateId: 'g', contractHash: 'd', targetHash: 'd', projectRevision: 2,
      costScope: 'generation_submit', pricingSnapshotHash: 'd', reservationPreview: { currency: 'CNY', maximum: 1 },
      display: { model: 'fixture' },
    })
    expect(Reflect.has(receipts, 'reader')).toBe(false)
    const key = 'mint' + 'Receipt'
    for (const name of [key, 'issueDecisionReceipt', 'createMainProcessGestureAttestation', 'createClientElicitationAttestation', 'createPolicyDecisionAttestation']) {
      expect(Reflect.get(receipts, name)).toBeUndefined()
      expect(Reflect.get({ ...receipts }, name)).toBeUndefined()
    }
    expect(() => Reflect.get(receipts, key)(pending.token, {})).toThrow(TypeError)
    expect(getApprovalReceiptAuthority()).toBe(receipts)
    const owner = createGenerationGateAnswers({
      receipts, requestRendererDecision: async () => ({ confirmed: true }),
      rendererTargetIdentity: () => ({ webContentsId: 7, frameId: 1, origin: 'app://nomi' }),
    })
    const answer = await owner.confirmInNomi({ challengeToken: pending.token })
    expect(answer.confirmed).toBe(true)
    expect(receipts.verifyReceipt(answer.receiptToken!).decidedBy).toBe('human:gesture')
    expect(receipts.consumeReceipt(answer.receiptToken!).replayed).toBe(false)
  })
})
