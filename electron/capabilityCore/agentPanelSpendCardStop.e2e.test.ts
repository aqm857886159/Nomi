import { afterEach, describe, expect, it } from "vitest";

import { describeGenerateOutcome } from "../shared/agentLane/generateOutcomeReceipt";
import { currentPresentation, generationPresentationOutcome } from "../shared/productionGenerationPresentation";
import { withdrawStalePresentations } from "../productionRun/stalePresentationSweep";
import { OPERATION_ID, PROJECT_ID, lease, now, resetSpendFixture, settleMicrotasks, shotsDraft, spendWorld, watchCardForTurn } from "./agentPanelSpendConfirmTestUtils";

// 交到一半停下来（D2 第③步：设计卡 §一「半路上」那张表）。一条规矩贯穿每一格：**关了之后，还没交出去的不再交；已经在交的照常
// 交完，照实算「交出去了」**。线性化点只有一个——账本：出价一关（不管是「取消」、回合被停、用户打了字、窗口没了、重启清扫、
// 被下一次出价顶掉），还没绑上画布的那几笔当场记成收回，绑上了还没轮到的由账本的变更订阅当场收回同意；派发那一侧只认账本，
// 落定了的交接不许再派。卡上回的「发出了 K 段、没发 M 段」读的也是这一份。「取消」从不排队：它要的就是能打断。

afterEach(resetSpendFixture);

/** 把供应商那一头扣住：交的那一下停在供应商门口，直到放行。 */
function holdVendor(world: ReturnType<typeof spendWorld>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = world.vendor.answer;
  world.vendor.answer = async (call) => { await gate; return original(call); };
  return release;
}

describe("「取消」打断交接", () => {
  it("三镜都还在排队（同意开好了、一镜都没轮到）：取消 → 一镜不发，回「发出了 0 段，3 段没发」；回执说三镜都没生成、没花钱", async () => {
    const world = spendWorld({ holdDispatch: true });
    await shotsDraft(world);
    await world.generate();
    expect(world.pending()!.shots.map((shot) => shot.offer), "三镜都在交接中").toEqual(["handing_over", "handing_over", "handing_over"]);
    expect(await world.cancel()).toEqual({ ok: true, code: "discarded", batchStopped: { sent: 0, notSent: 3 } });
    world.renderer.releaseDispatch();
    await world.renderer.drain();
    expect(world.vendor.executes, "收回的同意一个都交不出去").toEqual([]);
    const outcome = generationPresentationOutcome(world.run())!;
    expect(outcome.undecided.map((entry) => [entry.shotId, entry.reason])).toEqual([["shot-1", "user_closed"], ["shot-2", "user_closed"], ["shot-3", "user_closed"]]);
    expect(describeGenerateOutcome(outcome).userSees).toContain("Not generated and nothing spent");
  });

  it("第 1 镜正交到供应商门口、2 / 3 还在排队：取消 → 第 1 镜照常交完、算交出去了；2 / 3 不发；卡回「发出了 1 段，2 段没发」", async () => {
    const world = spendWorld();
    await shotsDraft(world);
    const release = holdVendor(world);
    await world.generate();
    await settleMicrotasks();
    expect(world.vendor.executes, "第 1 镜已经递到供应商手里").toHaveLength(1);
    expect(await world.cancel()).toEqual({ ok: true, code: "discarded", batchStopped: { sent: 1, notSent: 2 } });
    release();
    await world.renderer.drain();
    expect(world.sentShots()).toEqual(["shot-1"]);
    expect(world.renderer.dispatchErrors, "2 / 3 轮到时被账本挡回").toHaveLength(2);
    const outcome = generationPresentationOutcome(world.run())!;
    expect(outcome.generating).toEqual(["shot-1"]);
    expect(outcome.undecided.map((entry) => entry.shotId)).toEqual(["shot-2", "shot-3"]);
  });

  it("三镜都已经交到了，取消才到：卡早就自己关了；取消如实回「发出了 3 段、0 段没发」（卡上据此不说「已停止」）", async () => {
    const world = spendWorld();
    await shotsDraft(world);
    const shown = world.pending()!;
    await world.generate(undefined, shown);
    await world.renderer.drain();
    expect(world.pending()).toBeUndefined();
    expect(await world.cancel(shown)).toEqual({ ok: true, code: "discarded", batchStopped: { sent: 3, notSent: 0 } });
  });

  it("× 晚到、落在「记了决定、还没绑上画布」那一段：绑不上，刚开的同意全部收回，一镜不发；回 0 段发出", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    const shown = world.pending()!;
    let cancelled: unknown;
    world.renderer.setBeforeConsent(async () => { cancelled = await world.cancel(shown); });
    await world.generate(undefined, shown);
    await world.renderer.drain();
    expect(cancelled).toEqual({ ok: true, code: "discarded", batchStopped: { sent: 0, notSent: 2 } });
    expect(world.vendor.executes).toEqual([]);
    const handOvers = currentPresentation(world.run().generationPlan)!.handOvers!;
    expect(handOvers.map((entry) => entry.settled?.outcome)).toEqual(["withdrawn", "withdrawn"]);
  });

  it("「取消」连点两下：第二下不报错，回的还是那一次出价的结局", async () => {
    const world = spendWorld({ holdDispatch: true });
    await shotsDraft(world, [{}]);
    const shown = world.pending()!;
    await world.generate(undefined, shown);
    const [first, second] = await Promise.all([world.cancel(shown), world.cancel(shown)]);
    expect(first).toEqual({ ok: true, code: "discarded", batchStopped: { sent: 0, notSent: 1 } });
    expect(second).toEqual(first);
  });
});

describe("别的路关掉这一次出价，一样收", () => {
  it("用户在面板里打了字（回合收回出价）：在交的那一镜照常交完、回执里算在生成；排队的不发", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    const release = holdVendor(world);
    await world.generate();
    await settleMicrotasks();
    await world.operations.withdraw(PROJECT_ID, OPERATION_ID, now(), "user_wrote");
    release();
    await world.renderer.drain();
    expect(world.sentShots()).toEqual(["shot-1"]);
    const outcome = generationPresentationOutcome(world.run())!;
    expect(outcome.closedBy).toBe("user_wrote");
    expect(outcome.generating).toEqual(["shot-1"]);
    expect(outcome.undecided.map((entry) => [entry.shotId, entry.reason])).toEqual([["shot-2", "user_wrote"]]);
  });

  it("窗口没了（发起的窗口释放）：还没轮到的同意收回、记成没发出去（卡回来时可以「再试一次」）；一镜不发", async () => {
    const world = spendWorld({ holdDispatch: true });
    await shotsDraft(world, [{}, {}]);
    await world.generate();
    world.canvas.runs.releaseSender(world.canvas.senderId);
    world.renderer.releaseDispatch();
    await world.renderer.drain();
    expect(world.vendor.executes).toEqual([]);
    expect(world.pending()!.shots.map((shot) => [shot.shotId, shot.offer])).toEqual([["shot-1", "not_sent"], ["shot-2", "not_sent"]]);
  });

  // 2026-10-27 拍板：不点名的再出价只重摆最近一张卡上还没定的镜——两镜都在交时不点名会被拒（`mcpGenerationShotScope.e2e.test.ts` A2 变体守）。
  // 这一条守的是「被顶掉」本身，所以 Agent 点名再出价（以前写的是不点名、靠旧默认「整份再摆」走到这里）。
  it("Agent 在交的半路上点名又出了一次价（被顶掉）：上一次排队的同意收回，一镜不发；新的一张卡上两镜都在等决定", async () => {
    const world = spendWorld({ holdDispatch: true });
    await shotsDraft(world, [{}, {}]);
    await world.generate();
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID, shotIds: ["shot-1", "shot-2"] }, lease });
    world.renderer.releaseDispatch();
    await world.renderer.drain();
    expect(world.vendor.executes).toEqual([]);
    const presentations = world.run().generationPlan!.presentations!;
    expect(presentations.at(-2)!.closed?.by).toBe("stopped");
    expect(presentations.at(-2)!.handOvers!.every((entry) => entry.settled?.outcome === "withdrawn"), "被顶掉的那一次出价里的交接各自落定").toBe(true);
    expect(world.pending()!.shots.map((shot) => shot.offer)).toEqual(["undecided", "undecided"]);
  });

  it("交到一半被点名重新出价顶掉：在交的那一镜照样把结论写回它自己那一笔（不停在「还在交」）", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}]);
    const release = holdVendor(world);
    await world.generate();
    await settleMicrotasks();
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID, shotIds: ["shot-1"] }, lease });
    release();
    await world.renderer.drain();
    const superseded = world.run().generationPlan!.presentations!.at(-2)!;
    expect(superseded.handOvers![0].settled?.outcome).toBe("accepted");
    expect(world.vendor.executes).toHaveLength(1);
  });

  it("重启：上一个进程开着的出价收回（不出卡），排队的同意随之收回；打开项目的孤儿回收之后也一镜不发", async () => {
    const world = spendWorld({ holdDispatch: true });
    await shotsDraft(world, [{}, {}]);
    await world.generate();
    const presentedAt = currentPresentation(world.run().generationPlan)!.openedAt;
    const later = new Date(Date.parse(presentedAt) + 1000).toISOString();
    const withdrawn = await withdrawStalePresentations({
      listRuns: (projectId) => world.repository.list(projectId).map((summary) => world.repository.read(projectId, summary.runId)!),
      withdraw: (projectId, operationId, at, reason) => world.operations.withdraw(projectId, operationId, at, reason),
      processStartedAt: later, now,
    }, PROJECT_ID);
    expect(withdrawn).toEqual([OPERATION_ID]);
    expect(world.pending(), "重启后不出卡").toBeUndefined();
    world.canvas.runs.recoverOrphans(PROJECT_ID);
    world.renderer.releaseDispatch();
    await world.renderer.drain();
    expect(world.vendor.executes).toEqual([]);
    expect(currentPresentation(world.run().generationPlan)!.closed?.by).toBe("stopped");
  });
});

describe("回合等的是这一次出价真的落定", () => {
  it("取消时第 1 镜还在交：回合等它交完才读结局（不在派发半路上报「在生成」）", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    const release = holdVendor(world);
    const turn = watchCardForTurn(world);
    await world.generate();
    await settleMicrotasks();
    await world.cancel();
    await settleMicrotasks();
    expect(turn.closed(), "出价关了，但第 1 镜还在交：回合接着等").toBe(false);
    release();
    await world.renderer.drain();
    await settleMicrotasks();
    expect(turn.closed(), "交到了，回合醒来").toBe(true);
    turn.dispose();
  });

  it("旧卡身份被挡回去 / 去掉一镜：都不是关卡，回合接着等；计划被删：回合醒来", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    const turn = watchCardForTurn(world);
    expect(await world.card.handOverShots({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: "stale", shotIds: ["shot-1"] })).toMatchObject({ ok: false });
    await world.remove("shot-1");
    await settleMicrotasks();
    expect(turn.closed()).toBe(false);
    await world.operations.cancel(PROJECT_ID, OPERATION_ID, now());
    await settleMicrotasks();
    expect(world.pending()).toBeUndefined();
    expect(turn.closed()).toBe(true);
    turn.dispose();
  });
});
