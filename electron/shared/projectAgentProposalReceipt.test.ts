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

it("retains prompt ownership in compensation while accepting old receipts", () => {
  const parsed = parseProjectAgentCommittedProposal({ ...legacyProposal, compensation: [{ kind: "restore-prompt", nodeId: "node-a", prompt: "old", promptOverridden: false }] });
  expect(parsed?.compensation[0]).toEqual({ kind: "restore-prompt", nodeId: "node-a", prompt: "old", promptOverridden: false });
  expect(parseProjectAgentCommittedProposal({ ...legacyProposal, compensation: [{ kind: "restore-prompt", nodeId: "node-a", prompt: "old", promptOverridden: "false" }] })).toBeNull();
});

it("keeps a whole-node field restore (3D-BOX plan revisions and preview attachment) and rejects a malformed one", () => {
  const meta = { directorPlan: { revision: "dplan-0123456789abcdef", plan: { shots: [{ id: "a", window: [0, 3] }] } }, referenceVideoUrls: ["nomi-local://asset/p/v.mp4"] };
  const parsed = parseProjectAgentCommittedProposal({ ...legacyProposal, compensation: [{ kind: "restore-node-fields", nodeId: "node-a", meta, prompt: "" }] });
  expect(parsed?.compensation[0]).toEqual({ kind: "restore-node-fields", nodeId: "node-a", meta, prompt: "" });
  expect(parseProjectAgentCommittedProposal({ ...legacyProposal, compensation: [{ kind: "restore-node-fields", nodeId: "node-a", meta: [], prompt: "" }] })).toBeNull();
  expect(parseProjectAgentCommittedProposal({ ...legacyProposal, compensation: [{ kind: "restore-node-fields", nodeId: "node-a", meta, prompt: "", extra: 1 }] })).toBeNull();
});
