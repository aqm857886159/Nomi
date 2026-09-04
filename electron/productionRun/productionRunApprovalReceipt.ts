import {
  HumanApprovalRequiredError,
  ReceiptExpiredError,
  ReceiptScopeError,
  type ApprovalReceiptAuthority,
  type HumanApprovalReceiptV1,
} from '../capabilityCore/approvalReceipt'
import type { RunCommand } from './productionRunTypes'

export type ProjectRevisionResolver = (projectId: string) => number | undefined

/** A receipt is only usable while the project document it describes is current. */
export function assertCurrentProjectRevision(
  projectId: string,
  expectedProjectRevision: unknown,
  projectRevisionResolver: ProjectRevisionResolver | undefined,
): number {
  const currentProjectRevision = projectRevisionResolver?.(projectId)
  if (typeof currentProjectRevision !== 'number' || !Number.isSafeInteger(currentProjectRevision)
    || !Number.isSafeInteger(expectedProjectRevision)
    || currentProjectRevision !== expectedProjectRevision) {
    throw new ReceiptScopeError('Approval receipt project revision does not match the current project')
  }
  return currentProjectRevision
}

export function approvalReceiptForGate(
  authority: ApprovalReceiptAuthority | undefined,
  projectId: string,
  runId: string,
  command: RunCommand,
  projectRevisionResolver?: ProjectRevisionResolver,
): { token: string; receipt: HumanApprovalReceiptV1 } | undefined {
  if (!authority || command.type !== 'gate.decide') return undefined
  const receiptId = typeof command.payload.receiptId === 'string' ? command.payload.receiptId.trim() : ''
  const suppliedToken = typeof command.payload.receiptToken === 'string' ? command.payload.receiptToken.trim() : ''
  if (!receiptId && !suppliedToken) throw new HumanApprovalRequiredError()
  try {
    const token = suppliedToken || authority.resolveReceiptToken(receiptId)
    const receipt = authority.verifyReceipt(token)
    const projectRevision = assertCurrentProjectRevision(projectId, command.payload.projectRevision ?? receipt.projectRevision, projectRevisionResolver)
    const expected: Array<[keyof HumanApprovalReceiptV1, unknown]> = [
      ['projectId', projectId],
      ['runId', runId],
      ['gateId', command.payload.gateId],
      ['contractHash', command.payload.contractHash],
      ['targetHash', command.payload.targetHash],
      ['projectRevision', projectRevision],
    ]
    for (const [key, value] of expected) {
      if (value !== undefined && value !== null && String(receipt[key]) !== String(value)) {
        throw new ReceiptScopeError('Approval receipt ' + String(key) + ' does not match the current run')
      }
    }
    if (receiptId && receipt.receiptId !== receiptId) throw new ReceiptScopeError('Approval receipt id is invalid')
    return { token, receipt }
  } catch (error) {
    if (error instanceof HumanApprovalRequiredError || error instanceof ReceiptScopeError || error instanceof ReceiptExpiredError) throw error
    throw new ReceiptScopeError(error instanceof Error ? error.message : 'Approval receipt is invalid')
  }
}
