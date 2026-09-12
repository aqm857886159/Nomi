import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HumanApprovalRequiredError,
  ReceiptExpiredError,
  ReceiptReplayResult,
  ReceiptScopeError,
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

/**
 * 「全自动」档那次**没有人点**的放行（2026-09-12 用户拍板）。
 *
 * 这一组守的是「免卡 ≠ 免账」：卡不出了，但封印、签名、一次性、可验证一样都不少，
 * 而且账本上一眼看得出这一笔是**策略**批的，不是编了一个人出来。
 */
describe("policy_decision attestation（全自动档的免卡放行）", () => {
  it("铸得出、验得过，收据写着 policy:full_auto 而不是一个假的人", () => {
    const { authority } = makeAuthority();
    const pending = challenge(authority);
    const attestation = authority.createPolicyDecisionAttestation(pending.token, {
      policyMode: "project",
      policySurface: "agent-lane",
    });
    const minted = authority.mintReceipt(pending.token, attestation);
    expect(minted.receipt.decidedBy).toBe("policy:full_auto");
    expect(minted.receipt.humanActor).toBe("policy:project:agent-lane");
    expect(minted.receipt.gestureAttestation.kind).toBe("policy_decision");
    // 验证走的是同一条路：签名、受众、一次性都照旧。
    expect(authority.verifyReceipt(minted.token)).toEqual(minted.receipt);
    expect(authority.consumeReceipt(minted.token).replayed).toBe(false);
    expect(authority.consumeReceipt(minted.token).replayed).toBe(true);
  });

  it("人点的那条仍然写 human:gesture——两种来源在账本上分得开", () => {
    const { authority } = makeAuthority();
    const pending = challenge(authority);
    const minted = authority.mintReceipt(pending.token, authority.createMainProcessGestureAttestation(pending.token, {
      webContentsId: 10, frameId: 2, origin: "app://nomi", decision: "accept",
    }));
    expect(minted.receipt.decidedBy).toBe("human:gesture");
  });

  it("只有「全自动」铸得出：别的档位当场抛，「把某一档偷偷当成全自动」在这一层走不通", () => {
    const { authority } = makeAuthority();
    const pending = challenge(authority);
    for (const policyMode of ["step", "safe-auto", ""] as const) {
      expect(() => authority.createPolicyDecisionAttestation(pending.token, {
        policyMode: policyMode as "project", policySurface: "agent-lane",
      })).toThrow(ReceiptScopeError);
    }
    // 没说是哪个宿主面按策略代答的，也不给铸——账本要答得出「谁批的」。
    expect(() => authority.createPolicyDecisionAttestation(pending.token, { policyMode: "project", policySurface: "  " }))
      .toThrow(ReceiptScopeError);
  });

  it("调用方伪造不出来：手搓一份 policy_decision 过不了签名", () => {
    const { authority } = makeAuthority();
    const pending = challenge(authority);
    const real = authority.createPolicyDecisionAttestation(pending.token, { policyMode: "project", policySurface: "agent-lane" });
    // ① 整份现编。
    expect(() => authority.mintReceipt(pending.token, {
      ...real, mac: "not-the-real-mac",
    })).toThrow(HumanApprovalRequiredError);
    // ② 拿真签名改字段（把宿主面改成别的）——MAC 覆盖了它，照样不认。
    expect(() => authority.mintReceipt(pending.token, { ...real, policySurface: "somewhere-else" }))
      .toThrow(HumanApprovalRequiredError);
    // ③ 把档位改成别的：verify 也 fail-closed。
    expect(() => authority.mintReceipt(pending.token, { ...real, policyMode: "safe-auto" }))
      .toThrow(HumanApprovalRequiredError);
    // ④ 一个光秃秃的「策略同意了」对象。
    expect(() => authority.mintReceipt(pending.token, { kind: "policy_decision", decision: "accept" }))
      .toThrow(HumanApprovalRequiredError);
  });

  it("过期的挑战不因为「是策略批的」就多活一秒", () => {
    const { authority, advance } = makeAuthority();
    const pending = challenge(authority, 5_000);
    const attestation = authority.createPolicyDecisionAttestation(pending.token, { policyMode: "project", policySurface: "agent-lane" });
    advance(10);
    expect(() => authority.mintReceipt(pending.token, attestation)).toThrow(ReceiptExpiredError);
  });
});
