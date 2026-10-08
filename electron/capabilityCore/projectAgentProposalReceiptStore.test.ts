import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  hashProjectAgentCommittedProposal,
  createProjectAgentProposalReceiptService,
  migrateProjectAgentProposalReceipt,
  projectAgentProposalReceiptPath,
  PROJECT_AGENT_PREPARING_DEADLINE_MS,
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

const publishedReceiptFixturesDir = path.join(process.cwd(), "electron", "capabilityCore", "__fixtures__", "published-receipts");
const publishedReceiptFixtureFiles = fs
  .readdirSync(publishedReceiptFixturesDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

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
  it("survives a real disk write and process-style reader recreation with its render anchor intact", () => {
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

    // Host 的职责是把「这张回执挂在哪条助手消息的第几个字」原样持久化下来;真正的分段渲染
    // 属渲染层。故这里只断言锚点跨进程往返后逐字节不变、且仍是该消息内容里的合法切点。
    const anchoredContent = "Before tool. After tool.";
    expect(restored!.proposal).toMatchObject({
      anchorMessageId: proposal.anchorMessageId,
      anchorTextOffset: proposal.anchorTextOffset,
    });
    expect(Number.isInteger(restored!.proposal.anchorTextOffset)).toBe(true);
    expect(restored!.proposal.anchorTextOffset).toBeLessThanOrEqual(anchoredContent.length);
    expect(anchoredContent.slice(0, restored!.proposal.anchorTextOffset)).toBe("Before tool.");
  });

  it("quarantines malformed disk state and lets the project continue without a receipt", () => {
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
    expect(createProjectAgentProposalReceiptService({ projectRoot, binding }).read()).toBeNull();
    expect(fs.existsSync(projectAgentProposalReceiptPath(projectRoot))).toBe(false);
    expect(
      fs.readdirSync(path.dirname(projectAgentProposalReceiptPath(projectRoot))).some((name) =>
        name.startsWith("project-agent-proposal-receipt.json.quarantined-"),
      ),
    ).toBe(true);
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

    const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-receipt-foreign-"));
    fs.mkdirSync(path.join(foreignRoot, ".nomi"), { recursive: true });
    fs.copyFileSync(projectAgentProposalReceiptPath(projectRoot), projectAgentProposalReceiptPath(foreignRoot));
    expect(() =>
      createProjectAgentProposalReceiptService({ projectRoot: foreignRoot, binding: otherBinding }).write({
        ...prepare,
        expectedRevision: 4,
        operationId: "cross-project-overwrite",
      }),
    ).toThrow("revision_conflict");
    fs.rmSync(foreignRoot, { recursive: true, force: true });
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

describe("receipt read boundary recovery", () => {
  it.each(publishedReceiptFixtureFiles)("reads or isolates published receipt format %s", (fixtureName) => {
    const projectRoot = tempProject();
    const fixture = JSON.parse(fs.readFileSync(path.join(publishedReceiptFixturesDir, fixtureName), "utf8")) as Record<string, unknown>;
    const isPreJournalSchema2 =
      fixture.schemaVersion === 2 &&
      fixture.proposalHash === undefined &&
      fixture.operations === undefined &&
      fixture.journalHash === undefined;
    fs.writeFileSync(projectAgentProposalReceiptPath(projectRoot), JSON.stringify(fixture), "utf8");

    expect(() => createProjectAgentProposalReceiptService({ projectRoot, binding }).read()).not.toThrow();
    const restored = createProjectAgentProposalReceiptService({ projectRoot, binding }).read();
    if (restored) {
      expect(restored.lifecycle).toBe("committed");
      expect(restored.proposal).toEqual(proposal);
    } else {
      expect(isPreJournalSchema2).toBe(false);
      expect(fs.existsSync(projectAgentProposalReceiptPath(projectRoot))).toBe(false);
      expect(
        fs.readdirSync(path.dirname(projectAgentProposalReceiptPath(projectRoot))).some((name) =>
          name.startsWith("project-agent-proposal-receipt.json.quarantined-"),
        ),
      ).toBe(true);
    }
  });

  it("archives the current package release in the published-format matrix", () => {
    const packageVersion = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string }).version;
    expect(publishedReceiptFixtureFiles).toContain(`v${packageVersion}.json`);
  });

  it("migrates the pre-journal shape with a pure, idempotent function and persists schema 2 on read", () => {
    const projectRoot = tempProject();
    const legacy = {
      schemaVersion: 1,
      binding,
      revision: 1,
      lifecycle: "committed",
      proposalId: proposal.proposalId,
      operationId: "legacy-commit",
      proposal,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const migrated = migrateProjectAgentProposalReceipt(legacy);
    expect(migrated).toMatchObject({ schemaVersion: 2, lifecycle: "committed", proposal });
    expect(migrateProjectAgentProposalReceipt(legacy)).toEqual(migrated);
    fs.writeFileSync(projectAgentProposalReceiptPath(projectRoot), JSON.stringify(legacy), "utf8");
    const restored = createProjectAgentProposalReceiptService({ projectRoot, binding }).read();
    expect(restored).toMatchObject({ lifecycle: "committed", proposal });
    const persisted = JSON.parse(fs.readFileSync(projectAgentProposalReceiptPath(projectRoot), "utf8"));
    expect(persisted.schemaVersion).toBe(2);
    expect(persisted.journalHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["bad-json", "{not-json", "invalid-json"],
    ["truncated-jsonl", '{"schemaVersion":2}\n{"lifecycle":"preparing"', "truncated-jsonl"],
  ])("quarantines %s with its reason code", (_name, contents, _reason) => {
    const projectRoot = tempProject();
    fs.writeFileSync(projectAgentProposalReceiptPath(projectRoot), contents, "utf8");
    expect(createProjectAgentProposalReceiptService({ projectRoot, binding }).read()).toBeNull();
    expect(fs.existsSync(projectAgentProposalReceiptPath(projectRoot))).toBe(false);
  });

  it("quarantines a receipt bound to another project and leaves a second project readable", () => {
    const firstRoot = tempProject();
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-receipt-second-"));
    fs.mkdirSync(path.join(secondRoot, ".nomi"), { recursive: true });
    const writer = createProjectAgentProposalReceiptService({ projectRoot: firstRoot, binding });
    writer.write({ expectedRevision: 0, proposalId: proposal.proposalId, operationId: "prepare-a", lifecycle: "preparing", proposal });
    fs.copyFileSync(projectAgentProposalReceiptPath(firstRoot), projectAgentProposalReceiptPath(secondRoot));
    expect(createProjectAgentProposalReceiptService({ projectRoot: secondRoot, binding: otherBinding }).read()).toBeNull();
    expect(createProjectAgentProposalReceiptService({ projectRoot: firstRoot, binding }).read()).toMatchObject({ proposalId: proposal.proposalId });
    fs.rmSync(secondRoot, { recursive: true, force: true });
  });
});

describe("a preparing receipt has an owner-set deadline and then a terminal state", () => {
  const second = { ...proposal, proposalId: "proposal-b" }
  const stuck = (projectRoot: string, clock: { now: number }) => {
    const service = createProjectAgentProposalReceiptService({ projectRoot, binding, now: () => clock.now })
    const prepared = service.write({ expectedRevision: 0, proposalId: proposal.proposalId, operationId: "prepare-a", lifecycle: "preparing", proposal })
    return { service, prepared }
  }

  it("inside the deadline a new write is still refused — and says when the old one settles and what to do", () => {
    const clock = { now: Date.parse("2026-09-30T10:00:00Z") }
    const { service, prepared } = stuck(tempProject(), clock)
    clock.now += PROJECT_AGENT_PREPARING_DEADLINE_MS - 1_000
    expect(() => service.write({ expectedRevision: prepared.revision, proposalId: second.proposalId, operationId: "prepare-b", lifecycle: "preparing", proposal: second }))
      .toThrow(/unfinished operation[\s\S]*settled automatically[\s\S]*read/i)
  })

  it("past the deadline the stuck write ends in a terminal state on the next touch (read), and later writes go through", () => {
    const clock = { now: Date.parse("2026-09-30T10:00:00Z") }
    const { service, prepared } = stuck(tempProject(), clock)
    clock.now += PROJECT_AGENT_PREPARING_DEADLINE_MS + 1
    const settled = service.read()
    expect(settled).toMatchObject({ lifecycle: "undone", proposalId: proposal.proposalId })
    expect(settled!.revision).toBe(prepared.revision + 1)
    const next = service.write({ expectedRevision: settled!.revision, proposalId: second.proposalId, operationId: "prepare-b", lifecycle: "preparing", proposal: second })
    expect(next).toMatchObject({ lifecycle: "preparing", proposalId: second.proposalId })
  })

  it("the settlement is durable and idempotent: a recreated reader sees the same terminal receipt, not a second settlement", () => {
    const clock = { now: Date.parse("2026-09-30T10:00:00Z") }
    const projectRoot = tempProject()
    const { service, prepared } = stuck(projectRoot, clock)
    clock.now += PROJECT_AGENT_PREPARING_DEADLINE_MS + 1
    const first = service.read()!
    const again = createProjectAgentProposalReceiptService({ projectRoot, binding, now: () => clock.now }).read()!
    expect(again.revision).toBe(first.revision)
    expect(first.revision).toBe(prepared.revision + 1)
  })

  it("a committed receipt never expires", () => {
    const clock = { now: Date.parse("2026-09-30T10:00:00Z") }
    const { service, prepared } = stuck(tempProject(), clock)
    service.write({ expectedRevision: prepared.revision, proposalId: proposal.proposalId, operationId: "commit-a", lifecycle: "committed", proposal })
    clock.now += PROJECT_AGENT_PREPARING_DEADLINE_MS * 10
    expect(service.read()).toMatchObject({ lifecycle: "committed", revision: 2 })
  })
})
