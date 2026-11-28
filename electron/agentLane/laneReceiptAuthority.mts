import type { LaneSnapshot } from '../shared/agentLane/laneSnapshotTypes.js';
import type { CanvasWriteApprovalAuthority } from '../shared/agentCapabilities/transportContracts.js';
import { LANE_RECEIPT_AUTHORITY_NOTE, parseLaneReceiptAuthority, validLaneReceiptId } from '../shared/agentLane/laneReceiptAuthority.js';

/** Receipt correlation reads durable pi state, never the display projection or an authorization cache. */
export function findLaneReceiptAuthority(snapshot: Pick<LaneSnapshot, 'transcript' | 'queues'>, receiptProposalId: string): CanvasWriteApprovalAuthority | undefined {
  if (!validLaneReceiptId(receiptProposalId)) throw new Error('lane_receipt_authority_invalid');
  const entries = snapshot.transcript.flatMap((entry) => entry.type === 'custom' && entry.customType === LANE_RECEIPT_AUTHORITY_NOTE
    ? [{ entryId: entry.id, data: entry.data }] : []);
  // appendCustomEntry during before_tool is already durable, but joins the transcript only after the tool boundary.
  entries.push(...snapshot.queues.flatMap((entry) => entry.kind === 'write' && entry.type === 'custom'
    && entry.customType === LANE_RECEIPT_AUTHORITY_NOTE ? [{ entryId: entry.entryId, data: entry.data }] : []));
  const seen = new Map<string, string>();
  let found: CanvasWriteApprovalAuthority | undefined;
  for (const entry of entries) {
    if (!validLaneReceiptId(entry.entryId)) throw new Error('lane_receipt_authority_invalid');
    const authority = parseLaneReceiptAuthority(entry.data);
    const signature = JSON.stringify(authority);
    const previous = seen.get(entry.entryId);
    if (previous !== undefined) {
      if (previous !== signature) throw new Error('lane_receipt_authority_conflict');
      continue;
    }
    seen.set(entry.entryId, signature);
    if (authority.receiptProposalId !== receiptProposalId) continue;
    if (found) throw new Error('lane_receipt_authority_ambiguous');
    const { approvalId, actionHash } = authority;
    found = { receiptProposalId, approvalId, actionHash };
  }
  return found;
}
