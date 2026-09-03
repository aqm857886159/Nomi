import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HumanApprovalRequiredError,
  ReceiptExpiredError,
  ReceiptReplayResult,
  createApprovalReceiptAuthority,
} from "./approvalReceipt";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeAuthority() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-approval-receipt-"));
  tempDirs.push(dir);
  let tick = 0;
  const now = () => `2026-08-23T00:00:${String(tick).padStart(2, "0")}.000Z`;
  const advance = (seconds: number) => { tick += seconds; };
  const authority = createApprovalReceiptAuthority({
    filePath: path.join(dir, "receipts.json"),
    macKey: "receipt-authority-key",
    storeMacKey: "receipt-store-key",
    keyId: "receipt-v1",
    now,
    randomId: (() => {
      let index = 0;
      return () => `receipt-id-${++index}`;
    })(),
  });
  return { authority, advance, now };
}

function challenge(authority: ReturnType<typeof createApprovalReceiptAuthority>, ttlMs = 60_000) {
  return authority.requestChallenge({
    challengeKey: "run-1:contract-1:generation_submit:revision-1",
    immutableProjectUuid: "uuid-1",
    projectGeneration: 2,
    projectId: "project-1",
    runId: "run-1",
    gateId: "gate-1",
    contractHash: "contract-1",
    targetHash: "contract-1",
    projectRevision: 7,
    costScope: "CNY:5",
    pricingSnapshotHash: "price-1",
    reservationPreview: { currency: "CNY", maximum: 5 },
    display: { projectName: "短片 A", shotSummary: "生成这一镜", model: "model-x", referenceCount: 2 },
    ttlMs,
  });
}

describe("ApprovalReceiptAuthority", () => {
  it("persists a challenge, replays it after restart, and never treats external confirm as proof", () => {
    const { authority, now } = makeAuthority();
    const first = challenge(authority);
    expect(first.challenge.display).toEqual({ projectName: "短片 A", shotSummary: "生成这一镜", model: "model-x", referenceCount: 2 });
    const external = { action: "accept", content: { confirm: true } };
    expect(() => authority.mintReceipt(first.token, external)).toThrow(HumanApprovalRequiredError);

    const restarted = createApprovalReceiptAuthority({ filePath: authority.filePath, macKey: "receipt-authority-key", storeMacKey: "receipt-store-key", keyId: "receipt-v1", now });
    expect(restarted.requestChallenge({ ...first.input })).toEqual(first);
  });

  it("mints only from a valid main-process gesture and returns the same receipt on duplicate mint", () => {
    const { authority } = makeAuthority();
    const pending = challenge(authority);
    const attestation = authority.createMainProcessGestureAttestation(pending.token, {
      webContentsId: 10,
      frameId: 2,
      origin: "app://nomi",
      decision: "accept",
    });
    const first = authority.mintReceipt(pending.token, attestation);
    expect(first.receipt).toMatchObject({
      challengeId: pending.challenge.challengeId,
      humanActor: "web_contents:10:2:app://nomi",
      contractHash: "contract-1",
      targetHash: "contract-1",
    });
    expect(authority.mintReceipt(pending.token, attestation)).toEqual(first);
  });

  it("consumes a receipt once, preserves the original result on replay, and survives restart", () => {
    const { authority, now } = makeAuthority();
    const pending = challenge(authority);
    const attestation = authority.createMainProcessGestureAttestation(pending.token, { webContentsId: 10, frameId: 2, origin: "app://nomi", decision: "accept" });
    const minted = authority.mintReceipt(pending.token, attestation);
    const consumed = authority.consumeReceipt(minted.token);
    expect(consumed.replayed).toBe(false);
    const replayed = authority.consumeReceipt(minted.token);
    expect(replayed).toEqual({ receipt: consumed.receipt, replayed: true } satisfies ReceiptReplayResult);

    const restarted = createApprovalReceiptAuthority({ filePath: authority.filePath, macKey: "receipt-authority-key", storeMacKey: "receipt-store-key", keyId: "receipt-v1", now });
    expect(restarted.consumeReceipt(minted.token)).toEqual({ receipt: consumed.receipt, replayed: true });
  });

  it("rejects wrong challenge, reject gestures, forged booleans and expired challenges", () => {
    const { authority, advance } = makeAuthority();
    const pending = challenge(authority, 5_000);
    expect(() => authority.mintReceipt(pending.token, authority.createMainProcessGestureAttestation(pending.token, {
      webContentsId: 10, frameId: 2, origin: "app://nomi", decision: "accept", challengeId: "wrong",
    }))).toThrow(HumanApprovalRequiredError);
    expect(() => authority.mintReceipt(pending.token, authority.createMainProcessGestureAttestation(pending.token, {
      webContentsId: 10, frameId: 2, origin: "app://nomi", decision: "reject",
    }))).toThrow(HumanApprovalRequiredError);
    expect(() => authority.mintReceipt(pending.token, { approved: true })).toThrow(HumanApprovalRequiredError);
    advance(6);
    expect(() => authority.verifyChallenge(pending.token)).toThrow(ReceiptExpiredError);
  });

  it("mints a receipt via client_elicitation attestation and records correct humanActor", () => {
    const { authority } = makeAuthority();
    const pending = challenge(authority);
    const attestation = authority.createClientElicitationAttestation(pending.token, "codex");
    expect(attestation.kind).toBe("client_elicitation");
    expect(attestation.authenticatedClient).toBe("codex");
    expect(attestation.decision).toBe("accept");
    expect(attestation.issuer).toBe("nomi-main");
    const minted = authority.mintReceipt(pending.token, attestation);
    expect(minted.receipt.humanActor).toBe("mcp_client:codex");
    expect(minted.receipt.gestureAttestation).toMatchObject({ kind: "client_elicitation", authenticatedClient: "codex" });
    expect(minted.receipt.receiptId).toBeTruthy();
    // Downstream verifiers still accept this receipt
    expect(() => authority.verifyReceipt(minted.token)).not.toThrow();
  });

  it("replays client_elicitation receipt idempotently on the same challenge", () => {
    const { authority } = makeAuthority();
    const pending = challenge(authority);
    const first = authority.mintReceipt(pending.token, authority.createClientElicitationAttestation(pending.token, "claude"));
    const second = authority.mintReceipt(pending.token, authority.createClientElicitationAttestation(pending.token, "claude"));
    expect(first.receipt.receiptId).toBe(second.receipt.receiptId);
  });

  it("rejects client_elicitation attestation with empty authenticatedClient", () => {
    const { authority } = makeAuthority();
    const pending = challenge(authority);
    expect(() => authority.createClientElicitationAttestation(pending.token, "")).toThrow();
    expect(() => authority.createClientElicitationAttestation(pending.token, "  ")).toThrow();
  });

  it("rejects client_elicitation attestation with tampered mac", () => {
    const { authority } = makeAuthority();
    const pending = challenge(authority);
    const attestation = authority.createClientElicitationAttestation(pending.token, "codex");
    const tampered = { ...attestation, authenticatedClient: "evil-client" };
    expect(() => authority.mintReceipt(pending.token, tampered)).toThrow(HumanApprovalRequiredError);
  });
});
