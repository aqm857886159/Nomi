import type { ProjectAgentProposalReceiptTransition, ProjectAgentProposalReceiptWrite, ProjectAgentProposalReceiptView } from '../../../../electron/shared/projectAgentProposalReceipt'
import type { LaneReceiptCommand } from '../../../../electron/shared/agentLane/laneDesktopContracts'
import { laneClient } from './laneClient'
import { LaneCommandFailure } from './laneCommandFailure'

async function receipt(subscriptionId: string, command: LaneReceiptCommand): Promise<ProjectAgentProposalReceiptView | null> {
  const result = await laneClient.receipt(subscriptionId, command)
  if (!result.ok) throw new LaneCommandFailure(result.code, result.diagnostic)
  if (!('receipt' in result)) throw new Error('project_agent_receipt_invalid')
  return result.receipt ?? null
}
async function requireReceipt(subscriptionId: string, command: LaneReceiptCommand): Promise<ProjectAgentProposalReceiptView> {
  const result = await receipt(subscriptionId, command)
  if (!result) throw new Error('project_agent_receipt_invalid')
  return result
}
export const laneReceiptClient = {
  readProposalReceipt: (subscriptionId: string) => receipt(subscriptionId, { kind: 'receipt-read' }),
  writeProposalReceipt: (subscriptionId: string, input: ProjectAgentProposalReceiptWrite) => requireReceipt(subscriptionId, { kind: 'receipt-write', input }),
  transitionProposalReceipt: (subscriptionId: string, input: ProjectAgentProposalReceiptTransition) => requireReceipt(subscriptionId, { kind: 'receipt-transition', input }),
}
