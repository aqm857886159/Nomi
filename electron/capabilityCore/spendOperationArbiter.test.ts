import { describe, expect, it } from "vitest";
import { spendCancelRequested, cardActionsSettled, registerCancel, sealedOutcome, serializeCardAction } from "./spendOperationArbiter";

describe("spendOperationArbiter", () => {
  it("队：同一次出价的动作一个接一个跑，前一个失败不卡住后一个；不同出价互不影响", async () => {
    const order: string[] = [];
    const first = serializeCardAction("p", "op-q", async () => { await new Promise((r) => setTimeout(r, 20)); order.push("a"); throw new Error("boom"); });
    const second = serializeCardAction("p", "op-q", async () => { order.push("b"); return 2; });
    const other = serializeCardAction("p", "op-other", async () => { order.push("o"); });
    await expect(first).rejects.toThrow("boom");
    expect(await second).toBe(2);
    await other;
    expect(order).toEqual(["o", "a", "b"]);
  });

  it("取消令牌：登记是同步的，释放后消失，可嵌套（两个 × 各登记各释放）", () => {
    expect(spendCancelRequested("p", "op-c")).toBe(false);
    const one = registerCancel("p", "op-c");
    const two = registerCancel("p", "op-c");
    expect(spendCancelRequested("p", "op-c")).toBe(true);
    one(); one();
    expect(spendCancelRequested("p", "op-c"), "第二个 × 还没说完").toBe(true);
    two();
    expect(spendCancelRequested("p", "op-c")).toBe(false);
    expect(spendCancelRequested("p", "other-op"), "别的出价不受影响").toBe(false);
  });

  it("封存终态：先等队里的动作落定，再读", async () => {
    let written = "before";
    void serializeCardAction("p", "op-s", async () => { await new Promise((r) => setTimeout(r, 20)); written = "after"; });
    expect(await sealedOutcome("p", "op-s", () => written)).toBe("after");
    await cardActionsSettled("p", "op-s");
  });
});
