import { afterEach, describe, expect, it } from "vitest";

import { GENERATION_METHODS } from "../shared/agentCapabilities/generation";
import { decideShotClaim, lastShotEngine } from "../shared/decideShotClaim";
import { isNodeGenerationOwnedByProduction } from "../../src/workbench/production/productionShotOwnership";
import { currentPresentation, offerShots } from "../shared/productionGenerationPresentation";
import { waitForProduction } from "../productionRun/productionRunTestHelpers";
import {
  OPERATION_ID, PROJECT_ID, callTool, resetSpendFixture, settleMicrotasks, shotsDraft, spendWorld, type SpendWorld,
} from "./agentPanelSpendConfirmTestUtils";

// 同一镜只交一次——Agent 面板起的出价（origin.host = nomi）那一侧，入口 × 时刻的特征表（I-double-submit-probe，2026-10-28）。
//
// #875 立的规矩：一镜归了制作流程，画布的生成入口都要读这份归属，再交就是同一镜两笔。D2 第③步（#1336）之后卡上点「生成」
// 也是交给画布（一台发动机），「直接生成」档同一条路。这里每一格都走生产同一份接线（真 Run 仓库、真画布付费口、真交接、
// 真卡上动作、真常驻传输），只有画布那台的供应商与渲染层是替身；断言只认一样东西：**这一镜供应商一共收到几份请求**。
//
// 三个时刻：
//   M1 报价卡在等人（出价开着，这一镜还没决定）；
//   M2 已授权排队、还没轮到（卡上点了「生成」，交接记下、画布同意开好，派发还没跑）；
//   M3 提交 / 生成中（M3a 交的那一下还在供应商门口；M3b 供应商已受理、还在生成）。
// 每一格：这一镜在这一刻已经归某一条路，再从另一扇门交一次，最后放开所有扣着的东西，这一镜仍只交了一次。

afterEach(resetSpendFixture);

/** 这一镜供应商一共收到几份请求（画布那台的传输按 `extras.productionShotId` 认镜）。 */
const sendsFor = (world: SpendWorld, shotId: string) => world.sentShots().filter((sent) => sent === shotId).length;
const nodeIdOf = (world: SpendWorld, shotId: string) => world.renderer.nodeOf(shotId)!.nodeId;
const codeOf = (error: unknown) => (error as { code?: string })?.code ?? "refused";
/** 一下动作的结局（成了 / 被拒的码），不让被拒的那一下把这一格的断言打断。 */
const outcomeOf = (promise: Promise<unknown>) => promise.then(() => "sent", codeOf);

/** 交一镜的请求：和渲染层替身 `submitNode` 同形（节点就是一镜要发什么的唯一来源，请求里带着节点绑的那一镜）。 */
function submitNodeAs(world: SpendWorld, shotId: string, runRecordId: string) {
  const node = world.renderer.nodeOf(shotId)!;
  return world.canvas.runs.submit({
    projectId: PROJECT_ID, nodeId: node.nodeId, runRecordId, vendor: node.vendor, gesture: world.canvas.gesture, senderId: world.canvas.senderId,
    request: {
      kind: node.mode, prompt: node.prompt,
      extras: { nodeId: node.nodeId, projectId: PROJECT_ID, modelKey: node.modelKey, idempotencyKey: runRecordId, productionRunId: node.runId, productionShotId: node.shotId, ...node.parameters },
    },
  });
}

/**
 * 真渲染层里每一次交接各自起一批（`handOverShotsOp` → `runGenerationNodesByPlan` → `runGenerationNodesBatch`），批与批之间
 * 不排队；夹具的渲染层替身把所有派发串成一条队（前一笔交完才轮到下一笔）。M3a 要的是真渲染层的样子：已经开好同意、还没交的
 * 那几笔交接，现在就交（和卡在供应商门口的那一笔并发）。替身的队列之后再轮到它们时，同一个运行记录号只照 Run 账本回话
 * （`replay`），不会再交一次。返回每一笔的结局（不在这里等：没被拒的那一笔会卡在供应商门口，直到放开）。
 */
function dispatchConsentedHandOversNow(world: SpendWorld): Array<Promise<string>> {
  const plan = world.run().generationPlan;
  return (plan?.presentations ?? []).flatMap((presentation) => (presentation.handOvers ?? []).flatMap((handOver) => {
    if (handOver.settled || !handOver.canvasRunId) return [];
    const canvasRun = world.repository.read(PROJECT_ID, handOver.canvasRunId);
    if (!canvasRun || canvasRun.jobs.length > 0) return [];
    return [outcomeOf(submitNodeAs(world, handOver.shotId, handOver.canvasRunId.replace(/^canvas-/, "")))];
  }));
}

/**
 * 画布批量那一条路（框菜单「生成整组」/ 组工具条 / 列表分区头「生成全部」→ `confirmAndRunPlan`）：卡上点了确认那一刻为
 * 这个节点开一份没有制作链接的画布同意，轮到它时用同一个运行记录号交，请求里照节点 meta 带着它绑的那一镜。
 */
let batchSequence = 0;
async function canvasBatchSubmits(world: SpendWorld, shotId: string): Promise<string> {
  const node = world.renderer.nodeOf(shotId)!;
  const runRecordId = `rr-batch-${node.nodeId}-${++batchSequence}`;
  world.canvas.runs.consent({
    projectId: PROJECT_ID, senderId: world.canvas.senderId,
    shots: [{ nodeId: node.nodeId, runRecordId, vendor: node.vendor, modelKey: node.modelKey, kind: node.kind }],
  });
  return outcomeOf(submitNodeAs(world, shotId, runRecordId));
}

/** 模型那一侧的 `generate`，点名这一镜（`request` 档：出一张新卡；`direct` 档：策略替用户交）。 */
function modelNames(world: SpendWorld, shotId: string, mode: "request" | "direct") {
  return callTool(world.transport(mode), GENERATION_METHODS.plan, { operation: "present", operationId: OPERATION_ID, shotIds: [shotId] }) as Promise<{ ok?: boolean; code?: string }>;
}

/** 供应商门口扣住：交的那一下进了传输、还没回执（`vendor.answer` 不回）。 */
function holdVendor(world: SpendWorld) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = world.vendor.answer;
  world.vendor.answer = async (call) => { await gate; return original(call); };
  return () => { world.vendor.answer = original; release(); };
}

/** 供应商受理了、还在生成（异步任务号，轮询不在这里推进）：这一镜停在「生成中」。 */
function vendorAcceptsAndKeepsGenerating(world: SpendWorld) {
  world.vendor.answer = async (call) => ({ id: `task-queued-${call}`, kind: "text_to_image", status: "queued", assets: [], raw: {} });
}

type Moment = Readonly<{
  label: string;
  /** 这一刻派发正在路上：开好的同意按真渲染层那样并发交（见 `dispatchConsentedHandOversNow`）。 */
  concurrentDispatch?: boolean;
  /** 造出这一刻：shot-1 已归一条路（M1：卡开着、还没人决定）。 */
  arrive: () => Promise<{ world: SpendWorld; finish: () => Promise<void> }>;
}>;

/** 两镜草稿摆在卡上（shot-1 / shot-2 都还没决定）。 */
async function twoShotCard(options: Parameters<typeof spendWorld>[0] = {}) {
  const world = spendWorld(options);
  await shotsDraft(world, [{}, {}]);
  return world;
}

const MOMENTS: readonly Moment[] = [
  {
    label: "M1 报价卡在等人",
    arrive: async () => {
      const world = await twoShotCard();
      // 收尾 = 人再在卡上按一次主按钮（卡还开着才按）：卡上剩下的照常交，shot-1 若已被别的门拿走就不该再交。
      return { world, finish: async () => {
        const shown = world.pending();
        if (shown && world.remainingOn(shown).length > 0) await world.generate();
        await world.renderer.drain();
      } };
    },
  },
  {
    label: "M2 已授权排队（卡上点了生成、派发还没轮到）",
    arrive: async () => {
      const world = await twoShotCard({ holdDispatch: true });
      expect(await world.generate(["shot-1"])).toMatchObject({ ok: true });
      expect(offerShots(world.run()).find((shot) => shot.shotId === "shot-1")?.state, "前提：shot-1 在交、还没到供应商").toBe("handing_over");
      expect(sendsFor(world, "shot-1")).toBe(0);
      return { world, finish: async () => { world.renderer.releaseDispatch(); await world.renderer.drain(); } };
    },
  },
  {
    label: "M3a 提交中（交的那一下还在供应商门口）",
    concurrentDispatch: true,
    arrive: async () => {
      const world = await twoShotCard();
      const release = holdVendor(world);
      expect(await world.generate(["shot-1"])).toMatchObject({ ok: true });
      void world.renderer.drain();
      await waitForProduction(() => world.vendor.executes.length === 1);
      return { world, finish: async () => { release(); await world.renderer.drain(); } };
    },
  },
  {
    label: "M3b 生成中（供应商已受理、还在出）",
    arrive: async () => {
      const world = await twoShotCard();
      vendorAcceptsAndKeepsGenerating(world);
      expect(await world.generate(["shot-1"])).toMatchObject({ ok: true });
      await world.renderer.drain();
      expect(offerShots(world.run()).find((shot) => shot.shotId === "shot-1")?.state, "前提：shot-1 交到了、在生成").toBe("sent");
      return { world, finish: async () => { await world.renderer.drain(); } };
    },
  },
];

type Door = Readonly<{ label: string; act: (world: SpendWorld) => Promise<unknown> }>;

const DOORS: readonly Door[] = [
  // 节点 ↑（B3 生成框）、变体 / 原地重生成、任务中心与节点错误卡的「重试」、分镜行操作、时间轴重生成：渲染层各自的入口
  // 最后都是 runGenerationNode → 画布付费口 submit，一个新的运行记录号、请求里带着节点绑的那一镜。
  { label: "节点 ↑（画布单节点提交）", act: (world) => outcomeOf(world.renderer.nodeUp(nodeIdOf(world, "shot-1"))) },
  { label: "框菜单「生成整组」/ 组工具条（画布批量：同意 + 提交）", act: (world) => canvasBatchSubmits(world, "shot-1") },
  {
    label: "卡上再按一次「生成」（拿此刻那张卡）",
    act: async (world) => {
      const shown = world.pending();
      return shown ? world.generate(["shot-1"], shown).catch(codeOf) : "no-card";
    },
  },
  {
    label: "Agent 点名再出价（请求批准档）→ 人按新卡",
    act: async (world) => {
      const named = await modelNames(world, "shot-1", "request");
      const shown = world.pending();
      const pressed = shown?.shots.some((shot) => shot.shotId === "shot-1" && shot.offer === "undecided")
        ? await world.generate(["shot-1"], shown).catch(codeOf)
        : "not-on-card";
      return { named, pressed };
    },
  },
  {
    label: "Agent 点名再出价（直接生成档：策略替用户交）",
    act: async (world) => {
      // 策略等交出去的那一镜落定（交到 / 没交到）才回；派发被扣着时它要等放开，所以不在这里等它回。
      const named = modelNames(world, "shot-1", "direct");
      await settleMicrotasks();
      return { named };
    },
  },
];

describe("同一镜只交一次：Agent 面板出价 × 每扇门 × 三个时刻", () => {
  for (const moment of MOMENTS) {
    describe(moment.label, () => {
      it.each(DOORS.map((door) => [door.label, door] as const))("%s：shot-1 供应商只收到一份", async (_label, door) => {
        const { world, finish } = await moment.arrive();
        const acted = await door.act(world);
        await settleMicrotasks();
        const concurrent = moment.concurrentDispatch ? dispatchConsentedHandOversNow(world) : [];
        await settleMicrotasks();
        await finish();
        const concurrentOutcomes = await Promise.all(concurrent);
        // 策略那一下等落定：放开之后它会醒，等它回来再数（没回来的 Promise 会被跨用例泄漏检查抓到）。
        const named = (acted as { named?: Promise<unknown> } | undefined)?.named;
        if (named && typeof (named as Promise<unknown>).then === "function") await named;
        await world.renderer.drain();
        await settleMicrotasks();
        expect(sendsFor(world, "shot-1"), JSON.stringify({ acted, concurrentOutcomes, offers: offerShots(world.run()) })).toBe(1);
        expect(sendsFor(world, "shot-2"), "shot-2 不会因为这一下多交").toBeLessThanOrEqual(1);
      });
    });
  }
});

describe("#8 独立验收发现 1：「直接生成」档模型点名正在生成的镜", () => {
  it("M3b：shot-1 交到供应商、还在生成；模型点名 shot-1 再 generate → 策略交接被同节点在途准入拒，供应商仍只收到一份", async () => {
    const world = await twoShotCard();
    vendorAcceptsAndKeepsGenerating(world);
    await world.generate(["shot-1"]);
    await world.renderer.drain();
    const firstCanvasRun = currentPresentation(world.run().generationPlan)!.handOvers!.find((entry) => entry.shotId === "shot-1")!.canvasRunId!;
    const result = await modelNames(world, "shot-1", "direct");
    await world.renderer.drain();
    expect(sendsFor(world, "shot-1")).toBe(1);
    // 新的那一次出价里 shot-1 落定为「没发出去」，原因是同节点还在生成；第一次那一笔仍是交到了。
    const retried = currentPresentation(world.run().generationPlan)!.handOvers!.filter((entry) => entry.shotId === "shot-1").at(-1)!;
    expect(retried.canvasRunId).not.toBe(firstCanvasRun);
    expect(retried.settled).toMatchObject({ outcome: "not_sent", failure: { code: "node_generation_in_flight" } });
    expect(result, "策略没决成：不许说策略批了").not.toMatchObject({ result: { spendDecision: { decidedBy: "policy:full_auto" } } });
  });

  it("M3a：shot-1 交的那一下还在供应商门口；模型点名 shot-1 再 generate → 同样被同节点在途准入拒", async () => {
    const world = await twoShotCard();
    const release = holdVendor(world);
    await world.generate(["shot-1"]);
    void world.renderer.drain();
    await waitForProduction(() => world.vendor.executes.length === 1);
    const named = modelNames(world, "shot-1", "direct");
    // 策略开好了第二笔交接的画布同意（交接记下、渲染层开了同意），派发还没跑。
    await waitForProduction(() => (world.run().generationPlan?.presentations?.length ?? 0) >= 2
      && (currentPresentation(world.run().generationPlan)?.handOvers ?? []).some((entry) => entry.shotId === "shot-1" && !entry.settled
        && Boolean(entry.canvasRunId && world.repository.read(PROJECT_ID, entry.canvasRunId)?.jobs.length === 0)));
    // 真渲染层里策略这一笔交接自己起一批、马上就交（不排在卡在供应商门口的那一笔后面）。
    const concurrent = dispatchConsentedHandOversNow(world);
    expect(concurrent, "策略确实又开了一笔交接（这一格才有东西可验）").toHaveLength(1);
    expect(await concurrent[0], "同节点还在交：画布付费口的同节点在途准入拒").toBe("node_generation_in_flight");
    release();
    await named;
    await world.renderer.drain();
    expect(sendsFor(world, "shot-1")).toBe(1);
  });
});

describe("「再来一版」：复制成变体节点再按 ↑（canvasNodeActions.duplicateNodeForRegeneration 原样抄节点 meta，请求绑同一镜）", () => {
  // 变体是**另一个节点**、用户第二次明确要的新一版：同节点在途准入（按节点）管不到它，只剩认领判定（按镜）。
  // 钉的是现状：卡在等 / 在交时认领判定拒或让卡认出；交到之后（M3b）D2 把这一镜判给画布，变体照发——那是用户要的第二版，不是一下扣两次。
  let variantSequence = 0;
  const variantUp = (world: SpendWorld, shotId: string) => {
    const node = world.renderer.nodeOf(shotId)!;
    const variantNodeId = `${node.nodeId}-variant`;
    const runRecordId = `rr-variant-${++variantSequence}`;
    return outcomeOf(world.canvas.runs.submit({
      projectId: PROJECT_ID, nodeId: variantNodeId, runRecordId, vendor: node.vendor, gesture: world.canvas.gesture, senderId: world.canvas.senderId,
      request: {
        kind: node.mode, prompt: node.prompt,
        extras: { nodeId: variantNodeId, projectId: PROJECT_ID, modelKey: node.modelKey, idempotencyKey: runRecordId, productionRunId: node.runId, productionShotId: node.shotId, ...node.parameters },
      },
    }));
  };

  it.each([
    ["M1 报价卡在等人：变体拿走这一镜（offered），卡上再按也不交它", 0, "sent", 1],
    ["M2 已授权排队：认领判定拒（queued）", 1, "production_shot_claimed", 1],
    ["M3a 提交中：认领判定拒（交接没落定，仍是 queued）", 2, "production_shot_claimed", 1],
    ["M3b 生成中：交到之后归画布，变体照发——用户要的第二版（两个节点各一版）", 3, "sent", 2],
  ] as const)("%s", async (_label, momentIndex, expected, sends) => {
    const { world, finish } = await MOMENTS[momentIndex].arrive();
    const outcome = await variantUp(world, "shot-1");
    await finish();
    await world.renderer.drain();
    await settleMicrotasks();
    expect(outcome).toBe(expected);
    expect(sendsFor(world, "shot-1")).toBe(sends);
  });
});

describe("渲染层入口读到的归属（节点生成钮 / 框菜单 / 组工具条 / 列表「生成全部」）× 三个时刻", () => {
  // 节点生成钮：`NodeGenerationComposer` 的 `productionClaimBlocked`（decideShotClaim 'canvas'）+ `canRunGenerationNode`；
  // 框菜单 / 组工具条 / 列表：`isGenerationNodeBusy` / `eligibleGenerationNodeIds`。两者都只读 `isNodeGenerationOwnedByProduction`
  // 背后的同一个 `decideShotClaim`，所以这里钉它在每一刻对 shot-1 说什么；另一半（节点自己的 queued / running）是渲染层状态。
  const ownership = (world: SpendWorld) => {
    const claim = decideShotClaim(world.run(), "shot-1", "canvas");
    const node = { id: nodeIdOf(world, "shot-1"), meta: { productionRunId: OPERATION_ID } };
    return { holder: claim.holder, reason: claim.reason, ownedByProduction: isNodeGenerationOwnedByProduction(node, { [OPERATION_ID]: world.run() }) };
  };

  it("M1 卡在等人：归画布（offered）——Q3c 设计如此，节点 ↑ 可按，按了卡认出这一镜已被拿走", async () => {
    const world = await twoShotCard();
    expect(ownership(world)).toEqual({ holder: "canvas", reason: "offered", ownedByProduction: false });
  });

  it("M2 已授权排队（交接在路上、派发还没跑）：归制作流程（queued）——四个画布入口都按不下去", async () => {
    const world = await twoShotCard({ holdDispatch: true });
    await world.generate(["shot-1"]);
    expect(ownership(world)).toEqual({ holder: "production", reason: "queued", ownedByProduction: true });
    world.renderer.releaseDispatch();
    await world.renderer.drain();
  });

  it("M3a 提交中（交接还没落定）：仍归制作流程（queued）", async () => {
    const world = await twoShotCard();
    const release = holdVendor(world);
    await world.generate(["shot-1"]);
    void world.renderer.drain();
    await waitForProduction(() => world.vendor.executes.length === 1);
    expect(ownership(world)).toEqual({ holder: "production", reason: "queued", ownedByProduction: true });
    release();
    await world.renderer.drain();
  });

  it("M3b 生成中（交接落定为交到了）：归画布（handed_over）——入口按不下去只靠节点自己的 running；主进程同节点在途准入兜底", async () => {
    const world = await twoShotCard();
    vendorAcceptsAndKeepsGenerating(world);
    await world.generate(["shot-1"]);
    await world.renderer.drain();
    expect(ownership(world)).toEqual({ holder: "canvas", reason: "handed_over", ownedByProduction: false });
  });
});

describe("重试那一颗钮走回原来那一台（useProductionNodeRetry → lastShotEngine）", () => {
  it("卡交给画布的镜在 M2 / M3 都归画布那一台：重试 = 节点 ↑ 那一条（受同节点在途准入与认领判定管）", async () => {
    const world = await twoShotCard({ holdDispatch: true });
    await world.generate(["shot-1"]);
    expect(lastShotEngine(world.run(), "shot-1"), "M2：交接在路上").toBe("canvas");
    world.renderer.releaseDispatch();
    await world.renderer.drain();
    expect(lastShotEngine(world.run(), "shot-1"), "交到之后").toBe("canvas");
    expect(lastShotEngine(world.run(), "shot-2"), "一笔都没派过的镜").toBe("canvas");
  });
});

