import { afterEach, describe, expect, it } from "vitest";

import { currentPresentation } from "../shared/productionGenerationPresentation";
import { spendAuthorizationGates } from "../shared/productionSpendAuthority";
import { GENERATION_METHODS } from "../shared/agentCapabilities/generation";
import {
  PROJECT_ID, OPERATION_ID, callTool, candidate, receiptOfCanvasRun, resetSpendFixture, shotsDraft, spendWorld, type SpendWorld,
} from "./agentPanelSpendConfirmTestUtils";

// 档位 × 付费卡（D2 第③步 3b：直接生成也是同一台发动机）。「直接生成」档不是另一条花钱的路：主进程替用户记一笔**策略交接**，
// 逐镜照样走画布单节点提交，每一镜派发时按策略铸那一张收据（`policy:full_auto` / `policy:project:agent-lane`）。卡只在
// 策略答不了的时候出来（刹车 / 有一镜没交到 / 托管要先问人），带着每一镜的原因，由人点。其它档一个字没变：卡照常出现、
// 供应商一次没碰。

afterEach(resetSpendFixture);

type ToolResult = Readonly<{ ok?: boolean; result?: Record<string, unknown> & { drafted?: { operation?: { operationId?: string } }; operation?: { operationId?: string } } }>;

/** 模型那一侧真正走得到的一轮：建一份单镜草稿（卡不藏：建好就是摆到用户面前的那一刻）。 */
async function modelDrafts(world: SpendWorld, mode?: "direct" | "request"): Promise<{ created: ToolResult; operationId: string }> {
  const created = await callTool(world.transport(mode), GENERATION_METHODS.plan, {
    operation: "create", taskKind: "text_to_image", candidate: candidate("img-model", { size: "1024x1024" }),
  }) as ToolResult;
  const operationId = created.result?.drafted?.operation?.operationId ?? created.result?.operation?.operationId ?? "";
  return { created, operationId };
}

/** 模型那一侧的 `generate`：把 `shotsDraft(…, present=false)` 起草好、藏着卡的那几镜摆出来。 */
async function modelPresents(world: SpendWorld, mode?: "direct" | "request"): Promise<ToolResult> {
  return await callTool(world.transport(mode), GENERATION_METHODS.plan, { operation: "present", operationId: OPERATION_ID }) as ToolResult;
}

const handOversOf = (world: SpendWorld, operationId = OPERATION_ID) => currentPresentation(world.run(operationId).generationPlan)?.handOvers ?? [];

describe("「直接生成」档：替用户交给画布，不出卡", () => {
  it("建好草稿就交：供应商收到一次；收据写着策略（不编一个窗口出来）；工具结果说得出是策略批的", async () => {
    const world = spendWorld();
    const { created, operationId } = await modelDrafts(world, "direct");
    expect(operationId, "建草稿必须成功——后面每一条断言都以它为前提").toBeTruthy();
    expect(world.pending(), "没有卡：等用户点头的那一笔不存在，已经按档位决过了").toBeUndefined();
    expect(world.vendor.executes).toHaveLength(1);
    expect(world.vendor.executes[0].request.extras).toMatchObject({ productionRunId: operationId, size: "1024x1024" });
    const [handOver] = handOversOf(world, operationId);
    expect(handOver).toMatchObject({ by: "policy", settled: { outcome: "accepted" } });
    const receipt = receiptOfCanvasRun(world, handOver.canvasRunId!)!;
    expect(receipt.decidedBy).toBe("policy:full_auto");
    expect(receipt.humanActor).toBe("policy:project:agent-lane");
    expect(receipt.gestureAttestation.kind).toBe("policy_decision");
    expect(created).toMatchObject({ ok: true, result: { spendDecision: { decidedBy: "policy:full_auto" } } });
    expect(currentPresentation(world.run(operationId).generationPlan)!.closed?.by).toBe("handed_to_canvas");
  });

  it("从草稿落盘到交到为止，账本上的每一刻都不出卡（用户刚授权过的事不该被再问一遍）", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}, {}], false);
    const observed: Array<{ cards: number; handingOver: boolean }> = [];
    world.subscribe((run) => {
      if (run.runId !== OPERATION_ID) return;
      const presentation = currentPresentation(run.generationPlan);
      observed.push({
        cards: world.card.listPendingSpend(PROJECT_ID).length,
        handingOver: Boolean(presentation && !presentation.closed && presentation.handOvers?.some((entry) => !entry.settled)),
      });
    });
    const presented = await modelPresents(world, "direct");
    expect(presented).toMatchObject({ ok: true, result: { spendDecision: { decidedBy: "policy:full_auto" } } });
    // 阳性对照：确实观察到了「出价开着、交接还在路上」的那几刻——也就是旧代码会出卡的那一段。
    expect(observed.some((entry) => entry.handingOver), "观察点没走到 = 这条测试什么都没验").toBe(true);
    expect(observed.map((entry) => entry.cards).filter((cards) => cards > 0)).toEqual([]);
    expect(world.sentShots().sort()).toEqual(["shot-1", "shot-2", "shot-3"]);
  });

  it("交接那一下渲染层正在问：也不出卡（策略在交，节点上照常排队）", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}], false);
    const cardsAtConsent: number[] = [];
    world.renderer.setBeforeConsent(() => { cardsAtConsent.push(world.card.listPendingSpend(PROJECT_ID).length); });
    await modelPresents(world, "direct");
    expect(cardsAtConsent).toEqual([0]);
  });
});

describe("「直接生成」档答不了：卡带着原因出来，由人点", () => {
  it("一镜本机判出发不出去：另两镜照发；卡出来、标着要人工决定，只剩那一镜（参数被拒·去改）；工具结果是等用户", async () => {
    let broken = true;
    const world = spendWorld({ validateNode: (node) => broken && node.shotId === "shot-2" ? { kind: "parameter_rejected", code: "reference_required" } : null });
    await shotsDraft(world, [{}, {}, {}], false);
    const presented = await modelPresents(world, "direct");
    expect(presented.result?.spendDecision, "没决成：不许说策略批了").toBeUndefined();
    expect(world.sentShots().sort()).toEqual(["shot-1", "shot-3"]);
    const shown = world.pending()!;
    expect(shown.manualDecisionRequired).toBe(true);
    expect(shown.shots.map((shot) => [shot.shotId, shot.offer, shot.failure?.code ?? null])).toEqual([
      ["shot-1", "sent", null], ["shot-2", "not_sent", "reference_required"], ["shot-3", "sent", null],
    ]);
    // 人改好了、在卡上点「再试一次」：这一镜由人批（手势收据），不再借策略的名义。
    broken = false;
    await world.generate();
    await world.renderer.drain();
    expect(world.sentShots().sort()).toEqual(["shot-1", "shot-2", "shot-3"]);
    const retried = handOversOf(world).filter((entry) => entry.shotId === "shot-2").at(-1)!;
    expect(retried).toMatchObject({ by: "gesture", settled: { outcome: "accepted" } });
    expect(receiptOfCanvasRun(world, retried.canvasRunId!)!.decidedBy).toBe("human:gesture");
    expect(world.pending()).toBeUndefined();
  });

  it("交接那一问渲染层不在：一镜不发；卡出来、每一镜都「没发出去·再试一次」", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}, {}], false);
    world.renderer.setHandOverFailing(true);
    const presented = await modelPresents(world, "direct");
    expect(presented).toMatchObject({ ok: true });
    expect(presented.result?.spendDecision).toBeUndefined();
    expect(world.vendor.executes).toEqual([]);
    expect(world.pending()!.shots.map((shot) => [shot.offer, shot.failure?.code])).toEqual([["not_sent", "renderer_unavailable"], ["not_sent", "renderer_unavailable"]]);
    expect(world.pending()!.manualDecisionRequired).toBe(true);
  });
});

describe("其它档：一个字没变", () => {
  it.each([["request 档", "request" as const], ["没有档位可读（外部宿主那一侧）", undefined]])("%s：卡照常出现，供应商一次没碰", async (_label, mode) => {
    const world = spendWorld();
    const { operationId } = await modelDrafts(world, mode);
    expect(operationId).toBeTruthy();
    const shown = world.pending()!;
    expect(shown.operationId).toBe(operationId);
    expect(shown.manualDecisionRequired).toBeUndefined();
    expect(shown.shots.map((shot) => shot.offer)).toEqual(["undecided"]);
    expect(world.vendor.executes).toEqual([]);
    expect(world.renderer.handOverCalls).toEqual([]);
  });
});

describe("未知价：两条路都跑得通，账上记未知、不记 0", () => {
  function unknownOnTheLedger(world: SpendWorld, canvasRunId: string) {
    const canvasRun = world.repository.read(PROJECT_ID, canvasRunId)!;
    const gate = spendAuthorizationGates(canvasRun)[0];
    return {
      maximum: gate.authorizationEnvelope.jobs[0].price.maximum,
      unknownJobCount: gate.authorizationEnvelope.budget.unknownJobCount,
      reserved: canvasRun.budget.reserved,
      unknownInFlight: canvasRun.budget.unknownInFlight,
      reserve: world.repository.readBudgetLedger(PROJECT_ID, canvasRunId).entries.find((entry) => entry.kind === "reserve")?.amount,
    };
  }

  it("卡上点「生成」：目录一条价都没有也照样发出去；画布那一笔记的是未知", async () => {
    const world = spendWorld();
    await shotsDraft(world, [{}]);
    await world.generate();
    await world.renderer.drain();
    expect(world.vendor.executes).toHaveLength(1);
    expect(unknownOnTheLedger(world, handOversOf(world)[0].canvasRunId!)).toEqual({ maximum: null, unknownJobCount: 1, reserved: 0, unknownInFlight: 1, reserve: null });
  });

  it("「直接生成」档：未知价不退回问人，照样交完；账上同样是未知", async () => {
    const world = spendWorld();
    const { created, operationId } = await modelDrafts(world, "direct");
    expect(created).toMatchObject({ ok: true, result: { spendDecision: { decidedBy: "policy:full_auto" } } });
    expect(world.pending()).toBeUndefined();
    expect(unknownOnTheLedger(world, handOversOf(world, operationId)[0].canvasRunId!)).toEqual({ maximum: null, unknownJobCount: 1, reserved: 0, unknownInFlight: 1, reserve: null });
  });
});
