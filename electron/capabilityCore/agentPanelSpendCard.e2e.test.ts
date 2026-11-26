import { afterEach, describe, expect, it } from "vitest";

import { describeGenerateOutcome } from "../shared/agentLane/generateOutcomeReceipt";
import { currentPresentation, generationPresentationOutcome } from "../shared/productionGenerationPresentation";
import { canvasRunIdFor } from "../productionRun/canvasShotRunIndex";
import {
  OPERATION_ID, PROJECT_ID, lease, receiptOfCanvasRun, resetSpendFixture, settleMicrotasks, shotsDraft, spendWorld, watchCardForTurn,
} from "./agentPanelSpendConfirmTestUtils";

// Agent 面板付费卡 = 指向元素 + 一行只读摘要 + 主按钮，接的是**一台**发动机（D2 第③步）：卡上点「生成」把这几镜交给画布，
// 逐镜走画布单节点提交那一条路，和节点上点 ↑ 同一张手势收据。这里钉的是钱那条轴上看得见的几件事：
//   · 卡上摘要读的节点 = 供应商收到的（任务 A / B）；
//   · 「不生成 ×」可撤回，全去掉卡还在（主按钮置灰），「取消」才关；
//   · 节点上先点了 ↑ 的那一镜画布接手，卡上剩下的才归卡（任务 C），同一镜两边同时点只成一下；
//   · 收据 / 回执 / 关卡原因都读同一个账本。

afterEach(resetSpendFixture);

const exec = (world: ReturnType<typeof spendWorld>, shotId: string) => world.vendor.executes.find((entry) => entry.request.extras?.productionShotId === shotId);

describe("任务 A：三张纸船，卡上「全部生成（3）」", () => {
  it("每一镜走画布单节点提交，供应商收到的就是节点上那一份；出价按「已交给画布」关；回执说三镜都在生成", async () => {
    const world = spendWorld();
    await shotsDraft(world);
    const shown = world.pending()!;
    expect(shown.shots.map((shot) => [shot.shotId, shot.offer])).toEqual([["shot-1", "undecided"], ["shot-2", "undecided"], ["shot-3", "undecided"]]);
    // 卡上没有第二份参数：摘要读节点（这里读夹具里的那个节点），节点读的是 Agent 起草的那一份。
    for (const shot of shown.shots) expect(world.renderer.nodes.get(shot.nodeId!)?.parameters).toEqual({ size: "1024x1024" });
    expect(world.vendor.executes, "按下去之前一个字节都不发").toHaveLength(0);

    const turn = watchCardForTurn(world);
    expect(await world.generate()).toEqual({ ok: true, code: "handed_over" });
    await world.renderer.drain();
    await settleMicrotasks();

    expect(world.sentShots().sort()).toEqual(["shot-1", "shot-2", "shot-3"]);
    for (const shotId of ["shot-1", "shot-2", "shot-3"]) {
      const node = world.renderer.nodeOf(shotId)!;
      expect(exec(world, shotId)?.request, `${shotId}：供应商收到的 = 节点上那一份`).toMatchObject({ kind: node.mode, prompt: node.prompt, extras: { ...node.parameters, modelKey: node.modelKey } });
    }
    const plan = world.run().generationPlan!;
    expect(currentPresentation(plan)?.closed?.by).toBe("handed_to_canvas");
    expect(world.pending(), "卡关了").toBeUndefined();
    expect(turn.closed(), "回合醒来去读结局").toBe(true);
    const outcome = generationPresentationOutcome(world.run())!;
    expect(outcome.generating).toEqual(["shot-1", "shot-2", "shot-3"]);
    expect(describeGenerateOutcome(outcome)).toMatchObject({ kind: "job_running", userSees: expect.stringContaining("All 3 shot(s) on the card are generating") });
    turn.dispose();
  });

  it("卡上那一下和节点上点 ↑ 是同一张手势收据（同一个窗口、同一个人证）", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    await world.generate(["shot-1"]);
    await world.renderer.drain();
    const viaCard = world.repository.read(PROJECT_ID, OPERATION_ID)!.generationPlan!.presentations!.at(-1)!.handOvers![0].canvasRunId!;
    await world.renderer.nodeUp(world.renderer.nodeOf("shot-2")!.nodeId);
    const viaNode = world.vendor.executes.map((entry) => String(entry.request.extras?.idempotencyKey)).find((key) => key.startsWith("rr-up-"))!;
    const cardReceipt = receiptOfCanvasRun(world, viaCard);
    const nodeReceipt = receiptOfCanvasRun(world, canvasRunIdFor(viaNode));
    expect(cardReceipt).toMatchObject({ decidedBy: "human:gesture", humanActor: "web_contents:7:1:app://nomi" });
    expect(cardReceipt?.humanActor).toBe(nodeReceipt?.humanActor);
    expect(cardReceipt?.decidedBy).toBe(nodeReceipt?.decidedBy);
  });

  it("「生成」连按两下：这一镜只交一次（宿主拒收同时到达的第二下）", async () => {
    const world = spendWorld({ holdDispatch: true });
    await shotsDraft(world, [{}]);
    const shown = world.pending()!;
    const [first, second] = await Promise.all([world.generate(undefined, shown), world.generate(undefined, shown)]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, message: "generation_quote_changed" });
    world.renderer.releaseDispatch();
    await world.renderer.drain();
    expect(world.sentShots()).toEqual(["shot-1"]);
    expect(world.run().generationPlan!.presentations!.at(-1)!.handOvers).toHaveLength(1);
  });

  it("卡关了之后再按「生成」：没有可交的卡，什么都不发", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}]);
    const shown = world.pending()!;
    await world.generate(undefined, shown);
    await world.renderer.drain();
    expect(await world.generate(undefined, shown)).toMatchObject({ ok: false });
    await world.renderer.drain();
    expect(world.sentShots()).toEqual(["shot-1"]);
  });
});

describe("任务 B：两段竖版 + 一段横版，用户在节点上改了一段的时长", () => {
  it("供应商收到的是节点上改过的时长、各自的比例；卡没出第二份参数", async () => {
    const world = spendWorld();
    await shotsDraft(world, [
      { modelId: "vid-model", parameters: { duration: 5, aspect_ratio: "9:16", resolution: "480p" } },
      { modelId: "vid-model", parameters: { duration: 5, aspect_ratio: "9:16", resolution: "480p" } },
      { modelId: "vid-model", parameters: { duration: 5, aspect_ratio: "16:9", resolution: "480p" } },
    ]);
    const second = world.renderer.nodeOf("shot-2")!;
    world.renderer.editNode(second.nodeId, { parameters: { duration: 8 } });
    const shown = world.pending()!;
    expect(shown.shots.every((shot) => shot.kind === "video")).toBe(true);
    for (const field of ["price", "parameters", "prompt"]) expect(shown.shots[0]).not.toHaveProperty(field);
    await world.generate();
    await world.renderer.drain();
    expect(exec(world, "shot-1")?.request.extras).toMatchObject({ duration: 5, aspect_ratio: "9:16" });
    expect(exec(world, "shot-2")?.request.extras, "节点上改的那一段：发出去的就是改后的").toMatchObject({ duration: 8, aspect_ratio: "9:16" });
    expect(exec(world, "shot-3")?.request.extras).toMatchObject({ duration: 5, aspect_ratio: "16:9" });
    expect(world.vendor.executes.every((entry) => entry.request.kind === "text_to_video")).toBe(true);
  });
});

describe("「不生成 ×」：可撤回；全去掉卡还在，「取消」才关", () => {
  it("去掉第 2 镜 → 主按钮递的是剩下 2 镜，只发 1、3；第 2 镜节点留着、没在生成", async () => {
    const world = spendWorld();
    await shotsDraft(world);
    expect(await world.remove("shot-2")).toEqual({ ok: true, code: "shot_removed" });
    expect(world.pending()!.shots.map((shot) => shot.offer)).toEqual(["undecided", "removed", "undecided"]);
    expect(world.remainingOn(world.pending()!)).toEqual(["shot-1", "shot-3"]);
    await world.generate();
    await world.renderer.drain();
    expect(world.sentShots().sort()).toEqual(["shot-1", "shot-3"]);
    expect(world.renderer.nodeOf("shot-2"), "去掉的镜节点照旧在画布上").toBeDefined();
    const outcome = generationPresentationOutcome(world.run())!;
    expect(outcome).toMatchObject({ generating: ["shot-1", "shot-3"], removed: ["shot-2"] });
    expect(currentPresentation(world.run().generationPlan)?.closed?.by).toBe("handed_to_canvas");
  });

  it("去掉了又恢复：回到卡上等决定，「全部生成」三镜都发", async () => {
    const world = spendWorld();
    await shotsDraft(world);
    await world.remove("shot-2");
    expect(await world.restore("shot-2")).toEqual({ ok: true, code: "shot_restored" });
    expect(world.pending()!.shots.map((shot) => shot.offer)).toEqual(["undecided", "undecided", "undecided"]);
    await world.generate();
    await world.renderer.drain();
    expect(world.sentShots().sort()).toEqual(["shot-1", "shot-2", "shot-3"]);
  });

  it("三镜全去掉：卡还在（三镜都是「不生成」、主按钮没有可递的镜），点「取消」才关，一个字节不发", async () => {
    const world = spendWorld();
    await shotsDraft(world);
    for (const shotId of ["shot-1", "shot-2", "shot-3"]) await world.remove(shotId);
    const shown = world.pending();
    expect(shown?.shots.map((shot) => shot.offer)).toEqual(["removed", "removed", "removed"]);
    expect(world.remainingOn(shown!)).toEqual([]);
    expect(await world.generate([])).toMatchObject({ ok: false });
    expect(await world.cancel()).toEqual({ ok: true, code: "discarded" });
    expect(world.pending()).toBeUndefined();
    expect(world.vendor.executes).toEqual([]);
    expect(generationPresentationOutcome(world.run())).toMatchObject({ removed: ["shot-1", "shot-2", "shot-3"], generating: [] });
  });

  it("连点两下「不生成 ×」/「恢复」：第二下原样回成功", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    const shown = world.pending()!;
    await world.remove("shot-1", shown);
    const reshown = world.pending()!;
    expect(await world.remove("shot-1", reshown)).toEqual({ ok: true, code: "shot_removed" });
    await world.restore("shot-1", reshown);
    expect(await world.restore("shot-1", world.pending()!)).toEqual({ ok: true, code: "shot_restored" });
  });
});

describe("任务 C：节点上先点了 ↑，卡上「生成剩下 N 段」", () => {
  it("画布接手那一镜（只花一次），卡上剩下 2 段；「生成剩下 2 段」只发那 2 段；三镜各一笔，出价关", async () => {
    const world = spendWorld();
    await shotsDraft(world);
    await world.renderer.nodeUp(world.renderer.nodeOf("shot-1")!.nodeId);
    const shown = world.pending()!;
    expect(shown.shots.map((shot) => [shot.shotId, shot.offer])).toEqual([["shot-1", "taken_by_canvas"], ["shot-2", "undecided"], ["shot-3", "undecided"]]);
    expect(world.remainingOn(shown)).toEqual(["shot-2", "shot-3"]);
    await world.generate();
    await world.renderer.drain();
    expect(world.sentShots().sort()).toEqual(["shot-1", "shot-2", "shot-3"]);
    expect(world.pending()).toBeUndefined();
    expect(generationPresentationOutcome(world.run())).toMatchObject({ generating: ["shot-2", "shot-3"], takenByCanvas: ["shot-1"] });
  });

  it("每一镜都在节点上点过了：卡自己关（没有剩下的）", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    for (const shotId of ["shot-1", "shot-2"]) await world.renderer.nodeUp(world.renderer.nodeOf(shotId)!.nodeId);
    expect(world.pending()).toBeUndefined();
    expect(currentPresentation(world.run().generationPlan)?.closed).toBeDefined();
    expect(world.sentShots().sort()).toEqual(["shot-1", "shot-2"]);
  });

  it("同一镜：卡上交出去、还没轮到时节点上又点 ↑ —— 只成一下，供应商只收到一份", async () => {
    const world = spendWorld({ holdDispatch: true });
    await shotsDraft(world, [{}]);
    await world.generate();
    const node = world.renderer.nodeOf("shot-1")!;
    const viaNode = await world.renderer.nodeUp(node.nodeId).then(() => "sent", (error: { code?: string }) => error.code ?? "refused");
    expect(viaNode, "这一镜正由卡交给另一个画布 Run：节点上那一下被认领判定口拒").toBe("production_shot_claimed");
    world.renderer.releaseDispatch();
    await world.renderer.drain();
    expect(world.vendor.executes, "同一镜两边各点一下，只发一份").toHaveLength(1);
    expect(world.renderer.dispatchErrors).toEqual([]);
    expect(generationPresentationOutcome(world.run())).toMatchObject({ generating: ["shot-1"] });
  });

  it("同一镜：节点上先点 ↑ 正在交，卡上又按「生成」—— 卡上那一下被拒（卡上的内容刚变了），供应商只收到一份", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    const shown = world.pending()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = world.vendor.answer;
    world.vendor.answer = async (call) => { await gate; return original(call); };
    const viaNode = world.renderer.nodeUp(world.renderer.nodeOf("shot-1")!.nodeId);
    await settleMicrotasks();
    const viaCard = await world.generate(["shot-1"], shown);
    expect(viaCard).toMatchObject({ ok: false, message: "generation_quote_changed" });
    release();
    await viaNode;
    await world.renderer.drain();
    expect(world.vendor.executes).toHaveLength(1);
    expect(world.pending()!.shots.map((shot) => [shot.shotId, shot.offer])).toEqual([["shot-1", "taken_by_canvas"], ["shot-2", "undecided"]]);
  });
});

describe("身份：卡上的内容刚变了，看一眼再按", () => {
  it("卡摆出来之后 Agent 改了第 1 镜：拿旧卡按「生成」被拒、一镜不发；看新卡再按就发", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    const stale = world.pending()!;
    await world.operations.patch(PROJECT_ID, OPERATION_ID, { prompt: "改成一只纸鹤" }, new Date().toISOString(), "shot-1");
    await world.canvasLanding.settleCanvasLanding(PROJECT_ID);
    expect(await world.generate(undefined, stale)).toMatchObject({ ok: false, code: "failed", message: "generation_quote_changed" });
    expect(await world.cancel(stale)).toMatchObject({ ok: false, message: "generation_quote_changed" });
    await world.renderer.drain();
    expect(world.vendor.executes).toEqual([]);
    const fresh = world.pending()!;
    expect(fresh.quoteId).not.toBe(stale.quoteId);
    await world.generate(undefined, fresh);
    await world.renderer.drain();
    expect(exec(world, "shot-1")?.request.prompt, "节点跟着 Agent 改了稿，发出去的就是改后的").toBe("改成一只纸鹤");
  });

  it("点名不在卡上的镜：一镜都不交", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    expect(await world.generate(["shot-1", "foreign"])).toMatchObject({ ok: false, reason: "generation_scope_invalid" });
    await world.renderer.drain();
    expect(world.vendor.executes).toEqual([]);
    expect(world.pending()!.shots.map((shot) => shot.offer)).toEqual(["undecided", "undecided"]);
  });

  it("不是当前打开的项目：run_not_open，什么都不动", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}]);
    const shown = world.pending()!;
    world.setProjectOpen(false);
    expect(await world.generate(undefined, shown)).toEqual({ ok: false, code: "run_not_open" });
    expect(await world.cancel(shown)).toEqual({ ok: false, code: "run_not_open" });
    world.setProjectOpen(true);
    expect(world.pending()?.quoteId).toBe(shown.quoteId);
  });

  it("重新出价 = 新的卡身份：旧卡上的「生成」不许批新的这一张", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}]);
    const first = world.pending()!;
    await world.cancel(first);
    await world.handler({ capability: "present", params: { operationId: OPERATION_ID }, lease });
    const second = world.pending()!;
    expect(second.quoteId).not.toBe(first.quoteId);
    expect(second.presentationEpoch).toBeGreaterThan(first.presentationEpoch!);
    expect(await world.generate(undefined, first)).toMatchObject({ ok: false });
    await world.renderer.drain();
    expect(world.vendor.executes).toEqual([]);
  });
});
