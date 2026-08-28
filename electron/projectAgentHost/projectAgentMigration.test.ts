import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { projectAgentContextPath } from "./projectAgentContextAdapter";
import { createProjectAgentRepositoryRouter } from "./projectAgentRepositoryRouter";
import { migrateProjectAgentLegacy } from "./projectAgentMigration";
import {
  createProjectAgentProposalReceiptService,
  hashProjectAgentCommittedProposal,
  projectAgentProposalReceiptInvalidPath,
  projectAgentProposalReceiptPath,
} from "./projectAgentProposalReceiptStore";
import {
  projectAgentCutoverLockPath,
  projectAgentCutoverManifestPath,
  withProjectAgentCutoverLock,
} from "./projectAgentCutoverManifest";

const binding = {
  projectId: "migration-project",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
} as const;
const now = Date.parse("2026-08-28T00:00:00.000Z");
const legacyProposal = {
  proposalId: "proposal-1",
  summary: "legacy undo",
  stepLabels: ["created Shot A"],
  categoryCounts: [{ categoryId: "shots", label: "Shots", count: 1 }],
  compensation: [{ kind: "delete-nodes", nodeIds: ["node-a"] }],
  watchNodes: [{ nodeId: "node-a", title: "Shot A", prompt: "wide shot" }],
  reconciliationOk: false,
  anchorMessageId: "assistant-a",
  anchorTextOffset: 12,
} as const;
let root = "";

afterEach(() => {
  vi.restoreAllMocks();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
});

function writeLegacySource(): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-migration-"));
  fs.mkdirSync(path.join(root, ".nomi"), { recursive: true });
  const threads = (area: string) =>
    Array.from({ length: 31 }, (_, index) => ({
      id: index === 0 ? "same-old-thread" : `${area}-old-thread-${index}`,
      title: `${area} ${index}`,
      createdAt: now + index,
      updatedAt: now + index + 1,
      messages: Array.from({ length: index === 0 ? 205 : 1 }, (_, messageIndex) => ({
        id: `${area}-message-${index}-${messageIndex}`,
        role: messageIndex % 2 === 0 ? "user" : "assistant",
        content: `${area} message ${index}/${messageIndex}`,
      })),
    }));
  fs.writeFileSync(
    path.join(root, ".nomi", "conversations.json"),
    JSON.stringify({
      v: 2,
      creation: { activeId: "creation-old-thread-7", threads: threads("creation") },
      generation: { activeId: "same-old-thread", threads: threads("generation") },
      committedProposal: legacyProposal,
    }),
    "utf8",
  );
  return root;
}

describe("ProjectAgent legacy raw migration", () => {
  it("imports every valid legacy thread/message without old clipping or cross-area collisions", () => {
    const projectRoot = writeLegacySource();
    const agentStore = path.join(projectRoot, "agent-store");
    fs.mkdirSync(agentStore, { recursive: true });
    const router = createProjectAgentRepositoryRouter({ rootDir: agentStore });
    const result = migrateProjectAgentLegacy({ projectRoot, binding, router, now });
    expect(result.migrated).toBe(true);
    expect(result.creationThreads).toBe(31);
    expect(result.generationThreads).toBe(31);
    expect(result.messageCount).toBe(31 * 1 + 31 * 1 + 2 * 204);

    const state = router.repositoryFor(binding).load(binding);
    expect(state).not.toBeNull();
    expect(state!.threads).toHaveLength(63);
    expect(state!.threads.filter((thread) => thread.provenance?.kind === "legacy")).toHaveLength(62);
    expect(new Set(state!.threads.map((thread) => thread.threadId)).size).toBe(63);
    expect(state!.items.some((item) => item.kind === "assistant" && item.text.includes("creation message 0/203"))).toBe(
      true,
    );
    expect(
      state!.items.some((item) => item.kind === "assistant" && item.text.includes("generation message 0/203")),
    ).toBe(true);
    expect(state!.activeThreadId).toBe(
      state!.threads.find((thread) => thread.provenance?.kind === "canonical")!.threadId,
    );
    const durable = JSON.parse(fs.readFileSync(projectAgentProposalReceiptPath(projectRoot), "utf8"));
    expect(durable).toMatchObject({
      schemaVersion: 2,
      lifecycle: "committed",
      proposalId: "proposal-1",
      proposalHash: hashProjectAgentCommittedProposal(legacyProposal),
      proposal: legacyProposal,
    });
    expect(createProjectAgentProposalReceiptService({ projectRoot, binding }).read()).toMatchObject({
      lifecycle: "committed",
      proposal: legacyProposal,
    });
  });

  it("archives an unconvertible legacy proposal without creating a valid Undo receipt", () => {
    const projectRoot = writeLegacySource();
    const sourcePath = path.join(projectRoot, ".nomi", "conversations.json");
    const source = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(sourcePath, JSON.stringify({ ...source, committedProposal: { proposalId: "incomplete" } }), "utf8");
    const agentStore = path.join(projectRoot, "agent-store");
    fs.mkdirSync(agentStore, { recursive: true });
    const router = createProjectAgentRepositoryRouter({ rootDir: agentStore });

    expect(migrateProjectAgentLegacy({ projectRoot, binding, router, now }).migrated).toBe(true);
    expect(fs.existsSync(projectAgentProposalReceiptPath(projectRoot))).toBe(false);
    expect(createProjectAgentProposalReceiptService({ projectRoot, binding }).read()).toBeNull();
    expect(JSON.parse(fs.readFileSync(projectAgentProposalReceiptInvalidPath(projectRoot), "utf8"))).toMatchObject({
      binding,
      reason: "invalid_legacy_proposal",
      proposal: { proposalId: "incomplete" },
    });
  });

  it("is source-hash/idempotent on restart and never replays legacy commands", () => {
    const projectRoot = writeLegacySource();
    const agentStore = path.join(projectRoot, "agent-store");
    fs.mkdirSync(agentStore, { recursive: true });
    const router = createProjectAgentRepositoryRouter({ rootDir: agentStore });
    const first = migrateProjectAgentLegacy({ projectRoot, binding, router, now });
    const second = migrateProjectAgentLegacy({ projectRoot, binding, router, now: now + 1000 });
    expect(first.manifest.sources).toEqual(second.manifest.sources);
    expect(second.migrated).toBe(false);
    expect(router.repositoryFor(binding).load(binding)!.hostRevision).toBe(0);
  });

  it.each([
    ["context staging", (projectRoot: string) => projectAgentContextPath(projectRoot)],
    [
      "Host initialization",
      (_projectRoot: string, router: ReturnType<typeof createProjectAgentRepositoryRouter>) =>
        router.repositoryFor(binding).pathsFor(binding).snapshot,
    ],
    ["proposal receipt", (projectRoot: string) => projectAgentProposalReceiptPath(projectRoot)],
    ["manifest publication", (projectRoot: string) => projectAgentCutoverManifestPath(projectRoot)],
  ])("resumes with byte-identical state after a crash during %s", (_label, targetPath) => {
    const projectRoot = writeLegacySource();
    const agentStore = path.join(projectRoot, "agent-store");
    fs.mkdirSync(agentStore, { recursive: true });
    const router = createProjectAgentRepositoryRouter({ rootDir: agentStore });
    const target = targetPath(projectRoot, router);
    const rename = fs.renameSync.bind(fs);
    let failed = false;
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (!failed && String(to) === target) {
        failed = true;
        throw new Error("simulated process crash");
      }
      return rename(from, to);
    });

    expect(() => migrateProjectAgentLegacy({ projectRoot, binding, router, now })).toThrow("simulated process crash");
    expect(fs.existsSync(projectAgentCutoverManifestPath(projectRoot))).toBe(false);
    renameSpy.mockRestore();

    const recovered = migrateProjectAgentLegacy({ projectRoot, binding, router, now: now + 60_000 });
    expect(recovered.migrated).toBe(true);
    expect(recovered.manifest.completedAt).toBe(new Date(now).toISOString());
    expect(router.repositoryFor(binding).load(binding)?.items).toHaveLength(recovered.messageCount);
    expect(migrateProjectAgentLegacy({ projectRoot, binding, router, now: now + 120_000 }).migrated).toBe(false);
  });

  it("uses only a validated exact legacy context candidate", () => {
    const projectRoot = writeLegacySource();
    fs.writeFileSync(
      path.join(projectRoot, ".nomi", "agent-session.json"),
      JSON.stringify({
        version: 2,
        sessions: {
          "nomi:workbench:migration-project:creation": {
            snapshot: "opaque-snapshot",
            threadId: "creation-old-thread-7",
          },
          "nomi:workbench:other-project:creation": { snapshot: "ambiguous" },
        },
      }),
      "utf8",
    );
    const agentStore = path.join(projectRoot, "agent-store");
    fs.mkdirSync(agentStore, { recursive: true });
    const router = createProjectAgentRepositoryRouter({ rootDir: agentStore });
    const result = migrateProjectAgentLegacy({ projectRoot, binding, router, now });
    const state = router.repositoryFor(binding).load(binding)!;
    const active = state.threads.find((thread) => thread.threadId === state.activeThreadId)!;
    expect(active.provenance?.kind).toBe("legacy");
    if (active.provenance?.kind === "legacy") {
      expect(active.provenance.source.legacySessionKey).toBe("nomi:workbench:migration-project:creation");
    }
    expect(result.migrated).toBe(true);
  });

  it("allows retry after a stale cutover lock from a crashed process", () => {
    const projectRoot = writeLegacySource();
    const lockPath = projectAgentCutoverLockPath(projectRoot);
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, startedAt: 1 }), "utf8");
    expect(withProjectAgentCutoverLock(projectRoot, () => "retried")).toBe("retried");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("allows immediate retry when a recent cutover lock belongs to a dead process", () => {
    const projectRoot = writeLegacySource();
    const lockPath = projectAgentCutoverLockPath(projectRoot);
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 424242, startedAt: Date.now() }), "utf8");
    vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 424242) throw Object.assign(new Error("dead"), { code: "ESRCH" });
      return true;
    });
    expect(withProjectAgentCutoverLock(projectRoot, () => "retried")).toBe("retried");
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
