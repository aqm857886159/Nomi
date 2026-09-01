import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  projectAgentCutoverLockPath,
  projectAgentCutoverManifestPath,
  withProjectAgentCutoverLock,
} from "./projectAgentCutoverManifest";
import { migrateProjectAgentLegacy } from "./projectAgentMigration";
import {
  createProjectAgentProposalReceiptService,
  projectAgentProposalReceiptPath,
} from "./projectAgentProposalReceiptStore";
import { createProjectAgentRepositoryRouter } from "./projectAgentRepositoryRouter";

const binding = {
  projectId: "migration-project",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
} as const;
const now = Date.parse("2026-08-28T00:00:00.000Z");
const proposal = {
  proposalId: "proposal-new",
  summary: "new Host proposal",
  stepLabels: ["created Shot A"],
  categoryCounts: [{ categoryId: "shots", label: "Shots", count: 1 }],
  compensation: [{ kind: "delete-nodes" as const, nodeIds: ["node-a"] }],
  watchNodes: [{ nodeId: "node-a", title: "Shot A", prompt: "wide shot" }],
  reconciliationOk: true,
  anchorMessageId: "assistant-a",
  anchorTextOffset: 12,
} as const;

let root = "";

afterEach(() => {
  vi.restoreAllMocks();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
});

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function archivePath(projectRoot: string, fileName: string): string {
  const stamp = new Date(now).toISOString().replace(/[^0-9A-Za-z]/g, "_");
  return path.join(projectRoot, ".nomi", "project-agent-legacy-archive-v1", `${stamp}-${fileName}`);
}

function fixture() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-cutover-"));
  const nomiDir = path.join(root, ".nomi");
  fs.mkdirSync(nomiDir, { recursive: true });
  const sources = {
    conversations: Buffer.from([0xff, 0xfe, 0x00, 0x01]),
    context: Buffer.from("not-json-context", "utf8"),
    receipt: Buffer.from("legacy-pending-receipt", "utf8"),
  } as const;
  fs.writeFileSync(path.join(nomiDir, "conversations.json"), sources.conversations);
  fs.writeFileSync(path.join(nomiDir, "agent-session.json"), sources.context);
  fs.writeFileSync(projectAgentProposalReceiptPath(root), sources.receipt);
  const workData = new Map<string, Buffer>([
    [path.join(root, "project.json"), Buffer.from("valuable-work-data")],
    [path.join(nomiDir, "project.json"), Buffer.from([0x00, 0xff, 0x10, 0x20])],
    [path.join(nomiDir, "assets", "reference.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    [path.join(nomiDir, "exports", "final.mp4"), Buffer.from([0x00, 0x00, 0x00, 0x18])],
    [path.join(nomiDir, "runs", "paid-run.json"), Buffer.from('{"status":"submission_unknown"}')],
  ]);
  for (const [filePath, bytes] of workData) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
  }
  const agentStore = path.join(root, "agent-store");
  fs.mkdirSync(agentStore, { recursive: true });
  return {
    projectRoot: root,
    router: createProjectAgentRepositoryRouter({ rootDir: agentStore }),
    sources,
    workData,
  };
}

describe("Project Agent archive-only cutover", () => {
  it("archives raw legacy bytes, starts an empty Host, and leaves work data untouched", () => {
    const { projectRoot, router, sources, workData } = fixture();
    const result = migrateProjectAgentLegacy({ projectRoot, binding, router, now });

    expect(result).toMatchObject({ migrated: true, manifest: { mode: "archive-only" } });
    expect(result.manifest.sources).toEqual({
      conversationsHash: sha256(sources.conversations),
      contextHash: sha256(sources.context),
      proposalReceiptHash: sha256(sources.receipt),
    });
    expect(router.repositoryFor(binding).load(binding)).toMatchObject({
      hostRevision: 0,
      threads: [],
      turns: [],
      items: [],
      queue: [],
      proposalApprovals: [],
    });
    expect(fs.readFileSync(archivePath(projectRoot, "conversations.json"))).toEqual(sources.conversations);
    expect(fs.readFileSync(archivePath(projectRoot, "agent-session.json"))).toEqual(sources.context);
    expect(fs.readFileSync(archivePath(projectRoot, "project-agent-proposal-receipt.json"))).toEqual(sources.receipt);
    if (process.platform !== "win32") {
      expect(fs.statSync(archivePath(projectRoot, "conversations.json")).mode & 0o777).toBe(0o400);
    }
    expect(fs.existsSync(path.join(projectRoot, ".nomi", "conversations.json"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, ".nomi", "agent-session.json"))).toBe(false);
    expect(fs.existsSync(projectAgentProposalReceiptPath(projectRoot))).toBe(false);
    for (const [filePath, bytes] of workData) expect(fs.readFileSync(filePath)).toEqual(bytes);
  });

  it.each(["preparing", "committed"] as const)(
    "invalidates a valid %s legacy receipt without restoring Undo or queue work",
    (lifecycle) => {
      const { projectRoot, router } = fixture();
      fs.rmSync(projectAgentProposalReceiptPath(projectRoot));
      const service = createProjectAgentProposalReceiptService({ projectRoot, binding });
      const preparing = service.write({
        expectedRevision: 0,
        proposalId: proposal.proposalId,
        operationId: "legacy-prepare",
        lifecycle: "preparing",
        proposal,
      });
      if (lifecycle === "committed") {
        service.write({
          expectedRevision: preparing.revision,
          proposalId: proposal.proposalId,
          operationId: "legacy-commit",
          lifecycle: "committed",
          proposal,
        });
      }
      const receiptBytes = fs.readFileSync(projectAgentProposalReceiptPath(projectRoot));

      migrateProjectAgentLegacy({ projectRoot, binding, router, now });

      expect(fs.readFileSync(archivePath(projectRoot, "project-agent-proposal-receipt.json")))
        .toEqual(receiptBytes);
      expect(service.read()).toBeNull();
      expect(router.repositoryFor(binding).load(binding)).toMatchObject({
        queue: [],
        proposalApprovals: [],
      });
    },
  );

  it("is idempotent and never removes a receipt written by the new Host", () => {
    const { projectRoot, router } = fixture();
    const first = migrateProjectAgentLegacy({ projectRoot, binding, router, now });
    const service = createProjectAgentProposalReceiptService({ projectRoot, binding });
    service.write({
      expectedRevision: 0,
      proposalId: proposal.proposalId,
      operationId: "prepare-new-proposal",
      lifecycle: "preparing",
      proposal,
    });
    const newReceipt = fs.readFileSync(projectAgentProposalReceiptPath(projectRoot));

    const second = migrateProjectAgentLegacy({ projectRoot, binding, router, now: now + 60_000 });
    expect(second.migrated).toBe(false);
    expect(second.manifest).toEqual(first.manifest);
    expect(fs.readFileSync(projectAgentProposalReceiptPath(projectRoot))).toEqual(newReceipt);
  });

  it("fails closed when archived legacy evidence is changed", () => {
    const { projectRoot, router } = fixture();
    migrateProjectAgentLegacy({ projectRoot, binding, router, now });
    const archived = archivePath(projectRoot, "conversations.json");
    fs.chmodSync(archived, 0o600);
    fs.writeFileSync(archived, "tampered");

    expect(() => migrateProjectAgentLegacy({ projectRoot, binding, router, now: now + 1 })).toThrow(
      "archive does not match",
    );
  });

  it("rejects a pre-archive legacy-import manifest instead of silently accepting two modes", () => {
    const { projectRoot, router } = fixture();
    fs.writeFileSync(
      projectAgentCutoverManifestPath(projectRoot),
      JSON.stringify({
        schemaVersion: 1,
        binding,
        sources: {
          conversationsHash: "a".repeat(64),
          contextHash: "b".repeat(64),
          proposalHash: "c".repeat(64),
        },
        imported: { creationThreads: 1, generationThreads: 1, messageCount: 2 },
        completedAt: new Date(now).toISOString(),
      }),
      "utf8",
    );

    expect(() => migrateProjectAgentLegacy({ projectRoot, binding, router, now })).toThrow("manifest is invalid");
  });

  it("resumes after Host initialization crashes before manifest publication", () => {
    const { projectRoot, router } = fixture();
    const target = projectAgentCutoverManifestPath(projectRoot);
    const rename = fs.renameSync.bind(fs);
    let failed = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (!failed && String(to) === target) {
        failed = true;
        throw new Error("simulated manifest crash");
      }
      return rename(from, to);
    });

    expect(() => migrateProjectAgentLegacy({ projectRoot, binding, router, now })).toThrow("simulated manifest crash");
    expect(fs.existsSync(target)).toBe(false);
    vi.restoreAllMocks();

    const recovered = migrateProjectAgentLegacy({ projectRoot, binding, router, now: now + 60_000 });
    expect(recovered.migrated).toBe(true);
    expect(recovered.manifest.completedAt).toBe(new Date(now).toISOString());
    expect(router.repositoryFor(binding).load(binding)?.hostRevision).toBe(0);
  });

  it("retries cleanly when an archive publication is interrupted", () => {
    const { projectRoot, router, sources } = fixture();
    const target = archivePath(projectRoot, "conversations.json");
    const rename = fs.renameSync.bind(fs);
    let failed = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (!failed && String(to) === target) {
        failed = true;
        throw new Error("simulated archive crash");
      }
      return rename(from, to);
    });

    expect(() => migrateProjectAgentLegacy({ projectRoot, binding, router, now })).toThrow("simulated archive crash");
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(path.dirname(target)).some((name) => name.endsWith(".tmp"))).toBe(false);
    vi.restoreAllMocks();

    expect(migrateProjectAgentLegacy({ projectRoot, binding, router, now: now + 1 }).migrated).toBe(true);
    expect(fs.readFileSync(target)).toEqual(sources.conversations);
  });

  it("finishes invalidating an old receipt after a crash immediately after manifest publication", () => {
    const { projectRoot, router } = fixture();
    const receiptPath = projectAgentProposalReceiptPath(projectRoot);
    const remove = fs.rmSync.bind(fs);
    let failed = false;
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (!failed && String(target) === receiptPath) {
        failed = true;
        throw new Error("simulated receipt cleanup crash");
      }
      return remove(target, options);
    });

    expect(() => migrateProjectAgentLegacy({ projectRoot, binding, router, now })).toThrow(
      "simulated receipt cleanup crash",
    );
    expect(fs.existsSync(projectAgentCutoverManifestPath(projectRoot))).toBe(true);
    expect(fs.existsSync(receiptPath)).toBe(true);
    vi.restoreAllMocks();

    expect(migrateProjectAgentLegacy({ projectRoot, binding, router, now: now + 1 }).migrated).toBe(false);
    expect(fs.existsSync(receiptPath)).toBe(false);
  });

  it("finishes removing active legacy session files after a cleanup crash", () => {
    const { projectRoot, router } = fixture();
    const contextPath = path.join(projectRoot, ".nomi", "agent-session.json");
    const remove = fs.rmSync.bind(fs);
    let failed = false;
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (!failed && String(target) === contextPath) {
        failed = true;
        throw new Error("simulated session cleanup crash");
      }
      return remove(target, options);
    });

    expect(() => migrateProjectAgentLegacy({ projectRoot, binding, router, now })).toThrow(
      "simulated session cleanup crash",
    );
    expect(fs.existsSync(projectAgentCutoverManifestPath(projectRoot))).toBe(true);
    expect(fs.existsSync(contextPath)).toBe(true);
    vi.restoreAllMocks();

    expect(migrateProjectAgentLegacy({ projectRoot, binding, router, now: now + 1 }).migrated).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, ".nomi", "conversations.json"))).toBe(false);
    expect(fs.existsSync(contextPath)).toBe(false);
  });

  it("fails closed instead of deleting a legacy source changed after manifest publication", () => {
    const { projectRoot, router } = fixture();
    const conversationsPath = path.join(projectRoot, ".nomi", "conversations.json");
    const remove = fs.rmSync.bind(fs);
    let failed = false;
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (!failed && String(target) === conversationsPath) {
        failed = true;
        throw new Error("simulated pre-cleanup crash");
      }
      return remove(target, options);
    });
    expect(() => migrateProjectAgentLegacy({ projectRoot, binding, router, now })).toThrow(
      "simulated pre-cleanup crash",
    );
    expect(fs.existsSync(projectAgentCutoverManifestPath(projectRoot))).toBe(true);
    vi.restoreAllMocks();
    fs.writeFileSync(conversationsPath, "changed-after-archive", "utf8");

    expect(() => migrateProjectAgentLegacy({ projectRoot, binding, router, now: now + 1 })).toThrow(
      "source changed after archive publication",
    );
    expect(fs.readFileSync(conversationsPath, "utf8")).toBe("changed-after-archive");
  });

  it("rejects symlinked legacy sources", () => {
    const { projectRoot, router } = fixture();
    const conversations = path.join(projectRoot, ".nomi", "conversations.json");
    fs.rmSync(conversations);
    fs.symlinkSync(path.join(projectRoot, "project.json"), conversations);

    expect(() => migrateProjectAgentLegacy({ projectRoot, binding, router, now })).toThrow(
      "not a private regular file",
    );
  });

  it("allows retry after a stale cutover lock from a crashed process", () => {
    const { projectRoot } = fixture();
    const lockPath = projectAgentCutoverLockPath(projectRoot);
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, startedAt: 1 }), "utf8");
    expect(withProjectAgentCutoverLock(projectRoot, () => "retried")).toBe("retried");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("allows immediate retry when a recent cutover lock belongs to a dead process", () => {
    const { projectRoot } = fixture();
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
