import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkbenchAiMessage } from "../../src/workbench/ai/workbenchAiTypes";
import { orderAssistantTimelineEntries } from "../../src/workbench/generationCanvas/components/assistantTimelineChronology";
import {
  hashProjectAgentCommittedProposal,
  createProjectAgentProposalReceiptService,
  projectAgentProposalReceiptPath,
} from "./projectAgentProposalReceiptStore";

const binding = {
  projectId: "receipt-project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
} as const;
const otherBinding = {
  projectId: "receipt-project-b",
  immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
  projectGeneration: 1,
} as const;
const proposal = {
  proposalId: "proposal-a",
  summary: "created one shot",
  stepLabels: ["created Shot A"],
  categoryCounts: [{ categoryId: "shots", label: "Shots", count: 1 }],
  compensation: [
    { kind: "disconnect-edges", pairs: [{ source: "node-a", target: "node-b" }] },
    { kind: "delete-nodes", nodeIds: ["node-a"] },
  ],
  watchNodes: [{ nodeId: "node-a", title: "Shot A", prompt: "wide shot" }],
  reconciliationOk: false,
  anchorMessageId: "assistant-a",
  anchorTextOffset: 12,
} as const;

let root = "";

function tempProject(): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-receipt-"));
  fs.mkdirSync(path.join(root, ".nomi"), { recursive: true });
  return root;
}

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("ProjectAgent committed proposal receipt", () => {
  it("survives a real disk write and process-style reader recreation with its rendered chronology intact", () => {
    const projectRoot = tempProject();
    const writer = createProjectAgentProposalReceiptService({ projectRoot, binding });
    const prepared = writer.write({
      expectedRevision: 0,
      proposalId: proposal.proposalId,
      operationId: "prepare-proposal-a",
      lifecycle: "preparing",
      proposal,
    });
    const committed = writer.write({
      expectedRevision: prepared.revision,
      proposalId: proposal.proposalId,
      operationId: "commit-proposal-a",
      lifecycle: "committed",
      proposal,
    });
    expect(committed).toMatchObject({ revision: 2, lifecycle: "committed", proposalId: proposal.proposalId, proposal });

    const restored = createProjectAgentProposalReceiptService({ projectRoot, binding }).read();
    expect(restored).toEqual(committed);

    const messages: WorkbenchAiMessage[] = [
      {
        id: "assistant-a",
        role: "assistant",
        content: "Before tool. After tool.",
        status: "done",
      },
    ];
    expect(
      orderAssistantTimelineEntries(messages, [{ key: "restored-receipt", ...restored!.proposal }]).map((entry) =>
        entry.kind === "message" ? `text:${entry.content}` : entry.key,
      ),
    ).toEqual(["text:Before tool.", "restored-receipt", "text: After tool."]);
  });

  it("rejects malformed live writes and fails closed after disk tampering", () => {
    const projectRoot = tempProject();
    const service = createProjectAgentProposalReceiptService({ projectRoot, binding });

    expect(() =>
      service.write({
        expectedRevision: 0,
        proposalId: proposal.proposalId,
        operationId: "invalid-proposal",
        lifecycle: "preparing",
        proposal: { ...proposal, anchorTextOffset: -1 },
      }),
    ).toThrow("invalid");
    expect(fs.existsSync(projectAgentProposalReceiptPath(projectRoot))).toBe(false);

    service.write({
      expectedRevision: 0,
      proposalId: proposal.proposalId,
      operationId: "prepare-proposal-a",
      lifecycle: "preparing",
      proposal,
    });
    const raw = JSON.parse(fs.readFileSync(projectAgentProposalReceiptPath(projectRoot), "utf8")) as Record<
      string,
      unknown
    >;
    fs.writeFileSync(
      projectAgentProposalReceiptPath(projectRoot),
      JSON.stringify({
        ...raw,
        proposal: { ...(raw.proposal as object), compensation: [{ kind: "delete-nodes", nodeIds: [42] }] },
      }),
      "utf8",
    );
    expect(() => createProjectAgentProposalReceiptService({ projectRoot, binding }).read()).toThrow("invalid");
  });

  it("enforces revision, proposal, operation, and binding CAS with exact idempotent retries", () => {
    const projectRoot = tempProject();
    const first = createProjectAgentProposalReceiptService({ projectRoot, binding });
    const second = createProjectAgentProposalReceiptService({ projectRoot, binding });
    const prepare = {
      expectedRevision: 0,
      proposalId: proposal.proposalId,
      operationId: "prepare-proposal-a",
      lifecycle: "preparing" as const,
      proposal,
    };
    const prepared = first.write(prepare);
    expect(prepared).toMatchObject({ revision: 1, lifecycle: "preparing", operationId: prepare.operationId });
    expect(first.write(prepare)).toEqual(prepared);
    expect(() => first.write({ ...prepare, proposal: { ...proposal, summary: "different" } })).toThrow("operation");
    expect(() => second.write({ ...prepare, operationId: "stale-second-subscription" })).toThrow("revision_conflict");

    const committed = first.write({
      expectedRevision: 1,
      proposalId: proposal.proposalId,
      operationId: "commit-proposal-a",
      lifecycle: "committed",
      proposal,
    });
    expect(committed).toMatchObject({ revision: 2, lifecycle: "committed" });
    expect(
      first.write({
        expectedRevision: 1,
        proposalId: proposal.proposalId,
        operationId: "commit-proposal-a",
        lifecycle: "committed",
        proposal,
      }),
    ).toEqual(committed);

    const undoing = first.transition({
      expectedRevision: 2,
      proposalId: proposal.proposalId,
      operationId: "undo-proposal-a",
      lifecycle: "undoing",
    });
    expect(undoing).toMatchObject({ revision: 3, lifecycle: "undoing", proposal });
    expect(
      first.transition({
        expectedRevision: 2,
        proposalId: proposal.proposalId,
        operationId: "undo-proposal-a",
        lifecycle: "undoing",
      }),
    ).toEqual(undoing);
    const undone = first.transition({
      expectedRevision: 3,
      proposalId: proposal.proposalId,
      operationId: "complete-undo-proposal-a",
      lifecycle: "undone",
    });
    expect(undone).toMatchObject({ revision: 4, lifecycle: "undone" });

    expect(() =>
      createProjectAgentProposalReceiptService({ projectRoot, binding: otherBinding }).write({
        ...prepare,
        expectedRevision: 4,
        operationId: "cross-project-overwrite",
      }),
    ).toThrow("binding");
    const clearProposalA = {
      expectedRevision: 4,
      proposalId: proposal.proposalId,
      operationId: "clear-proposal-a",
    };
    expect(first.clear(clearProposalA)).toMatchObject({ cleared: true, receipt: { revision: 5, lifecycle: "undone" } });

    const proposalB = { ...proposal, proposalId: "proposal-b" };
    first.write({
      expectedRevision: 5,
      proposalId: proposalB.proposalId,
      operationId: "prepare-proposal-b",
      lifecycle: "preparing",
      proposal: proposalB,
    });
    first.write({
      expectedRevision: 6,
      proposalId: proposalB.proposalId,
      operationId: "commit-proposal-b",
      lifecycle: "committed",
      proposal: proposalB,
    });
    expect(() => first.clear(clearProposalA)).toThrow("revision_conflict");
    expect(first.read()).toMatchObject({ revision: 7, proposalId: proposalB.proposalId, lifecycle: "committed" });
  });

  it("keeps Host approval correlation immutable from preparation through commit", () => {
    const service = createProjectAgentProposalReceiptService({ projectRoot: tempProject(), binding });
    const correlated = {
      ...proposal,
      proposalId: "receipt-host-a",
      hostApprovalId: "approval-host-a",
      hostActionHash: "a".repeat(64),
    };
    service.write({
      expectedRevision: 0,
      proposalId: correlated.proposalId,
      operationId: "host-prepare",
      lifecycle: "preparing",
      proposal: correlated,
    });

    expect(() =>
      service.write({
        expectedRevision: 1,
        proposalId: correlated.proposalId,
        operationId: "forged-host-commit",
        lifecycle: "committed",
        proposal: { ...correlated, hostApprovalId: "approval-forged" },
      }),
    ).toThrow("correlation");
    expect(() =>
      service.write({
        expectedRevision: 1,
        proposalId: correlated.proposalId,
        operationId: "forged-action-commit",
        lifecycle: "committed",
        proposal: { ...correlated, hostActionHash: "b".repeat(64) },
      }),
    ).toThrow("correlation");
    expect(hashProjectAgentCommittedProposal(correlated)).not.toBe(
      hashProjectAgentCommittedProposal({ ...correlated, hostActionHash: "b".repeat(64) }),
    );
    expect(
      service.write({
        expectedRevision: 1,
        proposalId: correlated.proposalId,
        operationId: "host-commit",
        lifecycle: "committed",
        proposal: correlated,
      }),
    ).toMatchObject({ lifecycle: "committed", proposal: correlated });
  });
});
