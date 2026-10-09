// 付费卡「生成剩下 N 张」（2026-10-01 用户拍板）：等于把卡上还没决定的每一张各点一次「生成这张」。
//
// 真链路、零额度：真 Run 账本、真封印 / 收据 / 决门、真批次调度器，只有供应商是本机 loopback HTTP。
// 钉住拍板里的四句话：
//   · 去掉的不算在 N 里，N 只数还没决定的；
//   · 每张仍各记一笔授权，不出总价授权；
//   · 点完以后卡和芯片的状态跟逐张点完全一致（同一份逐镜结局驱动）；
//   · 按下去时看到的就是要发的——点名的不是卡上那一叠、或报价旧了，一张都不发。
import { afterEach, describe, expect, it } from "vitest";

import { generationPresentationOutcome } from "../shared/productionGenerationPresentation";
import { waitForProduction } from "../productionRun/productionRunTestHelpers";
import {
  PROJECT_ID, OPERATION_ID, startLoopbackVendor, harness, buildActions, resetSpendFixture, advanceClock, imageDraft, shotsSent, lease,
  watchCardForTurn, settleMicrotasks,
} from "./agentPanelSpendConfirmTestUtils";

afterEach(resetSpendFixture);

const TARGET = { projectId: PROJECT_ID, operationId: OPERATION_ID } as const;

describe("「生成剩下 N 张」= 卡上还没决定的每一张各点一次「生成这张」", () => {
  it("5 张、去掉第 2 张后点「生成剩下 4 张」：发了 1、3、4、5，每张各一份授权；卡关掉；结局和逐张点完一样", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow, handler } = buildActions(base, vendor.origin, submits);
    let turn: ReturnType<typeof watchCardForTurn> | undefined;
    try {
      await imageDraft(base, handler, 5);
      // 回合那一侧看的是账本里这一次出价开没开着（生产里 = laneDesktopSpend.whenCardCloses）。
      turn = watchCardForTurn(base);
      expect(await withWindow.removePendingSpendShot({ ...TARGET, quoteId: withWindow.listPendingSpend(PROJECT_ID)[0].quoteId, shotId: "shot-2" }))
        .toMatchObject({ ok: true });
      const card = withWindow.listPendingSpend(PROJECT_ID)[0];
      expect(card.shots.map((shot) => shot.shotId), "N 只数还没决定的：去掉的不在里面").toEqual(["shot-1", "shot-3", "shot-4", "shot-5"]);
      advanceClock(1000);
      expect(await withWindow.confirmRemainingShots({ ...TARGET, quoteId: card.quoteId, shotIds: card.shots.map((shot) => shot.shotId) }))
        .toMatchObject({ ok: true, code: "spend_confirmed" });

      expect(shotsSent(submits), "每一张都发了，而且只发一次；去掉的那张没发").toEqual(["shot-1", "shot-3", "shot-4", "shot-5"]);
      expect(withWindow.listPendingSpend(PROJECT_ID), "每一张都决定了，卡关掉").toEqual([]);
      await settleMicrotasks();
      expect(turn.closed(), "卡关掉那一刻回合醒来，和逐张点完一样").toBe(true);

      const run = base.repository.read(PROJECT_ID, OPERATION_ID)!;
      const digests = new Set(run.jobs.map((job) => job.authorizationDigest));
      expect(run.jobs, "一张一个作业").toHaveLength(4);
      expect(digests.size, "每张各记一笔授权：四个作业对着四份不同的授权，没有一份盖住整叠的总授权").toBe(4);
      const approvals = run.gates.filter((gate) => gate.scope === "budget_envelope" && gate.status === "approved");
      expect(approvals, "四道各自批准的门").toHaveLength(4);
      expect(generationPresentationOutcome(run)).toEqual({
        closedBy: "resolved",
        generating: ["shot-1", "shot-3", "shot-4", "shot-5"],
        failedBeforeSending: [],
        removed: ["shot-2"],
        takenByCanvas: [],
        undecided: [],
      });
    } finally {
      turn?.dispose();
      await vendor.close();
    }
  });

  it("点名的不是卡上那一叠（少一张 / 多一张 / 顺序不对）或报价旧了：一张都不发，卡原样还在", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow, handler } = buildActions(base, vendor.origin, submits);
    try {
      await imageDraft(base, handler, 3);
      const card = withWindow.listPendingSpend(PROJECT_ID)[0];
      advanceClock(1000);
      for (const shotIds of [["shot-1", "shot-2"], ["shot-1", "shot-2", "shot-3", "shot-4"], ["shot-2", "shot-1", "shot-3"]]) {
        expect(await withWindow.confirmRemainingShots({ ...TARGET, quoteId: card.quoteId, shotIds }), shotIds.join(","))
          .toMatchObject({ ok: false, message: "generation_scope_invalid" });
      }
      expect(await withWindow.confirmRemainingShots({ ...TARGET, quoteId: "stale-quote", shotIds: ["shot-1", "shot-2", "shot-3"] }))
        .toMatchObject({ ok: false, message: "generation_quote_changed" });
      expect(submits, "一张都没发").toEqual([]);
      expect(withWindow.listPendingSpend(PROJECT_ID)[0].shots.map((shot) => shot.shotId), "卡原样还在").toEqual(["shot-1", "shot-2", "shot-3"]);
      expect(base.repository.read(PROJECT_ID, OPERATION_ID)!.gates.filter((gate) => gate.scope === "budget_envelope"), "一道门都没开").toEqual([]);
    } finally {
      await vendor.close();
    }
  });

  it("中途点 ×：已经批下的那张照常生成，剩下的不再生成（× 不排队，正是为了能打断它）", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    let closeAfterFirst = true;
    let discarding: Promise<unknown> | undefined;
    // (#1139 CI eval:journey 红：zh「× 真的停下了」6 张全发) 这一条把 × 在动作里面等着，所以从来测不到那种红——
    // 真的 × 是另一条 IPC，只有主进程事件循环空出一拍才处理得到。下一条测试照真样子来。
    const built = buildActions(base, vendor.origin, submits, {
      // × 从 IPC 来，不在这一下动作的里面被等着：发出去、等卡关上，就让这一镜接着走完。
      afterAuthorize: async () => {
        if (!closeAfterFirst) return;
        closeAfterFirst = false;
        const open = built.withWindow.listPendingSpend(PROJECT_ID)[0];
        discarding = built.withWindow.discardPendingSpend({ ...TARGET, quoteId: open.quoteId });
        await waitForProduction(() => built.withWindow.listPendingSpend(PROJECT_ID).length === 0);
      },
    });
    const { withWindow, handler } = built;
    try {
      await imageDraft(base, handler, 3);
      const card = withWindow.listPendingSpend(PROJECT_ID)[0];
      advanceClock(1000);
      expect(await withWindow.confirmRemainingShots({ ...TARGET, quoteId: card.quoteId, shotIds: card.shots.map((shot) => shot.shotId) }))
        .toMatchObject({ ok: true, batchStopped: { sent: 1, notSent: 2 } });
      expect(await discarding, "× 回的是这一次出价最终批下几张、没发几张").toMatchObject({ ok: true, code: "discarded", batchStopped: { sent: 1, notSent: 2 } });
      expect(shotsSent(submits), "只有点 × 之前批下的那张").toEqual(["shot-1"]);
      expect(withWindow.listPendingSpend(PROJECT_ID), "× 关掉了卡").toEqual([]);
      expect(generationPresentationOutcome(base.repository.read(PROJECT_ID, OPERATION_ID)!)).toMatchObject({
        closedBy: "user_closed",
        generating: ["shot-1"],
        undecided: [{ shotId: "shot-2", reason: "user_closed" }, { shotId: "shot-3", reason: "user_closed" }],
      });
    } finally {
      await vendor.close();
    }
  });

  // #1139 CI eval:journey（zh「× 真的停下了」6 张全发）：× 是另一条 IPC，主进程得空出一拍才处理得到。
  // 以前每批一张都要等一次渲染层落地（真 I/O），那一拍是碰巧有的；落地前移之后节点已在画布上，这一叠全是微任务，
  // × 要等六张全批完才轮得到。这里不在动作里等 ×，只在第 1 张批下之后把它排成下一拍到来的 IPC。
  it("× arrives as a separate IPC after the 1st approval (not awaited inside the action): the batch stops, sent < total and equals what was approved before ×", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    let approvedBeforeStop = -1;
    let discarding: Promise<unknown> | undefined;
    let armed = true;
    const built = buildActions(base, vendor.origin, submits, {
      // 与真 App 同形：批下之后派发是另起的（调度器 fire-and-forget），这一下动作里没有任何真 I/O。
      holdDispatch: () => true,
      afterAuthorize: async () => {
        if (!armed) return;
        armed = false;
        setImmediate(() => {
          const open = built.withWindow.listPendingSpend(PROJECT_ID)[0];
          if (!open) return;
          approvedBeforeStop = 6 - open.shots.length;
          discarding = built.withWindow.discardPendingSpend({ ...TARGET, quoteId: open.quoteId });
        });
      },
    });
    const { withWindow, handler } = built;
    try {
      await imageDraft(base, handler, 6);
      const card = withWindow.listPendingSpend(PROJECT_ID)[0];
      advanceClock(1000);
      const result = await withWindow.confirmRemainingShots({ ...TARGET, quoteId: card.quoteId, shotIds: card.shots.map((shot) => shot.shotId) });
      await discarding;
      const outcome = generationPresentationOutcome(base.repository.read(PROJECT_ID, OPERATION_ID)!)!;
      expect(approvedBeforeStop, "× 真的在批完之前到了").toBeGreaterThan(0);
      expect(outcome.generating.length, "× 之后没批的不再生成").toBeLessThan(6);
      expect(outcome.generating.length, "批下的就是 × 到之前批下的那几张").toBe(approvedBeforeStop);
      expect(result).toMatchObject({ ok: true, batchStopped: { sent: approvedBeforeStop, notSent: 6 - approvedBeforeStop } });
    } finally {
      await vendor.close();
    }
  });

  // 2026-10-02 真 App 实测：每批下一张卡上的报价就换一版，用户点 × 时带的是他卡上那一版——往往已经是前一张批下去之前的。
  // 拿「报价对不上」把它挡回去，等于让他追着一张一直在变的卡点 ×。这一叠在跑时，× 认它出过的每一版。
  it("中途点 ×、带的是这一叠开跑时那一版报价（已经旧了一版）：照样停下，剩下的不再生成", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    let startQuote = "";
    let closeAfterFirst = true;
    let discarding: Promise<unknown> | undefined;
    const built = buildActions(base, vendor.origin, submits, {
      afterAuthorize: async () => {
        if (!closeAfterFirst) return;
        closeAfterFirst = false;
        expect(built.withWindow.listPendingSpend(PROJECT_ID)[0].quoteId, "批下第 1 张之后报价已经换了一版").not.toBe(startQuote);
        discarding = built.withWindow.discardPendingSpend({ ...TARGET, quoteId: startQuote });
        await waitForProduction(() => built.withWindow.listPendingSpend(PROJECT_ID).length === 0);
      },
    });
    const { withWindow, handler } = built;
    try {
      await imageDraft(base, handler, 3);
      const card = withWindow.listPendingSpend(PROJECT_ID)[0];
      startQuote = card.quoteId;
      advanceClock(1000);
      expect(await withWindow.confirmRemainingShots({ ...TARGET, quoteId: card.quoteId, shotIds: card.shots.map((shot) => shot.shotId) }))
        .toMatchObject({ ok: true, batchStopped: { sent: 1, notSent: 2 } });
      expect(await discarding).toMatchObject({ ok: true, code: "discarded" });
      expect(shotsSent(submits), "只有点 × 之前批下的那张").toEqual(["shot-1"]);
      expect(withWindow.listPendingSpend(PROJECT_ID), "× 关掉了卡").toEqual([]);
    } finally {
      await vendor.close();
    }
  });

  // 10-02 真 App 走查：「生成这张」紧接着点 ×，× 到主进程时那一镜已经批下、报价换了一版，× 被「报价对不上」挡回去、卡还开着。
  // × 认这一次出价里被卡上自己的动作换掉过的报价；Agent 重新出价是新的一次出价，旧卡上的 × 照旧挡回去。
  it("「生成这张」批下之后 × 才到、带的是批之前那一版报价：卡照样关掉；重新出价之后，旧卡的报价照旧被挡回去", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow, handler } = buildActions(base, vendor.origin, submits);
    try {
      await imageDraft(base, handler, 3);
      const card = withWindow.listPendingSpend(PROJECT_ID)[0];
      advanceClock(1000);
      expect(await withWindow.confirmPendingSpend({ ...TARGET, quoteId: card.quoteId, shotId: "shot-1" })).toMatchObject({ ok: true });
      const afterFirst = withWindow.listPendingSpend(PROJECT_ID)[0];
      expect(afterFirst.quoteId, "批下第 1 张，报价换了一版").not.toBe(card.quoteId);
      expect(await withWindow.discardPendingSpend({ ...TARGET, quoteId: card.quoteId }))
        .toMatchObject({ ok: true, code: "discarded", batchStopped: { sent: 1, notSent: 2 } });
      expect(withWindow.listPendingSpend(PROJECT_ID), "× 关掉了卡").toEqual([]);
      expect(shotsSent(submits)).toEqual(["shot-1"]);

      await handler({ capability: "present", params: { operationId: OPERATION_ID }, lease });
      const rebid = withWindow.listPendingSpend(PROJECT_ID)[0];
      const rebidShots = rebid.shots.map((shot) => shot.shotId);
      for (const stale of [card.quoteId, afterFirst.quoteId].filter((quoteId) => quoteId !== rebid.quoteId)) {
        expect(await withWindow.discardPendingSpend({ ...TARGET, quoteId: stale }), "旧卡上的 × 不收新的这一次出价")
          .toMatchObject({ ok: false, message: "generation_quote_changed" });
      }
      expect(withWindow.listPendingSpend(PROJECT_ID)[0]?.shots.map((shot) => shot.shotId), "新的卡还开着").toEqual(rebidShots);
      expect(await withWindow.discardPendingSpend({ ...TARGET, quoteId: rebid.quoteId })).toMatchObject({ ok: true, code: "discarded" });
      expect(shotsSent(submits), "一张都没多发").toEqual(["shot-1"]);
    } finally {
      await vendor.close();
    }
  });

  it("某一张在发出前就失败：停在那一张，它和后面的还在卡上；前面那张照常生成；这一张说「没发出去」，不借前一张的状态说「可能已提交」", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    let authorizations = 0;
    const { withWindow, handler } = buildActions(base, vendor.origin, submits, {
      beforeAuthorize: async () => {
        authorizations += 1;
        if (authorizations === 2) throw new Error("storyboard_strategy_blocked");
      },
    });
    try {
      await imageDraft(base, handler, 3);
      const card = withWindow.listPendingSpend(PROJECT_ID)[0];
      advanceClock(1000);
      const result = await withWindow.confirmRemainingShots({ ...TARGET, quoteId: card.quoteId, shotIds: card.shots.map((shot) => shot.shotId) });
      expect(result).toMatchObject({ ok: false, message: "generation_not_started" });
      expect(shotsSent(submits), "第 1 张发了，第 2 张没发、第 3 张没轮到").toEqual(["shot-1"]);
      expect(withWindow.listPendingSpend(PROJECT_ID)[0]?.shots.map((shot) => shot.shotId), "第 2、3 张照旧在卡上等人").toEqual(["shot-2", "shot-3"]);
    } finally {
      await vendor.close();
    }
  });

  // 2026-10-02 搞破坏线 X2 / X4：× 收回出价是立刻的，可那一刻可能有一镜正批到一半——它照样批下、照样花钱。
  // 以前 × 当场就把结局递给等着的回合：回执把那一镜写成「没生成、没花钱」，卡关掉时那一句也少算一张。
  // 下面两条造「× 和第 k 张的批准赛跑」（10-02 搞破坏线 X2 / X4）：× 落在那一镜过完卡上的核对、还没封印开门的时候——
  // 收回出价时没有门可撤，这一镜随后照样批下、发出。回合听到的结局、× 回的张数、供应商收到的，三处都得按宿主最终批下的那一份说。
  describe("× 和正在批的那一镜赛跑", () => {
    type Outcome = ReturnType<typeof generationPresentationOutcome>;
    /** 回合在账本里这一次出价关掉那一刻就去读结局，读法和 lane 同一个（`readPresentationOutcome`）。卡摆出来之后才开始看。 */
    const listen = (built: ReturnType<typeof buildActions>, base: ReturnType<typeof harness>, heard: Promise<Outcome | undefined>[]) =>
      watchCardForTurn(base, () => { heard.push(built.transport("step").readPresentationOutcome(OPERATION_ID)); });

    it("「生成剩下 4 张」批第 2 张时点 ×：第 2 张照样批下；回合听到的结局、× 回的张数、供应商收到的三处一致", async () => {
      const vendor = await startLoopbackVendor();
      const base = harness();
      const submits: string[] = [];
      let authorizations = 0;
      let discarding: Promise<unknown> | undefined;
      const heard: Promise<Outcome | undefined>[] = [];
      const built = buildActions(base, vendor.origin, submits, {
        beforeGate: async () => {
          authorizations += 1;
          if (authorizations !== 2) return;
          const open = built.withWindow.listPendingSpend(PROJECT_ID)[0];
          discarding = built.withWindow.discardPendingSpend({ ...TARGET, quoteId: open.quoteId });
          await waitForProduction(() => built.withWindow.listPendingSpend(PROJECT_ID).length === 0);
        },
      });
      let turn: ReturnType<typeof listen> | undefined;
      try {
        await imageDraft(base, built.handler, 4);
        turn = listen(built, base, heard);
        const card = built.withWindow.listPendingSpend(PROJECT_ID)[0];
        advanceClock(1000);
        expect(await built.withWindow.confirmRemainingShots({ ...TARGET, quoteId: card.quoteId, shotIds: card.shots.map((shot) => shot.shotId) }))
          .toMatchObject({ ok: true, batchStopped: { sent: 2, notSent: 2 } });
        expect(await discarding, "× 回的是最终批下几张、没发几张").toMatchObject({ ok: true, code: "discarded", batchStopped: { sent: 2, notSent: 2 } });
        expect(shotsSent(submits), "第 2 张在 × 之前已经在批，照样发了").toEqual(["shot-1", "shot-2"]);
        expect(heard, "回合只听到一次结局").toHaveLength(1);
        expect(await heard[0], "回合读到的结局按宿主最终批下的说").toMatchObject({
          closedBy: "user_closed",
          generating: ["shot-1", "shot-2"],
          undecided: [{ shotId: "shot-3", reason: "user_closed" }, { shotId: "shot-4", reason: "user_closed" }],
        });
      } finally {
        turn?.dispose();
        await vendor.close();
      }
    });

    it("「生成这张」正在批时点 ×：这一镜照样批下；回合听到它在生成，× 回的是「发出了 1 张，剩下 2 张没发」", async () => {
      const vendor = await startLoopbackVendor();
      const base = harness();
      const submits: string[] = [];
      let discarding: Promise<unknown> | undefined;
      const heard: Promise<Outcome | undefined>[] = [];
      const built = buildActions(base, vendor.origin, submits, {
        beforeGate: async () => {
          if (discarding) return;
          const open = built.withWindow.listPendingSpend(PROJECT_ID)[0];
          discarding = built.withWindow.discardPendingSpend({ ...TARGET, quoteId: open.quoteId });
          await waitForProduction(() => built.withWindow.listPendingSpend(PROJECT_ID).length === 0);
        },
      });
      let turn: ReturnType<typeof listen> | undefined;
      try {
        await imageDraft(base, built.handler, 3);
        turn = listen(built, base, heard);
        const card = built.withWindow.listPendingSpend(PROJECT_ID)[0];
        advanceClock(1000);
        expect(await built.withWindow.confirmPendingSpend({ ...TARGET, quoteId: card.quoteId, shotId: "shot-1" })).toMatchObject({ ok: true });
        expect(await discarding).toMatchObject({ ok: true, code: "discarded", batchStopped: { sent: 1, notSent: 2 } });
        expect(shotsSent(submits), "× 落下时第 1 张已经在批，照样发了").toEqual(["shot-1"]);
        expect(heard).toHaveLength(1);
        expect(await heard[0]).toMatchObject({
          closedBy: "user_closed",
          generating: ["shot-1"],
          undecided: [{ shotId: "shot-2", reason: "user_closed" }, { shotId: "shot-3", reason: "user_closed" }],
        });
      } finally {
        turn?.dispose();
        await vendor.close();
      }
    });

    it("「生成这张」正在批时用户在面板里打了字：收回出价后回合读到的结局里，这一镜在生成", async () => {
      const vendor = await startLoopbackVendor();
      const base = harness();
      const submits: string[] = [];
      let reading: Promise<Outcome | undefined> | undefined;
      const built = buildActions(base, vendor.origin, submits, {
        // lane 的那条路（`laneExtendedDesktopPorts` 的 redirected）：先收回出价，再立刻读结局——不排卡上的队。
        beforeGate: async () => {
          if (reading) return;
          const lane = built.transport("step");
          await lane.withdrawPresentation(OPERATION_ID, "user_wrote");
          reading = lane.readPresentationOutcome(OPERATION_ID);
        },
      });
      try {
        await imageDraft(base, built.handler, 3);
        const card = built.withWindow.listPendingSpend(PROJECT_ID)[0];
        advanceClock(1000);
        expect(await built.withWindow.confirmPendingSpend({ ...TARGET, quoteId: card.quoteId, shotId: "shot-1" })).toMatchObject({ ok: true });
        expect(shotsSent(submits), "打字落下时第 1 张已经过了核对，照样发了").toEqual(["shot-1"]);
        expect(await reading).toMatchObject({
          closedBy: "user_wrote",
          generating: ["shot-1"],
          undecided: [{ shotId: "shot-2", reason: "user_wrote" }, { shotId: "shot-3", reason: "user_wrote" }],
        });
      } finally {
        await vendor.close();
      }
    });
  });
});
