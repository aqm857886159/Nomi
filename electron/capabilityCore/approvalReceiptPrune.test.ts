import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

import { ReceiptExpiredError, createApprovalReceiptAuthority } from "./approvalReceipt";

// 收据库不随批准次数无限变大（发动机收敛第一刀：画布每点一次 ↑ 铸一张收据）。过期已久的挑战与收据被拿掉；
// 它们的令牌本来就验不过（先判过期），拿掉以后照样是「过期」，不会变成能用。

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function approve(authority: ReturnType<typeof createApprovalReceiptAuthority>, index: number) {
  const challenge = authority.requestChallenge({
    challengeKey: `canvas:${index}`, immutableProjectUuid: "u", projectGeneration: 1, projectId: "p", runId: `canvas-run-${index}`,
    gateId: `gate-${index}`, contractHash: "h", targetHash: "h", projectRevision: 0, costScope: "generation.single-shot", pricingSnapshotHash: "h",
    reservationPreview: { currency: "CNY", maximum: 0 },
  });
  const attestation = authority.createMainProcessGestureAttestation(challenge.token, { webContentsId: 1, frameId: 1, origin: "app://nomi", decision: "accept" });
  const minted = authority.mintReceipt(challenge.token, attestation);
  authority.consumeReceipt(minted.token);
  return minted.token;
}

it("过期已久的挑战与收据被拿掉：库的大小只跟最近一段时间的批准有关", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-receipt-prune-"));
  dirs.push(dir);
  let clock = Date.parse("2026-10-05T00:00:00.000Z");
  const filePath = path.join(dir, "receipts.json");
  const authority = createApprovalReceiptAuthority({ filePath, macKey: "k", storeMacKey: "s", keyId: "v1", now: () => new Date(clock).toISOString() });

  const first = approve(authority, 0);
  for (let index = 1; index <= 60; index += 1) {
    clock += 60_000;
    approve(authority, index);
  }

  const state = JSON.parse(fs.readFileSync(filePath, "utf8")) as { challenges: Record<string, unknown>; receipts: Record<string, unknown> };
  // 5 分钟有效 + 1 分钟留存：一分钟一次，库里最多留下最近 7 次左右。
  expect(Object.keys(state.receipts).length).toBeLessThanOrEqual(8);
  expect(Object.keys(state.challenges).length).toBeLessThanOrEqual(8);
  expect(() => authority.verifyReceipt(first)).toThrow(ReceiptExpiredError);
});
