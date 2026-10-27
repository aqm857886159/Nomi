import { afterEach, describe, expect, it } from "vitest";

import { currentPresentation, generationPresentationOutcome } from "../shared/productionGenerationPresentation";
import { spendAuthorizationGates } from "../shared/productionSpendAuthority";
import { GENERATION_METHODS } from "../shared/agentCapabilities/generation";
import { resolveGateScope } from "./mcpGenerationMultiShot";
import { createInMemoryGenerationOperationStore } from "./mcpGenerationOperationMemoryStore";
import { OPERATION_ID, PROJECT_ID, callTool, candidate, lease, now, resetSpendFixture, shotsDraft, spendWorld, type SpendWorld } from "./agentPanelSpendConfirmTestUtils";

// 不点名的 `generate` 只重摆最近一张卡上还没定的镜（2026-10-27，设计卡 docs/plan/2026-10-27-shot-scope-undecided.md ★9）。
//
// 以前「没点名」在 handler 里就被翻译成「点名全部」：卡上外的镜、正在生成的镜都会被摆回卡上；「直接生成」档会替用户
// 再决一次，同一镜花两次钱。这里跑的是生产同一份接线（持久 Run、真 handler、真传输、真画布交接），断言卡、回执、供应商三处。

afterEach(resetSpendFixture);

type Presented = Readonly<{ shots?: readonly string[] }>;
type Decision = Readonly<{ ok?: boolean; code?: string; message?: string; result?: Record<string, unknown> }>;

const onCard = (world: SpendWorld) => world.pending()?.shots.map((shot) => shot.shotId);
/** Agent 那一侧的 `generate`，经 handler（不点名就不带 `shotIds` 这个键）。 */
const present = async (world: SpendWorld, shotIds?: unknown): Promise<Presented> =>
  await world.handler({ capability: "present", params: { operationId: OPERATION_ID, ...(shotIds === undefined ? {} : { shotIds }) }, lease }) as Presented;
/** 模型那一侧真正走得到的一次 `generate`（传输：失败按放行表收敛成模型看得见的码和正文）。 */
const modelGenerates = async (world: SpendWorld, mode: "request" | "direct" = "request", shotIds?: readonly string[]): Promise<Decision> =>
  await callTool(world.transport(mode), GENERATION_METHODS.plan, { operation: "present", operationId: OPERATION_ID, ...(shotIds ? { shotIds } : {}) }) as Decision;
const sentSorted = (world: SpendWorld) => [...world.sentShots()].sort();

/** 三镜草稿摆上卡，卡上点 `shot-1`「生成」交到供应商，再「取消」关卡：shot-1 在生成，shot-2/3 没定（R-b 的前半段）。 */
async function firstShotGeneratingThenCancelled(world: SpendWorld): Promise<void> {
  await shotsDraft(world, [{}, {}, {}], false);
  await present(world);
  await world.generate(["shot-1"]);
  await world.renderer.drain();
  await world.cancel();
  expect(generationPresentationOutcome(world.run())).toMatchObject({
    closedBy: "user_closed", generating: ["shot-1"], undecided: [{ shotId: "shot-2" }, { shotId: "shot-3" }],
  });
}

describe("不点名的 generate：只重摆最近一张卡上还没定的镜", () => {
  it("A1（R-a）：第一次点名 shot-1、卡开着；不点名再出价 → 卡和回执都只有 shot-1", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}, {}], false);
    await present(world, ["shot-1"]);
    expect(onCard(world)).toEqual(["shot-1"]);
    const again = await present(world);
    expect(onCard(world), "卡外的 shot-2/3 不许混进来").toEqual(["shot-1"]);
    expect(again.shots, "回执说的 = 卡上摆的").toEqual(["shot-1"]);
    const viaModel = await modelGenerates(world);
    expect(viaModel).toMatchObject({ ok: true, result: { shots: ["shot-1"] } });
    expect(onCard(world)).toEqual(["shot-1"]);
    expect(world.vendor.executes).toEqual([]);
  });

  it("A1 经 store：新车道不经 handler、直接调 store.present 不点名 → 规则在 Run 主人那里，卡上仍只有 shot-1", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}, {}], false);
    await world.operations.present(PROJECT_ID, OPERATION_ID, now(), ["shot-1"]);
    await world.operations.present(PROJECT_ID, OPERATION_ID, now(), undefined);
    expect(currentPresentation(world.run().generationPlan)!.shotIds).toEqual(["shot-1"]);
    expect(world.run().generationPlan!.presentations).toHaveLength(2);
  });

  it("A2（R-b）：shot-1 交给画布后取消关卡；不点名再出价 → 卡和回执只有 shot-2/3，在生成的 shot-1 不再上卡", async () => {
    const world = spendWorld();
    await firstShotGeneratingThenCancelled(world);
    const again = await present(world);
    expect(onCard(world)).toEqual(["shot-2", "shot-3"]);
    expect(again.shots).toEqual(["shot-2", "shot-3"]);
    expect(world.sentShots(), "到这里供应商只收到过 shot-1 那一次").toEqual(["shot-1"]);
  });

  it("A2 变体：卡上两镜都在交时不点名再出价 → 模型读得懂的拒绝（逐镜状态 + 可点名的 id），账本一个字不动", async () => {
    const world = spendWorld({ holdDispatch: true });
    await shotsDraft(world, [{}, {}]);
    await world.generate();
    const before = world.run();
    const refused = await modelGenerates(world);
    expect(refused).toMatchObject({ ok: false, code: "generation_input_invalid" });
    expect(refused.message).toMatch(/shot-1: generating/);
    expect(refused.message).toMatch(/shot-2: generating/);
    expect(refused.message, "拒绝要给下一步：点名").toMatch(/call generate again with shotIds naming them/);
    expect(refused.message).toMatch(/Shots you can name: shot-1, shot-2\./);
    expect(world.run(), "被拒 = 什么都没写").toEqual(before);
    world.renderer.releaseDispatch();
    await world.renderer.drain();
    expect(sentSorted(world), "在交的照常交完，各一次").toEqual(["shot-1", "shot-2"]);
  });

  it("A5：点名无效（空 / 重复 / 不存在）→ generation_input_invalid，正文点出那一镜并列出可点名的；账本一个字不动", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}, {}], false);
    await present(world, ["shot-1"]);
    const before = world.run();
    const cases: ReadonlyArray<readonly [readonly string[], RegExp]> = [
      [[], /shotIds is empty/],
      [["shot-2", "shot-2"], /names shot-2 more than once/],
      [["shot-9"], /shot-9 is not one of the shots you can name here/],
    ];
    for (const [shotIds, says] of cases) {
      const refused = await modelGenerates(world, "request", shotIds);
      expect(refused, JSON.stringify(shotIds)).toMatchObject({ ok: false, code: "generation_input_invalid" });
      expect(refused.message).toMatch(says);
      expect(refused.message).toMatch(/Shots you can name: shot-1, shot-2, shot-3\./);
    }
    // 传输的 schema 拦不到的形状（直接经 handler）：不是数组、空项。
    await expect(present(world, "shot-2")).rejects.toThrow(/shotIds must be a list of shot ids/);
    await expect(present(world, ["shot-2", " "])).rejects.toThrow(/an entry that is not a shot id/);
    expect(world.run()).toEqual(before);
  });

  it("A5：点名一镜已送过（重试）→ 收下，不收窄成「只许没定的」", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    await world.generate(["shot-1"]);
    await world.renderer.drain();
    const retried = await present(world, ["shot-1"]);
    expect(onCard(world)).toEqual(["shot-1"]);
    expect(retried.shots).toEqual(["shot-1"]);
  });

  it("A6：从没出过价的草稿不点名 → 勾着、没送过、没去掉过的全部，按计划顺序", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}, {}], false);
    const first = await present(world);
    expect(onCard(world)).toEqual(["shot-1", "shot-2", "shot-3"]);
    expect(first.shots).toEqual(["shot-1", "shot-2", "shot-3"]);
  });
});

describe("「直接生成」档不扣两次", () => {
  it("A12(a)：R-b 形状下不点名再出价 → 新卡只摆 shot-2/3，在生成的 shot-1 不会被策略再决一次；人点完每一镜恰好一次", async () => {
    const world = spendWorld();
    await firstShotGeneratingThenCancelled(world);
    const presented = await modelGenerates(world, "direct");
    expect(presented).toMatchObject({ ok: true });
    await world.renderer.drain();
    expect(currentPresentation(world.run().generationPlan)!.shotIds).toEqual(["shot-2", "shot-3"]);
    expect(onCard(world)).toEqual(["shot-2", "shot-3"]);
    expect(sentSorted(world), "shot-1 不许被策略再决一次").toEqual(["shot-1"]);
    // 用户只批过 shot-1：shot-2/3 是「说好的计划」之外的新镜，「直接生成」档照 10-12 的刹车退回给人点（不是这次改的）。
    expect(world.pending()?.brake?.reason).toBe("out-of-plan");
    await world.generate();
    await world.renderer.drain();
    expect(sentSorted(world), "每一镜恰好一次").toEqual(["shot-1", "shot-2", "shot-3"]);
    expect(world.vendor.executes).toHaveLength(3);
  });

  it("A12(b)：卡上的镜都在生成时不点名 → 被拒，一镜都不交", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}]);
    await world.generate();
    await world.renderer.drain();
    expect(sentSorted(world)).toEqual(["shot-1", "shot-2"]);
    const refused = await modelGenerates(world, "direct");
    expect(refused).toMatchObject({ ok: false, code: "generation_input_invalid" });
    await world.renderer.drain();
    expect(sentSorted(world)).toEqual(["shot-1", "shot-2"]);
  });
});

describe("付费门（外部宿主那一条路）不点名：只封最近一张卡上还没定的", () => {
  const view = (outcome?: Parameters<typeof resolveGateScope>[0]["presentationOutcome"]) => ({
    state: "draft",
    shots: [{ shotId: "shot-1" }, { shotId: "shot-2" }, { shotId: "shot-3" }],
    ...(outcome ? { presentationOutcome: outcome } : {}),
  });
  const outcome = (closedBy: string, undecided: readonly string[], generating: readonly string[] = []) => ({
    closedBy, generating, failedBeforeSending: [], removed: [], takenByCanvas: [], undecided: undecided.map((shotId) => ({ shotId })),
  });

  it("A3：开着的卡上没定的是 shot-2 → 只封 shot-2", () => {
    expect(resolveGateScope(view(outcome("open", ["shot-2"], ["shot-1"])), undefined)).toEqual({ kind: "seal", scope: ["shot-2"] });
  });
  it("A3（R-d）：卡已关、没定的只有 shot-2 → 只封 shot-2", () => {
    expect(resolveGateScope(view(outcome("user_closed", ["shot-2"], ["shot-1"])), undefined)).toEqual({ kind: "seal", scope: ["shot-2"] });
  });
  it("A3（R-c）：开着的卡上一镜都不剩待定 → 拒绝、不封，告诉它另起一份草稿", () => {
    expect(() => resolveGateScope(view(outcome("open", [], ["shot-1", "shot-2", "shot-3"])), undefined))
      .toThrow(/nothing to seal[\s\S]*start a new draft/);
  });
  it("A3：从没出过价 → 封勾着、没封过的全部（外部宿主第一次封整份草稿的形状不变）", () => {
    expect(resolveGateScope(view(), undefined)).toEqual({ kind: "seal", scope: ["shot-1", "shot-2", "shot-3"] });
  });
  it("A3：点名必须是此刻还能封的镜", () => {
    const sealed = { ...view(outcome("open", ["shot-2"])), shots: [{ shotId: "shot-1", contract: {} }, { shotId: "shot-2" }, { shotId: "shot-3" }] };
    expect(resolveGateScope(sealed, ["shot-3", "shot-2"])).toEqual({ kind: "seal", scope: ["shot-2", "shot-3"] });
    expect(() => resolveGateScope(sealed, ["shot-1"])).toThrow(/shot-1 is not one of the shots you can name here/);
  });

  it("A4：有一道门在等（盖 shot-2）：不点名 / 点名同一批 → 复用；点名别的 → 先撤再封；点名重复 / 未知 → 拒绝", () => {
    const waiting = { ...view(outcome("open", ["shot-2"])), authorization: { status: "waiting", envelope: { jobs: [{ shotId: "shot-2" }] } } };
    expect(resolveGateScope(waiting, undefined)).toEqual({ kind: "reuse", scope: ["shot-2"] });
    expect(resolveGateScope(waiting, ["shot-2"])).toEqual({ kind: "reuse", scope: ["shot-2"] });
    expect(resolveGateScope(waiting, ["shot-1"])).toEqual({ kind: "abandon-then-seal" });
    expect(() => resolveGateScope(waiting, ["shot-2", "shot-2"])).toThrow(/more than once/);
    expect(() => resolveGateScope(waiting, ["ghost"])).toThrow(/ghost is not one of the shots you can name here/);
  });

  it("A3（R-d 真形状）：shot-1 交给画布、shot-3 去掉、取消关卡 → gate 不点名，那道门只盖 shot-2", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}, {}], false);
    await present(world);
    await world.generate(["shot-1"]);
    await world.renderer.drain();
    await world.remove("shot-3");
    await world.cancel();
    await world.handler({ capability: "gate_request", params: { operationId: OPERATION_ID }, lease });
    const waiting = spendAuthorizationGates(world.run()).filter((gate) => gate.status === "waiting");
    expect(waiting.flatMap((gate) => gate.authorizationEnvelope.jobs.map((job) => job.shotId)),
      "shot-1 在画布那一侧生成、制作 Run 上没有合同：今天会被当成「没封过」再封一次").toEqual(["shot-2"]);
  });
});

describe("内存 store 不再有第二份出价默认（D5）", () => {
  it("A9：内存 store 拒绝 present：它没有出价账；持久 store 是唯一实现（上面每一格跑的都是它）", async () => {
    const store = createInMemoryGenerationOperationStore();
    await store.create({ operationId: OPERATION_ID, projectId: PROJECT_ID, candidate: candidate("img-model"), now: now() });
    expect(() => store.present(PROJECT_ID, OPERATION_ID, now(), undefined)).toThrow(/no offer ledger/);
  });
});
