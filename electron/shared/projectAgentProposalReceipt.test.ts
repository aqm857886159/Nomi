import { describe, expect, it } from "vitest";

import { parseProjectAgentCommittedProposal } from "./projectAgentProposalReceipt";

const legacyProposal = {
  proposalId: "receipt-a",
  summary: "updated one node",
  stepLabels: ["updated Shot A"],
  compensation: [{ kind: "restore-prompt", nodeId: "node-a", prompt: "old prompt" }],
  watchNodes: [{ nodeId: "node-a", title: "Shot A", prompt: "new prompt" }],
  reconciliationOk: true,
} as const;

describe("ProjectAgent committed proposal contract", () => {
  it("preserves legacy records but requires Host approval correlation as an exact pair", () => {
    expect(parseProjectAgentCommittedProposal(legacyProposal)).toEqual(legacyProposal);

    const correlated = {
      ...legacyProposal,
      hostApprovalId: "approval-a",
      hostActionHash: "a".repeat(64),
    };
    expect(parseProjectAgentCommittedProposal(correlated)).toEqual(correlated);
    expect(parseProjectAgentCommittedProposal({ ...legacyProposal, hostApprovalId: "approval-a" })).toBeNull();
    expect(parseProjectAgentCommittedProposal({ ...legacyProposal, hostActionHash: "a".repeat(64) })).toBeNull();
  });
});
