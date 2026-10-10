// 花钱卡「生成这张」与 × 交错的五个落点（docs/plan/2026-10-10-spend-arbiter.md）。
//
// 真链路、零额度（真 Run 账本 / 封印 / 收据 / 决门，供应商是本机 loopback）。不变式：每一镜最终只有一个终态；
// 用户点 × 之后还没交给供应商的一律不再交；卡、× 回给卡的话、Agent 回合、账本说的是同一件事。
// 仲裁器落地前这里的落点 2 / 4 / 5 是已知失败（`it.fails` 钉住现状，见该文档 §2 的现状表）。
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
      waitingGates: run.gates.filter((gate) => gate.scope === "budget_envelope" && gate.status === "waiting").length,
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

describe("确认与 × 交错：每一镜只有一个终态，× 之后没交出去的不再交", () => {
  it("落点 1 · × 紧跟确认到达（admit 前）：一镜都不发，卡、账本、Agent 回合一致", async () => {
    const r = await race("before_admit");
    expect(r.submits).toBe(0);
    expectOneTruth(r);
  });

  it("落点 2 · admit 之后、封印开门之前：用户已点 ×，这一镜不再交给供应商，也不留一道等人的门", async () => {
    const r = await race("admitted_before_gate");
    expect(r.submits, "× 之后没交出去的不再交").toBe(0);
    expect(r.waitingGates, "× 收回之后才封上的门被撤掉").toBe(0);
    expectOneTruth(r);
  });

  it("落点 3 · 封印之后、授权派发之前：封印过的门被一并撤掉，授权被拒，一镜不发", async () => {
    const r = await race("gated_before_authorize");
    expect(r.submits, "× 之后没交出去的不再交").toBe(0);
    expectOneTruth(r);
  });

  // 「交」的分界是授权落账：门批下来这一镜在账本里就是「正在生成」，派发是承诺。× 来晚了如实说已发出，不报错。
  it("落点 4 · 授权落账之后、派发之前：已交的不能撤，× 如实说 sent=1，三方一致", async () => {
    const r = await race("during_dispatch");
    expect(r.submits).toBe(1);
    expect(r.discardResult).toMatchObject({ ok: true, batchStopped: { sent: 1 } });
    expectOneTruth(r);
  });

  it("落点 5 · 确认已落定之后迟到的 ×：如实说 sent=1，不报错", async () => {
    const r = await race("after_settled");
    expect(r.submits).toBe(1);
    expect(r.discardResult).toMatchObject({ ok: true, batchStopped: { sent: 1 } });
    expectOneTruth(r);
  });
});

describe("确认与改参数交错：同一个队，只有一个终态，报价不半新半旧", () => {
  const REVISE = { parameters: { size: "1536x1024" } } as const;

  it("确认进行中来了改参数：改排在确认后面；确认发的是改之前那一版，改读不到可改的出价（只有一个终态）", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const inGate = new Promise<void>((resolve) => { entered = resolve; });
    const built = buildActions(base, vendor.origin, submits, { beforeGate: async () => { entered(); await gate; } });
    try {
      await draft(base);
      const quote = built.withWindow.listPendingSpend(PROJECT_ID)[0];
      advanceClock(1000);
      const confirming = built.withWindow.confirmPendingSpend({ ...TARGET, quoteId: quote.quoteId });
      await inGate;
      const revising = built.withWindow.revisePendingSpend({ ...TARGET, quoteId: quote.quoteId, patch: REVISE });
      release();
      const [confirmed, revised] = await Promise.all([confirming, revising]);
      expect(confirmed).toMatchObject({ ok: true });
      expect(revised.ok, "改排在确认后面，出价已决，改不动").toBe(false);
      expect(submits).toHaveLength(1);
      expect(JSON.stringify(vendor.bodies[0]), "发出去的是改之前那一版").not.toContain("1536");
    } finally { release(); await vendor.close(); }
  });

  it("改参数进行中来了确认：确认排在后面，用旧报价被拒、一镜不发；用改后的报价再确认，发的是改后那一版", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const built = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);
      const quote = built.withWindow.listPendingSpend(PROJECT_ID)[0];
      advanceClock(1000);
      const revising = built.withWindow.revisePendingSpend({ ...TARGET, quoteId: quote.quoteId, patch: REVISE });
      const staleConfirm = built.withWindow.confirmPendingSpend({ ...TARGET, quoteId: quote.quoteId });
      const [revised, stale] = await Promise.all([revising, staleConfirm]);
      expect(revised).toMatchObject({ ok: true, code: "revised" });
      expect(stale, "旧报价的确认在改之后被拒，不会拿半新半旧去批").toMatchObject({ ok: false });
      expect(submits, "被拒的确认一镜不发").toHaveLength(0);
      advanceClock(1000);
      const fresh = (revised as { quoteId: string }).quoteId;
      expect(await built.withWindow.confirmPendingSpend({ ...TARGET, quoteId: fresh })).toMatchObject({ ok: true });
      expect(submits).toHaveLength(1);
      expect(JSON.stringify(vendor.bodies[0]), "发的是改后那一版").toContain("1536");
    } finally { await vendor.close(); }
  });
});
