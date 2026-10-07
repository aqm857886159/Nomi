// 付费卡逐镜：「点了的生成，去掉的不生成」（2026-09-30，用户拍板；方案 docs/plan/2026-09-30-paid-card-per-shot.md）。
//
// 真链路、零额度：真 Run 账本、真封印 / 收据 / 决门、真批次调度器，只有供应商是本机 loopback HTTP。
// 每一条都对着测试表的一行：卡上点的是哪一镜，供应商就只收到那一镜；没点的留在卡上等人，不悄悄消失。
import { afterEach, describe, expect, it } from "vitest";

import { generationPresentationOutcome } from "../shared/productionGenerationPresentation";
import {
  PROJECT_ID, OPERATION_ID, now, candidate, startLoopbackVendor, harness, buildActions, callTool, resetSpendFixture, advanceClock,
  imageDraft, shotsSent, watchCardForTurn, settleMicrotasks,
} from "./agentPanelSpendConfirmTestUtils";

afterEach(resetSpendFixture);

/** 供应商收到了哪几镜（请求体不用看：哪一镜由幂等键里的 shotId 认）。 */
function promptsSent(_bodies: ReadonlyArray<Record<string, unknown>>, submits: readonly string[]): readonly string[] {
  return shotsSent(submits);
}

type PerShotActions = ReturnType<typeof buildActions>["withWindow"] & {
  removePendingSpendShot?: (input: { projectId: string; operationId: string; quoteId: string; shotId: string }) => Promise<{ ok: boolean }>;
};

describe("付费卡逐镜：点了的生成，去掉的不生成", () => {
  it("第 1 页点「生成这张」：供应商只收到第 1 张；卡还在，只剩第 2 张；回合还在等（没有告诉 Agent 都开始了）", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow, handler } = buildActions(base, vendor.origin, submits);
    let turn: ReturnType<typeof watchCardForTurn> | undefined;
    try {
      await imageDraft(base, handler);
      // 回合那一侧看的是账本里这一次出价开没开着（生产里 = laneDesktopSpend.whenCardCloses）。
      turn = watchCardForTurn(base);
      const card = withWindow.listPendingSpend(PROJECT_ID)[0];
      expect(card.shots.map((shot) => shot.shotId)).toEqual(["shot-1", "shot-2"]);
      advanceClock(1000);
      expect(await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: card.quoteId, shotId: "shot-1" }))
        .toMatchObject({ ok: true });
      expect(promptsSent(vendor.bodies, submits), "供应商只收到第 1 张").toEqual(["shot-1"]);
      const after = withWindow.listPendingSpend(PROJECT_ID);
      expect(after, "卡还在：第 2 张没人决定过，不许悄悄消失").toHaveLength(1);
      expect(after[0].shots.map((shot) => shot.shotId), "标题只数还没决定的那一张").toEqual(["shot-2"]);
      const shot2 = base.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!.shots!.find((shot) => shot.shotId === "shot-2")!;
      expect(shot2.included, "第 2 张没有被移出这一批").not.toBe(false);
      await settleMicrotasks();
      expect(turn.closed(), "卡还开着，回合不许被告知「都开始了」").toBe(false);
    } finally {
      turn?.dispose();
      await vendor.close();
    }
  });

  it("接着第 2 页点「生成这张」：供应商收到第 2 张；卡消失；回合此刻才拿到结论", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow, handler } = buildActions(base, vendor.origin, submits);
    let turn: ReturnType<typeof watchCardForTurn> | undefined;
    try {
      await imageDraft(base, handler);
      // 回合那一侧看的是账本里这一次出价开没开着（生产里 = laneDesktopSpend.whenCardCloses）。
      turn = watchCardForTurn(base);
      for (const shotId of ["shot-1", "shot-2"]) {
        advanceClock(1000);
        const card = withWindow.listPendingSpend(PROJECT_ID)[0];
        expect(card, `第 ${shotId} 张点下去之前卡还在`).toBeDefined();
        expect(await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: card.quoteId, shotId }))
          .toMatchObject({ ok: true });
      }
      expect(promptsSent(vendor.bodies, submits)).toEqual(["shot-1", "shot-2"]);
      expect(withWindow.listPendingSpend(PROJECT_ID), "两张都决定了，卡关掉").toEqual([]);
      await settleMicrotasks();
      expect(turn.closed(), "卡关掉那一刻回合才醒").toBe(true);
    } finally {
      turn?.dispose();
      await vendor.close();
    }
  });

  it("第 1 页点「去掉这张」，再生成第 2 张：只发第 2 张；第 1 张占位还在、没在生成", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow, handler } = buildActions(base, vendor.origin, submits);
    try {
      await imageDraft(base, handler);
      const nodesBefore = [...base.renderer.nodes.entries()];
      const actions = withWindow as PerShotActions;
      expect(typeof actions.removePendingSpendShot, "卡上有「去掉这张」这个动作").toBe("function");
      const card = actions.listPendingSpend(PROJECT_ID)[0];
      expect(await actions.removePendingSpendShot!({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: card.quoteId, shotId: "shot-1" }))
        .toMatchObject({ ok: true });
      const remaining = actions.listPendingSpend(PROJECT_ID)[0];
      expect(remaining.shots.map((shot) => shot.shotId)).toEqual(["shot-2"]);
      advanceClock(1000);
      expect(await actions.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: remaining.quoteId, shotId: "shot-2" }))
        .toMatchObject({ ok: true });
      expect(promptsSent(vendor.bodies, submits)).toEqual(["shot-2"]);
      expect([...base.renderer.nodes.entries()], "占位节点一个不删").toEqual(nodesBefore);
      expect(base.repository.read(PROJECT_ID, OPERATION_ID)!.jobs.some((job) => job.metadata?.shotId === "shot-1"), "去掉的那张没有任何 job").toBe(false);
    } finally {
      await vendor.close();
    }
  });

  it("第 1 张还在排队（批了、还没发出去）时点第 2 张：两张都真的发出去，各自核批它的那一份", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    let holding = true;
    const { withWindow, handler, dispatchNow } = buildActions(base, vendor.origin, submits, { holdDispatch: () => holding });
    try {
      await imageDraft(base, handler);
      advanceClock(1000);
      const first = withWindow.listPendingSpend(PROJECT_ID)[0];
      expect(await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: first.quoteId, shotId: "shot-1" }))
        .toMatchObject({ ok: true });
      expect(submits, "第 1 张批了但还在排队").toEqual([]);
      advanceClock(1000);
      const second = withWindow.listPendingSpend(PROJECT_ID)[0];
      expect(second?.shots.map((shot) => shot.shotId), "第 2 张还在卡上等人").toEqual(["shot-2"]);
      expect(await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: second.quoteId, shotId: "shot-2" }))
        .toMatchObject({ ok: true });
      holding = false;
      await dispatchNow();
      expect([...promptsSent(vendor.bodies, submits)].sort(), "排在前面的第 1 张没有因为第 2 张的批准而失去它自己的授权").toEqual(["shot-1", "shot-2"]);
    } finally {
      await vendor.close();
    }
  });

  it("5 张：生成 1、3，去掉 2，然后 ×：只发 1、3；逐镜结局一张一张说对（回执只渲染它）", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow, handler } = buildActions(base, vendor.origin, submits);
    let turn: ReturnType<typeof watchCardForTurn> | undefined;
    try {
      await imageDraft(base, handler, 5);
      turn = watchCardForTurn(base);
      const actions = withWindow as PerShotActions;
      const quoteId = () => actions.listPendingSpend(PROJECT_ID)[0].quoteId;
      const target = { projectId: PROJECT_ID, operationId: OPERATION_ID };
      advanceClock(1000);
      expect(await actions.confirmPendingSpend({ ...target, quoteId: quoteId(), shotId: "shot-1" })).toMatchObject({ ok: true });
      expect(await actions.removePendingSpendShot!({ ...target, quoteId: quoteId(), shotId: "shot-2" })).toMatchObject({ ok: true });
      advanceClock(1000);
      expect(await actions.confirmPendingSpend({ ...target, quoteId: quoteId(), shotId: "shot-3" })).toMatchObject({ ok: true });
      expect(actions.listPendingSpend(PROJECT_ID)[0].shots.map((shot) => shot.shotId), "卡上只剩还没决定的两张").toEqual(["shot-4", "shot-5"]);
      await settleMicrotasks();
      expect(turn.closed(), "卡还开着，回合还在等").toBe(false);
      expect(await actions.discardPendingSpend({ ...target, quoteId: quoteId() })).toMatchObject({ ok: true });
      expect(promptsSent(vendor.bodies, submits), "只发了点过的 1、3").toEqual(["shot-1", "shot-3"]);
      expect(actions.listPendingSpend(PROJECT_ID), "× 关掉了卡").toEqual([]);
      await settleMicrotasks();
      expect(turn.closed(), "× 那一刻回合醒来").toBe(true);
      expect(generationPresentationOutcome(base.repository.read(PROJECT_ID, OPERATION_ID)!)).toEqual({
        closedBy: "user_closed",
        generating: ["shot-1", "shot-3"],
        failedBeforeSending: [],
        removed: ["shot-2"],
        takenByCanvas: [],
        undecided: [{ shotId: "shot-4", reason: "user_closed" }, { shotId: "shot-5", reason: "user_closed" }],
      });
    } finally {
      turn?.dispose();
      await vendor.close();
    }
  });

  it("「生成这张」连点两下：这一张只发一次", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow, handler } = buildActions(base, vendor.origin, submits);
    try {
      await imageDraft(base, handler);
      advanceClock(1000);
      const card = withWindow.listPendingSpend(PROJECT_ID)[0];
      const click = () => withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: card.quoteId, shotId: "shot-1" });
      await Promise.all([click(), click()]);
      expect(promptsSent(vendor.bodies, submits)).toEqual(["shot-1"]);
      expect(withWindow.listPendingSpend(PROJECT_ID)[0]?.shots.map((shot) => shot.shotId), "第 2 张照样在卡上").toEqual(["shot-2"]);
    } finally {
      await vendor.close();
    }
  });
});

describe("generate 失败时说真话：没发出去就说没发出去", () => {
  it("在任何提交意图落盘之前失败：给模型的码是 generation_not_started，不是「可能已提交」", async () => {
    const base = harness();
    const { transport } = buildActions(base, "http://127.0.0.1:1", []);
    const shots = [1, 2].map((index) => ({ shotId: `shot-${index}`, role: "shot" as const,
      candidate: { ...candidate("image-model", {}), candidateId: `candidate-${index}` } }));
    await base.operations.create({ operationId: OPERATION_ID, projectId: PROJECT_ID, candidate: shots[0].candidate, shots,
      cardHidden: true, origin: { host: "nomi" }, now: now() });
    base.operations.present = async () => { throw new Error("storyboard_strategy_blocked"); };
    const result = await callTool(transport("step"), "nomi_generation_plan", { operation: "present", operationId: OPERATION_ID });
    expect(result).toMatchObject({ ok: false, code: "generation_not_started" });
    expect(base.repository.read(PROJECT_ID, OPERATION_ID)!.jobs, "账本里一个 job 都没有").toEqual([]);
  });
});
