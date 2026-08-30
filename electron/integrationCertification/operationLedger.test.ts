import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CertificationPersistenceError,
  OperationLedger,
  type OperationLedgerWrite,
} from "./operationLedger";
import { ProductionRunLockBusyError } from "../productionRun/productionRunLock";
import { certificationModeOperationKey } from "./modeIdentity";

const roots: string[] = [];

function ledger(dependencies: { write?: OperationLedgerWrite } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-cert-ledger-"));
  roots.push(root);
  const filePath = path.join(root, "private", "operations.json");
  return { filePath, ledger: new OperationLedger(filePath, dependencies) };
}

function beginInput(overrides: Record<string, unknown> = {}) {
  const runId = typeof overrides.runId === "string" ? overrides.runId : "run-1";
  return {
    runId,
    contractDigest: "a".repeat(64),
    idempotencyKey: "integration-user-confirmation-1",
    lineageRootVendorKey: "api-example-com",
    leaseOwner: "run-1",
    leaseToken: "lease-1",
    attempt: 1,
    childRunRef: { runId, revisionDigest: "a".repeat(64) },
    now: "2026-08-28T00:00:00.000Z",
    ...overrides,
  } as const;
}

function created(result: ReturnType<OperationLedger["begin"]>) {
  if (!result.operation) throw new Error("Expected an active certification operation");
  return result.operation;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("OperationLedger", () => {
  it("rejects a child reference that points at a different canonical run", () => {
    const { ledger: store } = ledger();
    expect(() => store.begin(beginInput({
      runId: "run-canonical",
      childRunRef: { runId: "run-other", revisionDigest: "b".repeat(64) },
    }))).toThrowError(/child run reference must match/i);
  });

  it("rejects a child reference whose revision digest differs from the immutable contract", () => {
    const { ledger: store } = ledger();
    expect(() => store.begin(beginInput({
      childRunRef: { runId: "run-1", revisionDigest: "b".repeat(64) },
    }))).toThrowError(/child.*digest|revision.*contract/i);
  });

  it("fails closed when an active or tombstoned child reference is corrupted on reopen", () => {
    const active = ledger();
    active.ledger.begin(beginInput());
    const activeRaw = JSON.parse(fs.readFileSync(active.filePath, "utf8")) as { operations: Array<Record<string, unknown>> };
    (activeRaw.operations[0].childRunRef as Record<string, unknown>).revisionDigest = "b".repeat(64);
    fs.writeFileSync(active.filePath, JSON.stringify(activeRaw));
    expect(() => new OperationLedger(active.filePath)).toThrowError(/child.*digest|revision.*contract/i);

    const terminal = ledger();
    const operation = created(terminal.ledger.begin(beginInput()));
    terminal.ledger.markCheckpoint("run-1", {
      checkpoint: "finalized",
      expectedRevision: operation.revision,
      now: "2026-08-28T00:00:01.000Z",
    });
    const terminalRaw = JSON.parse(fs.readFileSync(terminal.filePath, "utf8")) as { operations: Array<Record<string, unknown>>; tombstones: Array<Record<string, unknown>> };
    const source = terminalRaw.operations[0];
    terminalRaw.operations = [];
    terminalRaw.tombstones = [{
      version: 1,
      idempotencyHash: source.idempotencyHash,
      contractDigest: source.contractDigest,
      canonicalRunId: source.runId,
      childRunRef: { runId: source.runId, revisionDigest: "b".repeat(64) },
      terminalSummary: "finalized",
      terminalAt: source.updatedAt,
    }];
    fs.writeFileSync(terminal.filePath, JSON.stringify(terminalRaw));
    expect(() => new OperationLedger(terminal.filePath)).toThrowError(/child.*digest|revision.*contract/i);
  });

  it("fails closed when an archived child reference contradicts its canonical contract", () => {
    const { filePath } = ledger();
    const compacting = new OperationLedger(filePath, { maxActiveOperations: 0, maxInlineTombstones: 0 } as never);
    const operation = created(compacting.begin(beginInput()));
    compacting.markCheckpoint(operation.runId, {
      checkpoint: "finalized",
      expectedRevision: operation.revision,
      now: "2026-08-28T00:00:01.000Z",
    });
    const state = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      archives: Array<{ fileName: string; sha256: string; count: number }>;
    };
    const oldRef = state.archives[0];
    const archiveDir = path.join(path.dirname(filePath), `${path.basename(filePath)}.archive`);
    const oldPath = path.join(archiveDir, oldRef.fileName);
    const segment = JSON.parse(fs.readFileSync(oldPath, "utf8")) as { tombstones: Array<{ childRunRef: { revisionDigest: string } }> };
    segment.tombstones[0].childRunRef.revisionDigest = "b".repeat(64);
    const serialized = JSON.stringify(segment);
    const sha256 = crypto.createHash("sha256").update(serialized).digest("hex");
    const fileName = `segment-${sha256}.json`;
    fs.writeFileSync(path.join(archiveDir, fileName), serialized);
    state.archives[0] = { ...oldRef, fileName, sha256 };
    fs.writeFileSync(filePath, JSON.stringify(state));

    const reopened = new OperationLedger(filePath);
    expect(() => reopened.childRunRefForRunId(operation.runId)).toThrowError(/child.*digest|revision.*contract/i);
  });

  it("returns an explicit created or duplicate disposition with the canonical run id", () => {
    const { ledger: store } = ledger();
    const created = store.begin(beginInput()) as unknown as {
      status: string;
      canonicalRunId: string;
      operation: { runId: string };
    };
    const duplicate = store.begin({ ...beginInput(), runId: "run-2" }) as unknown as {
      status: string;
      canonicalRunId: string;
      operation?: { runId: string };
    };

    expect(created).toMatchObject({ status: "created", canonicalRunId: "run-1", operation: { runId: "run-1" } });
    expect(duplicate).toMatchObject({ status: "duplicate", canonicalRunId: "run-1", operation: { runId: "run-1" } });
  });

  it("uses structured mode identity for model keys containing slashes and opaque operation keys", () => {
    const { ledger: store, filePath } = ledger();
    const begun = store.begin(beginInput()) as unknown as { revision?: number; operation?: { revision: number } };
    const operationKey = "c".repeat(64);
    store.markSubmitting("run-1", {
      operationKey,
      modelKey: "bytedance/seedance-2",
      taskKind: "text_to_video",
      attempt: 1,
      providerIdempotency: "unsupported",
      expectedRevision: begun.operation?.revision ?? begun.revision!,
      now: "2026-08-28T00:00:01.000Z",
    } as never);

    const recovered = new OperationLedger(filePath).getByRunId("run-1") as unknown as {
      modeOperationKeys: Record<string, { version: number; modelKey: string; taskKind: string; latestAttempt: number; operationKey: string }>;
      modeOperations: Record<string, { modelKey: string; taskKind: string; attempt: number }>;
    };
    const indexes = Object.values(recovered.modeOperationKeys);
    expect(indexes).toEqual([{
      version: 1,
      modelKey: "bytedance/seedance-2",
      taskKind: "text_to_video",
      latestAttempt: 1,
      operationKey,
    }]);
    expect(recovered.modeOperations[operationKey]).toMatchObject({ modelKey: "bytedance/seedance-2", taskKind: "text_to_video", attempt: 1 });
  });

  it("migrates v2 slash identities to the structured latest-attempt index", () => {
    const { ledger: store, filePath } = ledger();
    const first = store.begin(beginInput()) as unknown as { revision?: number; operation?: { revision: number } };
    store.markSubmitting("run-1", {
      operationKey: "d".repeat(64),
      modelKey: "bytedance/seedance-2",
      taskKind: "text_to_video",
      attempt: 2,
      providerIdempotency: "unsupported",
      expectedRevision: first.operation?.revision ?? first.revision!,
      now: "2026-08-28T00:00:01.000Z",
    } as never);
    const legacy = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      version: number;
      operations: Array<Record<string, unknown>>;
    };
    legacy.version = 2;
    const operation = legacy.operations[0];
    operation.version = 2;
    const legacyKey = "bytedance/seedance-2/text_to_video/2";
    const mode = Object.values(operation.modeOperations as Record<string, Record<string, unknown>>)[0];
    mode.operationKey = legacyKey;
    operation.operationKey = legacyKey;
    operation.modeOperations = { [legacyKey]: mode };
    operation.modeOperationKeys = { "bytedance/seedance-2/text_to_video": legacyKey };
    fs.writeFileSync(filePath, JSON.stringify(legacy));

    const reopened = new OperationLedger(filePath).snapshot() as unknown as {
      version: number;
      operations: Array<{ modeOperationKeys: Record<string, { latestAttempt: number; modelKey: string }> }>;
    };
    expect(reopened.version).toBe(3);
    expect(Object.values(reopened.operations[0].modeOperationKeys)).toEqual([
      expect.objectContaining({ latestAttempt: 2, modelKey: "bytedance/seedance-2" }),
    ]);
  });

  it.each(["settled", "failed", "unknown"] as const)("recovers the latest attempt when attempt 2 is %s", (outcome) => {
    const { ledger: store, filePath } = ledger();
    const first = store.begin(beginInput()) as unknown as { revision?: number; operation?: { revision: number } };
    let current = store.markSubmitting("run-1", {
      operationKey: "a".repeat(64), modelKey: "bytedance/seedance-2", taskKind: "text_to_video", attempt: 1,
      providerIdempotency: "unsupported", expectedRevision: first.operation?.revision ?? first.revision!, now: "2026-08-28T00:00:01.000Z",
    } as never);
    current = store.markSettled("run-1", {
      operationKey: "a".repeat(64), expectedRevision: current.revision,
      result: { ok: false, taskKind: "text_to_video", stage: "create", errorCategory: "input" }, now: "2026-08-28T00:00:02.000Z",
    });
    current = store.markSubmitting("run-1", {
      operationKey: "b".repeat(64), modelKey: "bytedance/seedance-2", taskKind: "text_to_video", attempt: 2,
      providerIdempotency: "unsupported", expectedRevision: current.revision, now: "2026-08-28T00:00:03.000Z",
    } as never);
    if (outcome === "unknown") {
      store.markUnknown("run-1", {
        operationKey: "b".repeat(64), expectedRevision: current.revision,
        userAction: "reconcile_or_contact_provider", remoteTaskId: "remote-attempt-2", now: "2026-08-28T00:00:04.000Z",
      });
    } else {
      store.markSettled("run-1", {
        operationKey: "b".repeat(64), expectedRevision: current.revision,
        result: { ok: outcome === "settled", taskKind: "text_to_video", ...(outcome === "failed" ? { stage: "create" as const, errorCategory: "input" as const } : {}) },
        now: "2026-08-28T00:00:04.000Z",
      });
    }

    const reopened = new OperationLedger(filePath).getByRunId("run-1") as unknown as {
      modeOperationKeys: Record<string, { latestAttempt: number; operationKey: string }>;
      modeOperations: Record<string, { attempt: number; submissionState: string; settledResult?: { ok: boolean } }>;
    };
    const latest = Object.values(reopened.modeOperationKeys)[0];
    expect(latest).toMatchObject({ latestAttempt: 2, operationKey: "b".repeat(64) });
    expect(reopened.modeOperations[latest.operationKey]).toMatchObject({ attempt: 2 });
    expect(Object.values(reopened.modeOperations)).toHaveLength(1);
  });

  it("fails closed when the mode index and children are not a bijection", () => {
    const { ledger: store, filePath } = ledger();
    store.begin(beginInput());
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as { operations: Array<Record<string, unknown>> };
    const operation = raw.operations[0];
    operation.modeOperations = {
      ["a".repeat(64)]: {
        operationKey: "a".repeat(64), modelKey: "paint-v2", taskKind: "text_to_image", attempt: 1,
        checkpoint: "submitting", providerIdempotency: "unsupported", submissionState: "submitting",
        artifactEvidence: [], createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
      },
    };
    operation.modeOperationKeys = {};
    fs.writeFileSync(filePath, JSON.stringify(raw));

    expect(() => new OperationLedger(filePath)).toThrowError(/orphan|bijection|index/i);
  });

  it.each(["dangling", "duplicate", "mismatch", "latest-attempt"] as const)("quarantines a %s mode index contradiction", (kind) => {
    const { ledger: store, filePath } = ledger();
    const operation = created(store.begin(beginInput()));
    store.markSubmitting("run-1", {
      operationKey: "f".repeat(64), modelKey: "paint-v2", taskKind: "text_to_image", attempt: 1,
      providerIdempotency: "unsupported", expectedRevision: operation.revision, now: "2026-08-28T00:00:01.000Z",
    });
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as { operations: Array<Record<string, unknown>> };
    const indexes = raw.operations[0].modeOperationKeys as Record<string, Record<string, unknown>>;
    const [identity, index] = Object.entries(indexes)[0];
    if (kind === "dangling") index.operationKey = "e".repeat(64);
    if (kind === "latest-attempt") index.latestAttempt = 2;
    if (kind === "mismatch") index.modelKey = "paint-v3";
    if (kind === "duplicate") indexes["0".repeat(64)] = { ...index, operationKey: "f".repeat(64) };
    raw.operations[0].modeOperationKeys = { ...indexes, [identity]: index };
    fs.writeFileSync(filePath, JSON.stringify(raw));

    expect(() => new OperationLedger(filePath)).toThrowError(/mode|index|orphan|multiply|mismatch/i);
  });

  it("serializes two real ledger instances and gives only one process the create lease", () => {
    const { ledger: first, filePath } = ledger();
    const second = new OperationLedger(filePath);
    const canonical = created(first.begin(beginInput()));
    const duplicate = second.begin({
      ...beginInput(),
      runId: "run-2",
      leaseOwner: "worker-2",
      leaseToken: "lease-2",
    });

    expect(duplicate.canonicalRunId).toBe(canonical.runId);
    const firstLease = first.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      modelKey: "paint-v2",
      taskKind: "text_to_image",
      attempt: 1,
      providerIdempotency: "unsupported",
      expectedRevision: canonical.revision,
      now: "2026-08-28T00:00:01.000Z",
    });
    expect(() => second.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      modelKey: "paint-v2",
      taskKind: "text_to_image",
      attempt: 1,
      providerIdempotency: "unsupported",
      expectedRevision: canonical.revision,
      now: "2026-08-28T00:00:01.000Z",
    })).toThrowError(/revision|submitting|lease/i);
    expect(new OperationLedger(filePath).getByRunId("run-1")?.revision).toBe(firstLease.revision);
  });

  it("stores only an idempotency hash and keeps the same key stable", () => {
    const { ledger: store, filePath } = ledger();
    store.begin(beginInput());
    const persisted = fs.readFileSync(filePath, "utf8");

    expect(persisted).not.toContain("integration-user-confirmation-1");
    expect((store.getByRunId("run-1") as unknown as { idempotencyHash?: string }).idempotencyHash)
      .toMatch(/^[a-f0-9]{64}$/);
    expect(store.begin({ ...beginInput(), runId: "run-2" }).canonicalRunId).toBe("run-1");
  });

  it("persists independent mode operations and their exact settled outcomes", () => {
    const { ledger: store, filePath } = ledger();
    const run = created(store.begin(beginInput()));
    store.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      modelKey: "paint-v2",
      taskKind: "text_to_image",
      attempt: 1,
      providerIdempotency: "unsupported",
      expectedRevision: run.revision,
      now: "2026-08-28T00:00:01.000Z",
    });
    let current = new OperationLedger(filePath).getByRunId("run-1")!;
    store.markSettled("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      expectedRevision: current.revision,
      result: { ok: true, taskKind: "text_to_image" },
      now: "2026-08-28T00:00:02.000Z",
    });
    current = new OperationLedger(filePath).getByRunId("run-1")!;
    store.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "image_edit", 1),
      modelKey: "paint-v2",
      taskKind: "image_edit",
      attempt: 1,
      providerIdempotency: "unsupported",
      expectedRevision: current.revision,
      now: "2026-08-28T00:00:03.000Z",
    });
    current = new OperationLedger(filePath).getByRunId("run-1")!;
    store.markSettled("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "image_edit", 1),
      expectedRevision: current.revision,
      result: { ok: false, taskKind: "image_edit", stage: "create", errorCategory: "input" },
      now: "2026-08-28T00:00:04.000Z",
    });

    const recovered = new OperationLedger(filePath).getByRunId("run-1") as unknown as {
      modeOperationKeys: Record<string, { operationKey: string; modelKey: string; taskKind: string }>;
      modeOperations: Record<string, { settledResult?: { ok: boolean } }>;
    };
    const indexes = Object.values(recovered.modeOperationKeys);
    const textToImage = indexes.find((index) => index.taskKind === "text_to_image")!;
    const imageEdit = indexes.find((index) => index.taskKind === "image_edit")!;
    expect(textToImage.modelKey).toBe("paint-v2");
    expect(recovered.modeOperations[textToImage.operationKey].settledResult?.ok).toBe(true);
    expect(recovered.modeOperations[imageEdit.operationKey].settledResult?.ok).toBe(false);
  });

  it("returns the original operation for a duplicate idempotency key and rejects contract drift", () => {
    const { ledger: store } = ledger();
    const first = store.begin(beginInput());
    const duplicate = store.begin({ ...beginInput(), runId: "run-2", leaseOwner: "run-2", leaseToken: "lease-2" });

    expect(first.status).toBe("created");
    expect(duplicate).toMatchObject({ status: "duplicate", canonicalRunId: "run-1", operation: first.operation });
    expect(store.snapshot().operations).toHaveLength(1);
    expect(() => store.begin({ ...beginInput(), contractDigest: "c".repeat(64) }))
      .toThrowError(/idempotency.*different contract/i);
  });

  it("persists every submission checkpoint and never permits unknown submission to create again", () => {
    const { ledger: store, filePath } = ledger();
    store.begin(beginInput());
    store.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      modelKey: "paint-v2", taskKind: "text_to_image", attempt: 1,
      providerIdempotency: "unsupported",
      expectedRevision: 1,
      now: "2026-08-28T00:00:01.000Z",
    });
    expect(new OperationLedger(filePath).getByRunId("run-1")).toMatchObject({
      checkpoint: "submitting",
      submissionState: "submitting",
    });

    store.markSubmitted("run-1", {
      remoteTaskId: "remote-accepted-1",
      expectedRevision: 2,
      now: "2026-08-28T00:00:01.500Z",
    });
    expect(new OperationLedger(filePath).getByRunId("run-1")).toMatchObject({
      checkpoint: "submitted",
      submissionState: "submitted",
      remoteTaskId: "remote-accepted-1",
    });

    store.markUnknown("run-1", {
      expectedRevision: 3,
      userAction: "reconcile_or_contact_provider",
      now: "2026-08-28T00:00:02.000Z",
    });
    expect(new OperationLedger(filePath).getByRunId("run-1")).toMatchObject({
      checkpoint: "submission_unknown",
      submissionState: "unknown",
      userAction: "reconcile_or_contact_provider",
    });
    expect(() => store.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      modelKey: "paint-v2", taskKind: "text_to_image", attempt: 1,
      providerIdempotency: "unsupported",
      expectedRevision: 4,
      now: "2026-08-28T00:00:03.000Z",
    })).toThrowError(/reconcile/i);

    store.markReconciled("run-1", {
      remoteTaskId: "remote-accepted-1",
      expectedRevision: 4,
      now: "2026-08-28T00:00:04.000Z",
    });
    store.markSettled("run-1", {
      expectedRevision: 5,
      artifactEvidence: [{
        kind: "image",
        contentType: "image/png",
        byteLength: 93,
        sha256: "d".repeat(64),
        metadata: { width: 2, height: 2 },
      }],
      now: "2026-08-28T00:00:05.000Z",
    });
    expect(new OperationLedger(filePath).getByRunId("run-1")).toMatchObject({
      checkpoint: "settled",
      submissionState: "settled",
      remoteTaskId: "remote-accepted-1",
    });
  });

  it("recovers each post-submission and promotion checkpoint after a fresh process", () => {
    const { ledger: store, filePath } = ledger();
    let current = created(store.begin(beginInput()));
    current = store.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      modelKey: "paint-v2", taskKind: "text_to_image", attempt: 1,
      providerIdempotency: "supported",
      expectedRevision: current.revision,
      now: "2026-08-28T00:00:01.000Z",
    });
    current = store.markSettled("run-1", {
      expectedRevision: current.revision,
      now: "2026-08-28T00:00:02.000Z",
    });
    for (const checkpoint of ["promotion_prepared", "promotion_committed", "finalized"] as const) {
      current = store.markCheckpoint("run-1", {
        checkpoint,
        expectedRevision: current.revision,
        now: "2026-08-28T00:00:03.000Z",
      });
      expect(new OperationLedger(filePath).getByRunId("run-1")?.checkpoint).toBe(checkpoint);
    }
  });

  it("uses revision and lease CAS for concurrent start/cancel despite clock skew", () => {
    const { ledger: store } = ledger();
    store.begin(beginInput());
    store.cancel("run-1", { expectedRevision: 1, leaseToken: "lease-1", now: "2026-08-28T00:00:10.000Z" });

    expect(() => store.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      modelKey: "paint-v2", taskKind: "text_to_image", attempt: 1,
      providerIdempotency: "supported",
      expectedRevision: 1,
      now: "2026-08-27T00:00:00.000Z",
    })).toThrowError(/revision|cancel/i);
    expect(() => store.cancel("run-1", {
      expectedRevision: 2,
      leaseToken: "stale-lease",
      now: "2026-08-29T00:00:00.000Z",
    })).toThrowError(/lease/i);
  });

  it("times out on a live foreign owner and rejects a lost lock before publishing", () => {
    const busy = {
      acquire: () => { throw new ProductionRunLockBusyError(); },
      assertOwned: () => undefined,
      release: () => undefined,
    };
    const { filePath } = ledger();
    expect(() => new OperationLedger(filePath, { lock: busy, lockTimeoutMs: 1 } as never).begin(beginInput()))
      .toThrowError(/lock timed out/i);

    const lost = {
      acquire: () => ({ ownerId: "lost-owner" }),
      assertOwned: () => { throw new Error("lease lost"); },
      release: () => undefined,
    };
    expect(() => new OperationLedger(filePath, { lock: lost } as never).begin(beginInput())).toThrowError(/lease lost/i);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("fails closed for corrupt, truncated, oversized, and future-version ledgers", () => {
    const { filePath } = ledger();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    for (const payload of ["{", JSON.stringify({ version: 99, operations: [] }), "x".repeat(1_048_577)]) {
      fs.writeFileSync(filePath, payload, "utf8");
      expect(() => new OperationLedger(filePath)).toThrowError(CertificationPersistenceError);
    }
  });

  it("rejects sensitive or contradictory fields anywhere in a recovered operation", () => {
    const { ledger: store, filePath } = ledger();
    store.begin(beginInput());
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as { operations: Array<Record<string, unknown>> };
    raw.operations[0].apiKey = "SENTINEL-SECRET";
    fs.writeFileSync(filePath, JSON.stringify(raw));
    expect(() => new OperationLedger(filePath)).toThrowError(/apiKey|field/i);

    delete raw.operations[0].apiKey;
    const transaction = raw.operations[0].startTransaction as Record<string, unknown>;
    transaction.stagedVendorKey = "candidate-provider";
    fs.writeFileSync(filePath, JSON.stringify(raw));
    expect(() => new OperationLedger(filePath)).toThrowError(/unstaged|transaction/i);
  });

  it("keeps the previous in-memory and on-disk state when fsync or rename fails", () => {
    let fail = false;
    const write: OperationLedgerWrite = (filePath, state) => {
      if (fail) throw new Error("simulated fsync failure");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    };
    const { ledger: store, filePath } = ledger({ write });
    store.begin(beginInput());
    const before = fs.readFileSync(filePath, "utf8");
    fail = true;

    expect(() => store.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      modelKey: "paint-v2", taskKind: "text_to_image", attempt: 1,
      providerIdempotency: "unknown",
      expectedRevision: 1,
      now: "2026-08-28T00:00:01.000Z",
    })).toThrowError(/fsync/);
    expect(store.getByRunId("run-1")?.checkpoint).toBe("prepared");
    expect(fs.readFileSync(filePath, "utf8")).toBe(before);
  });

  it("does not publish an in-memory operation when the atomic rename fails", () => {
    const { ledger: store, filePath } = ledger();
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      const error = new Error("simulated rename failure") as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    });

    expect(() => store.begin(beginInput())).toThrowError(/rename/);
    expect(store.snapshot().operations).toEqual([]);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.readdirSync(path.dirname(filePath)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects URL-shaped remote task ids instead of persisting signed provider URLs", () => {
    const { ledger: store } = ledger();
    let current = created(store.begin(beginInput()));
    current = store.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      modelKey: "paint-v2", taskKind: "text_to_image", attempt: 1,
      providerIdempotency: "unknown",
      expectedRevision: current.revision,
      now: "2026-08-28T00:00:01.000Z",
    });
    expect(() => store.markSubmitted("run-1", {
      remoteTaskId: "https://cdn.invalid/output?token=SECRET",
      expectedRevision: current.revision,
      now: "2026-08-28T00:00:02.000Z",
    })).toThrowError(/remote task id/i);
  });

  it.each([
    "folder/task-1",
    "task?token=secret",
    "task#fragment",
    "task%2Fchild",
    "//cdn.invalid/task",
    "task\u0000id",
    "x".repeat(129),
  ])("rejects non-opaque remote task id %j", (remoteTaskId) => {
    const { ledger: store } = ledger();
    let current = created(store.begin(beginInput()));
    current = store.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      modelKey: "paint-v2", taskKind: "text_to_image", attempt: 1,
      providerIdempotency: "unknown",
      expectedRevision: current.revision,
      now: "2026-08-28T00:00:01.000Z",
    });
    expect(() => store.markSubmitted("run-1", {
      remoteTaskId,
      expectedRevision: current.revision,
      now: "2026-08-28T00:00:02.000Z",
    })).toThrowError(/remote task id/i);
  });

  it("rejects unknown or sensitive artifact evidence fields instead of silently filtering them", () => {
    const { ledger: store } = ledger();
    let current = created(store.begin(beginInput()));
    current = store.markSubmitting("run-1", {
      operationKey: certificationModeOperationKey("paint-v2", "text_to_image", 1),
      modelKey: "paint-v2", taskKind: "text_to_image", attempt: 1,
      providerIdempotency: "unknown",
      expectedRevision: current.revision,
      now: "2026-08-28T00:00:01.000Z",
    });
    expect(() => store.markSettled("run-1", {
      expectedRevision: current.revision,
      artifactEvidence: [{
        kind: "image",
        contentType: "image/png",
        byteLength: 93,
        sha256: "d".repeat(64),
        metadata: { width: 2, token: "secret", localPath: "/tmp/private.png" },
      } as never],
      now: "2026-08-28T00:00:02.000Z",
    })).toThrowError(/metadata|sensitive|field/i);
  });

  it.each([
    { checkpoint: "prepared", submissionState: "settled", remoteTaskId: undefined, evidence: [] },
    { checkpoint: "submitting", submissionState: "submitting", remoteTaskId: "remote-1", evidence: [] },
    { checkpoint: "submitted", submissionState: "submitted", remoteTaskId: undefined, evidence: [] },
    { checkpoint: "submission_unknown", submissionState: "unknown", remoteTaskId: undefined, evidence: [{ kind: "image" }] },
    { checkpoint: "settled", submissionState: "settled", remoteTaskId: undefined, evidence: [] },
  ])("fails closed on contradictory semantic state %#", (invalid) => {
    const { ledger: store, filePath } = ledger();
    store.begin(beginInput());
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as { operations: Array<Record<string, unknown>> };
    Object.assign(raw.operations[0], {
      checkpoint: invalid.checkpoint,
      submissionState: invalid.submissionState,
      ...(invalid.remoteTaskId ? { remoteTaskId: invalid.remoteTaskId } : {}),
      artifactEvidence: invalid.evidence,
    });
    fs.writeFileSync(filePath, JSON.stringify(raw));
    expect(() => new OperationLedger(filePath)).toThrowError(CertificationPersistenceError);
  });

  it("cleans failed atomic temp files and only removes stale startup temps", () => {
    const { filePath } = ledger();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const stale = path.join(path.dirname(filePath), `.${path.basename(filePath)}.stale.tmp`);
    const active = path.join(path.dirname(filePath), `.${path.basename(filePath)}.active.tmp`);
    fs.writeFileSync(stale, "stale");
    fs.writeFileSync(active, "active");
    const old = new Date(Date.now() - 60 * 60_000);
    fs.utimesSync(stale, old, old);

    new OperationLedger(filePath);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(active)).toBe(true);

    const original = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((target, ...args) => {
      if (typeof target === "number") throw new Error("simulated write failure");
      return (original as (...values: unknown[]) => unknown)(target, ...args) as never;
    });
    expect(() => new OperationLedger(filePath).begin(beginInput())).toThrowError(/write failure/);
    expect(fs.readdirSync(path.dirname(filePath)).filter((name) =>
      name.startsWith(`.${path.basename(filePath)}.`) && !name.includes(".lock.") && name.endsWith(".tmp"),
    )).toEqual([
      path.basename(active),
    ]);
  });

  it("compacts terminal details into permanent bounded tombstones before size limits", () => {
    const { filePath } = ledger();
    const compacting = new OperationLedger(filePath, { maxActiveOperations: 3, maxInlineTombstones: 2 } as never);
    for (let index = 0; index < 8; index += 1) {
      const runId = `run-${index}`;
      const record = created(compacting.begin(beginInput({
        runId,
        idempotencyKey: `confirmation-${index}`,
        leaseOwner: runId,
        leaseToken: `lease-${index}`,
      })));
      compacting.markCheckpoint(runId, {
        checkpoint: "finalized",
        expectedRevision: record.revision,
        now: "2026-08-28T00:00:10.000Z",
      });
    }
    const raw = fs.readFileSync(filePath, "utf8");
    expect(Buffer.byteLength(raw)).toBeLessThan(1_048_576);
    expect(raw).not.toContain("artifactEvidence");
    expect((new OperationLedger(filePath) as unknown as { canonicalRunForIdempotencyKey: (key: string) => string })
      .canonicalRunForIdempotencyKey("confirmation-0")).toBe("run-0");
    expect(new OperationLedger(filePath).childRunRefForRunId("run-0")).toEqual({
      runId: "run-0",
      revisionDigest: "a".repeat(64),
    });
  });

  it("reopens after more than 1000 compactions with a bounded archive head and permanent idempotency history", () => {
    const { filePath } = ledger();
    const fastWrite = (target: string, state: unknown) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(state));
    };
    const compacting = new OperationLedger(filePath, {
      maxActiveOperations: 0,
      maxInlineTombstones: 0,
      write: fastWrite,
      writeArchive: fastWrite,
    } as never);
    for (let index = 0; index < 1_005; index += 1) {
      const runId = `run-${index}`;
      const begun = compacting.begin(beginInput({
        runId,
        idempotencyKey: `confirmation-${index}`,
        leaseOwner: runId,
        leaseToken: `lease-${index}`,
      })) as unknown as { revision?: number; operation?: { revision: number } };
      compacting.markCheckpoint(runId, {
        checkpoint: "finalized",
        expectedRevision: begun.operation?.revision ?? begun.revision!,
        now: "2026-08-28T00:00:10.000Z",
      });
    }

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8")) as { archives: unknown[] };
    expect(persisted.archives.length).toBeLessThanOrEqual(1);
    const reopened = new OperationLedger(filePath);
    expect(reopened.canonicalRunForIdempotencyKey("confirmation-0")).toBe("run-0");
    expect(reopened.canonicalRunForIdempotencyKey("confirmation-1004")).toBe("run-1004");
    expect(reopened.childRunRefForRunId("run-0")).toEqual({ runId: "run-0", revisionDigest: "a".repeat(64) });
  }, 60_000);

  it("keeps the prior ledger intact across compaction crash and rejects oversized/versioned archives", () => {
    const { filePath } = ledger();
    const crashing = new OperationLedger(filePath, {
      maxActiveOperations: 1,
      maxInlineTombstones: 0,
      writeArchive: () => { throw new Error("simulated compaction crash"); },
    } as never);
    const first = created(crashing.begin(beginInput()));
    crashing.markCheckpoint(first.runId, { checkpoint: "finalized", expectedRevision: first.revision, now: "2026-08-28T00:00:10.000Z" });
    expect(() => crashing.begin(beginInput({ runId: "run-2", idempotencyKey: "confirmation-2", leaseOwner: "run-2", leaseToken: "lease-2" })))
      .toThrowError(/compaction crash/);
    expect(new OperationLedger(filePath).canonicalRunForIdempotencyKey(beginInput().idempotencyKey)).toBe("run-1");

    const compacting = new OperationLedger(filePath, { maxActiveOperations: 1, maxInlineTombstones: 1 } as never);
    const second = created(compacting.begin(beginInput({ runId: "run-2", idempotencyKey: "confirmation-2", leaseOwner: "run-2", leaseToken: "lease-2" })));
    compacting.markCheckpoint(second.runId, { checkpoint: "finalized", expectedRevision: second.revision, now: "2026-08-28T00:00:11.000Z" });
    compacting.begin(beginInput({ runId: "run-3", idempotencyKey: "confirmation-3", leaseOwner: "run-3", leaseToken: "lease-3" }));
    const archiveDir = `${filePath}.archive`;
    const compactedState = JSON.parse(fs.readFileSync(filePath, "utf8")) as { archives: Array<{ fileName: string }> };
    const archivePath = path.join(archiveDir, compactedState.archives[0].fileName);
    const archive = JSON.parse(fs.readFileSync(archivePath, "utf8")) as Record<string, unknown>;
    archive.version = 99;
    fs.writeFileSync(archivePath, JSON.stringify(archive));
    expect(() => new OperationLedger(filePath).canonicalRunForIdempotencyKey(beginInput().idempotencyKey))
      .toThrowError(/version/i);

    fs.writeFileSync(filePath, JSON.stringify({ version: 2, operations: Array.from({ length: 1_001 }, () => ({})), tombstones: [], archives: [] }));
    expect(() => new OperationLedger(filePath)).toThrowError(/entries|invalid|too many/i);
  });

  it("creates private directories/files and persists no secret, header, URL, body, or local path", () => {
    const { ledger: store, filePath } = ledger();
    store.begin(beginInput());
    const persisted = fs.readFileSync(filePath, "utf8");

    expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(persisted).not.toMatch(/apiKey|authorization|headers|signedUrl|rawBody|localPath|https?:\/\//i);
  });
});
