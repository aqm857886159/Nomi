import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { ReceiptScopeError, createApprovalReceiptAuthority } from "./approvalReceipt";

// 主进程这一次受信调用本身就是手势时（画布 ↑、批量卡确认之后的派发），收据一次读、一次写完（发动机收敛第一刀第 3 步的
// 性能尾巴：以前「挑战 → 签证 → 铸 → 验 → 用掉」是五次整份读写）。批的仍是同一份东西：收据逐字绑挑战，记成已用掉，
// 同一份授权重来一次拿回同一张收据。

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

function authority() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-receipt-gesture-"));
  dirs.push(dir);
  const filePath = path.join(dir, "receipts.json");
  return { filePath, receipts: createApprovalReceiptAuthority({ filePath, macKey: "k", storeMacKey: "s", keyId: "v1" }) };
}

const challenge = (key: string) => ({
  challengeKey: key, immutableProjectUuid: "u", projectGeneration: 1, projectId: "p", runId: "canvas-run-1",
  gateId: "gate-1", contractHash: "h", targetHash: "h", projectRevision: 0, costScope: "generation.single-shot:canvas-run-1", pricingSnapshotHash: "h",
  reservationPreview: { currency: "CNY", maximum: 0 },
});
const gesture = { webContentsId: 7, frameId: 1, origin: "app://nomi" };

it("one write: the receipt is bound to its challenge, decided by this window's gesture, and already consumed", () => {
  const { filePath, receipts } = authority();
  const writes = vi.spyOn(fs, "renameSync");

  const receipt = receipts.issueGestureReceipt(challenge("k1"), gesture);

  expect(writes).toHaveBeenCalledTimes(1);
  expect(receipt).toMatchObject({ runId: "canvas-run-1", gateId: "gate-1", contractHash: "h", decidedBy: "human:gesture", humanActor: "web_contents:7:1:app://nomi" });
  const token = receipts.resolveReceiptToken(receipt.receiptId);
  expect(receipts.verifyReceipt(token)).toEqual(receipt);
  expect(receipts.consumeReceipt(token)).toMatchObject({ replayed: true });
  const state = JSON.parse(fs.readFileSync(filePath, "utf8")) as { challenges: Record<string, { status: string }> };
  expect(Object.values(state.challenges).map((record) => record.status)).toEqual(["accepted"]);
});

it("the same authorization asked twice gets the same receipt; a different binding under the same key is refused", () => {
  const { receipts } = authority();
  const first = receipts.issueGestureReceipt(challenge("k1"), gesture);
  expect(receipts.issueGestureReceipt(challenge("k1"), gesture)).toEqual(first);
  expect(() => receipts.issueGestureReceipt({ ...challenge("k1"), contractHash: "other", targetHash: "other", pricingSnapshotHash: "other" }, gesture)).toThrow(ReceiptScopeError);
});

it("an incomplete binding mints nothing", () => {
  const { filePath, receipts } = authority();
  expect(() => receipts.issueGestureReceipt({ ...challenge("k1"), gateId: "" }, gesture)).toThrow(ReceiptScopeError);
  expect(fs.existsSync(filePath)).toBe(false);
});
