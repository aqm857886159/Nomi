// 特征测试（direction-check，docs/plan/2026-10-10-spend-arbiter.md）：同一张卡上「生成这张」与 × 交错的四个落点。
//
// 真链路、零额度（真 Run 账本 / 封印 / 收据 / 决门，供应商是本机 loopback）。只钉住现状，不修：
// 不变式（任务书）是「用户点 × 之后，还没交给供应商的一律不再交；× 回给卡的话、Agent 的回执、账本读到的是同一个终态」。
// 现状违反这条的落点用 `it.fails` 标成已知失败——仲裁器落地后它们转绿，`it.fails` 会反过来红，提醒把标记换成 `it`。
import { afterEach, describe, expect, it } from "vitest";
import { generationPresentationOutcome } from "../shared/productionGenerationPresentation";
import { waitForProduction } from "../productionRun/productionRunTestHelpers";
import {
  PROJECT_ID, OPERATION_ID, startLoopbackVendor, harness, buildActions, resetSpendFixture, advanceClock, draft, watchCardForTurn, settleMicrotasks,
} from "./agentPanelSpendConfirmTestUtils";

afterEach(resetSpendFixture);

const TARGET = { projectId: PROJECT_ID, operationId: OPERATION_ID } as const;
type Spot = "before_admit" | "admitted_before_gate" | "gated_before_authorize" | "during_dispatch" | "after_settled";

/** 跑一次交错：× 落在 spot 指定的那一步，返回现场所有「说结局」的地方读到的东西。 */
async function race(spot: Spot) {
  const vendor = await startLoopbackVendor();
  const base = harness();
  const submits: string[] = [];
  let discarding: Promise<unknown> | undefined;
  const discardNow = async (quoteId: string) => {
    discarding = built.withWindow.discardPendingSpend({ ...TARGET, quoteId });
    // × 的第一步（收回出价）一落账，卡就关了；不在这一下动作里等 discard 本身（它要等队里的动作落定，等就死锁）。
    await waitForProduction(() => built.withWindow.listPendingSpend(PROJECT_ID).length === 0);
  };
  let quoteId = "";
  const built = buildActions(base, vendor.origin, submits, {
    ...(spot === "admitted_before_gate" ? { beforeGate: () => discardNow(quoteId) } : {}),
    ...(spot === "gated_before_authorize" ? { beforeAuthorize: () => discardNow(quoteId) } : {}),
    ...(spot === "during_dispatch" ? { afterAuthorize: () => discardNow(quoteId) } : {}),
  });
  try {
    await draft(base);
    const turn = watchCardForTurn(base);
    quoteId = built.withWindow.listPendingSpend(PROJECT_ID)[0].quoteId;
    advanceClock(1000);
    let confirm: Promise<unknown>;
    if (spot === "before_admit") {
      // 两个动作挨着发出去（真人在同一帧里点了「生成这张」又点 ×）：× 的收回先落账。
      confirm = built.withWindow.confirmPendingSpend({ ...TARGET, quoteId });
      discarding = built.withWindow.discardPendingSpend({ ...TARGET, quoteId });
    } else if (spot === "after_settled") {
      confirm = built.withWindow.confirmPendingSpend({ ...TARGET, quoteId });
      await confirm;
      discarding = built.withWindow.discardPendingSpend({ ...TARGET, quoteId });
    } else {
      confirm = built.withWindow.confirmPendingSpend({ ...TARGET, quoteId });
    }
    const confirmResult = await confirm.catch((error) => ({ threw: String(error) }));
    const discardResult = await discarding;
    await settleMicrotasks();
    const run = base.repository.read(PROJECT_ID, OPERATION_ID)!;
    const outcome = generationPresentationOutcome(run);
    const result = {
      confirmResult, discardResult, submits: submits.length,
      cardClosed: built.withWindow.listPendingSpend(PROJECT_ID).length === 0,
      laneSawClosed: turn.closed(), outcome,
    };
    turn.dispose();    return result;
  } finally {
    await vendor.close();
  }
}

/** 三方一致：× 回给卡的那一句、账本里的结局、供应商真的收到的，说的是同一件事。 */
function expectOneTruth(r: Awaited<ReturnType<typeof race>>) {
  const sentToVendor = r.submits;
  expect(r.cardClosed, "卡关了").toBe(true);
  expect(r.laneSawClosed, "Agent 回合收到了「卡关了」").toBe(true);
  expect(r.outcome?.generating.length, "账本说发出去几镜 = 供应商收到几镜").toBe(sentToVendor);
  expect((r.discardResult as { batchStopped?: { sent: number } }).batchStopped?.sent ?? 0, "× 回给卡的话 = 供应商收到几镜").toBe(sentToVendor);
}

describe("特征：生成这张 × 交错（现状）", () => {
  it("落点 1 · × 紧跟确认到达（admit 前）：一镜都不发，卡、账本、Agent 回合一致", async () => {
    const r = await race("before_admit");
    expect(r.submits).toBe(0);
    expectOneTruth(r);
  });

  // 已知失败：admit 之后、封印开门之前收回出价，没有门可撤；这一镜随后照样被批下、发出（10-02 X2 / X4 同形）。界面已经「停止」。
  it.fails("落点 2 · admit 之后、封印开门之前：用户已点 ×，这一镜不该再交给供应商", async () => {
    const r = await race("admitted_before_gate");
    expect(r.submits, "× 之后没交出去的不再交").toBe(0);
    expectOneTruth(r);
  });

  // 现状已经对：封印过的门被收回时一并撤掉，授权随后被拒，一镜不发。钉住它，别让仲裁器改坏。
  it("落点 3 · 封印之后、授权派发之前：用户已点 ×，这一镜不该再交给供应商", async () => {
    const r = await race("gated_before_authorize");
    expect(r.submits, "× 之后没交出去的不再交").toBe(0);
    expectOneTruth(r);
  });

  // 已知失败：派发（授权与开跑在宿主里是一步）已交给供应商，× 随后到：该如实回 ok + sent=1，现状回 ok:false「no pending generation to discard」。
  it.fails("落点 4 · 派发之后（确认还没返回）：已交给供应商的不能撤，× 如实说 sent=1，三方一致", async () => {
    const r = await race("during_dispatch");
    expect(r.submits).toBe(1);
    expect(r.discardResult).toMatchObject({ ok: true, batchStopped: { sent: 1 } });
    expectOneTruth(r);
  });

  // 已知失败：同上，确认已经返回、卡已关之后的 ×（迟到的第二下）。
  it.fails("落点 5 · 确认已落定之后迟到的 ×：如实说 sent=1，不报错", async () => {
    const r = await race("after_settled");
    expect(r.submits).toBe(1);
    expect(r.discardResult).toMatchObject({ ok: true, batchStopped: { sent: 1 } });
    expectOneTruth(r);
  });
});
