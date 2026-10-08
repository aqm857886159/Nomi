import { normalizeLegacyPresentation } from "../shared/productionGenerationPresentation";
import { describe, expect, it } from "vitest";

import type { PlanCandidate } from "../capabilityCore/executionContract";
import { assertPendingSpendIdentity, listPendingSpendConfirms, projectPendingSpendConfirm } from "./productionPendingSpend";
import type { ModelPricing } from "./shotPricing";
import type { ProductionRun } from "./productionRunTypes";

// 付费卡的**宿主投影**。这里钉死的三件事都只在钱这条轴上看得见：
//   ① 价格是宿主按目录算的数字，不是渲染层从参数反推的；
//   ② 算不出就说算不出，`{known:false}` 一路带到卡上——**绝不落成 0**；
//   ③ 只投影 agent 自己那条路（`origin.host === "nomi"`）：外部 MCP 宿主的用户此刻没在看这块面板。

const NOW = "2026-09-11T00:00:00.000Z";

const PRICING: Record<string, ModelPricing> = {
  "fixture-provider::priced": { cost: 0.3, enabled: true, specCosts: [{ specKey: "duration:5", cost: 0.2, enabled: true }] },
};

const resolvePricing = (providerId: string, modelId: string): ModelPricing | undefined => PRICING[`${providerId}::${modelId}`];

function candidate(id: string, modelId: string, parameters: Record<string, unknown> = {}): PlanCandidate {
  return {
    candidateId: id,
    revision: 2,
    moduleId: "generation.single-shot",
    providerId: "fixture-provider",
    modelId,
    mode: "text-to-image",
    modeId: "t2i",
    prompt: `prompt ${id}`,
    parameters,
    references: [],
  };
}

/**
 * 夹具按上一版的形状写（没有 `presentations`）：和仓库读盘一样先过唯一的归一点——「草稿没藏卡 = 卡开着」。
 */
function run(overrides: Partial<ProductionRun> = {}): ProductionRun {
  const top = candidate("cand-a", "priced", { duration: "3" });
  return normalizeLegacyPresentation({
    schemaVersion: 1, runId: "op-a", projectId: "project-1", revision: 3,
    status: "draft", stageId: "generate", playbook: { name: "generation.single-shot", version: "1.0.0" },
    origin: { host: "nomi", actorId: "project-agent-host" },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 2, minimizeUploads: true },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1, snapshotCursor: 3, stages: [], gates: [], jobs: [], artifacts: [],
    generationPlan: { operationId: "op-a", state: "draft", candidate: top, nodeId: "node-a", updatedAt: NOW },
    createdAt: NOW, updatedAt: NOW,
    ...overrides,
  });
}

describe("付费卡的宿主投影", () => {
  it("agent 建的草稿 = 一笔等人点头的生成，带宿主算出来的价", () => {
    const pending = projectPendingSpendConfirm(run(), resolvePricing);
    expect(pending).toBeDefined();
    expect(pending!.shots).toHaveLength(1);
    expect(pending!.shots[0]).toMatchObject({ nodeId: "node-a", index: 1, modelId: "priced", modeId: "t2i" });
    expect(pending!.shots[0].price).toEqual({ known: true, amount: 0.3 });
    expect(pending!.knownSubtotal).toBeCloseTo(0.3, 5);
    expect(pending!.unknownShotCount).toBe(0);
    expect(pending!.presentationId).toBe("op-a:presentation:1");
    expect(pending!.presentationEpoch).toBe(1);
    expect(pending!.policySnapshot).toEqual({ mode: "safe-auto", spend: "confirm" });
  });

  it("旧卡的身份是 durable epoch：策略切换不会把同一张卡改成另一张", () => {
    const pending = projectPendingSpendConfirm(run(), resolvePricing)!;
    expect(() => assertPendingSpendIdentity(pending, {
      presentationId: pending.presentationId,
      presentationEpoch: pending.presentationEpoch,
      planVersion: pending.planVersion,
      quoteId: pending.quoteId,
    })).not.toThrow();
    expect(() => assertPendingSpendIdentity(pending, {
      presentationId: pending.presentationId,
      presentationEpoch: pending.presentationEpoch! + 1,
      planVersion: pending.planVersion,
      quoteId: pending.quoteId,
    })).toThrowError("generation_presentation_stale");
  });

  it("命中的规格加价进价格（价目就是目录里那份，不是这里编的）", () => {
    const withDuration = run();
    withDuration.generationPlan!.candidate = candidate("cand-a", "priced", { duration: "5" });
    const pending = projectPendingSpendConfirm(withDuration, resolvePricing);
    expect(pending!.shots[0].price).toEqual({ known: true, amount: 0.5 });
  });

  it("目录里没有价目 → 诚实的 unknown，绝不落成 0", () => {
    const unpriced = run();
    unpriced.generationPlan!.candidate = candidate("cand-a", "unpriced");
    const pending = projectPendingSpendConfirm(unpriced, resolvePricing);
    expect(pending!.shots[0].price).toEqual({ known: false });
    expect(pending!.unknownShotCount).toBe(1);
    // 阳性对照：这里如果哪天被兜底成 0，下面这条会先红。
    expect(pending!.knownSubtotal).toBe(0);
    expect(pending!.shots[0].price).not.toEqual({ known: true, amount: 0 });
  });

  it("已封印 + 付费门在等 = 同一张卡的另一档（带 gateId；卡不区分这两档，命令那层才区分）", () => {
    const sealed = run({
      gates: [{ gateId: "gate-1", scope: "budget_envelope", status: "waiting", planHash: "d1", authorizationDigest: "d1", authorizationEnvelope: { gateId: "gate-1", jobs: [] } as never, title: "", summary: "", jobIds: [], createdAt: NOW, expiresAt: NOW } as ProductionRun["gates"][number]],
    });
    sealed.generationPlan = { ...sealed.generationPlan!, state: "sealed" };
    const pending = projectPendingSpendConfirm(sealed, resolvePricing);
    expect(pending?.gateId).toBe("gate-1");
  });

  it("这一次出价里每一镜都决定了 / 卡关了 / 计划取消了 → 不出卡（那已经不是「等你决定」了）", () => {
    // 逐镜（付费卡①）：卡在不在只看这一次出价——每一镜都有一份批过的授权盖着，就没有要问的了。
    const decided = run({
      gates: [{ gateId: "gate-1", scope: "budget_envelope", status: "approved", planHash: "d1", authorizationDigest: "d1",
        authorizationEnvelope: { gateId: "gate-1", jobs: [{ shotId: "cand-a" }] } as never, title: "", summary: "", jobIds: [], createdAt: NOW, expiresAt: NOW } as ProductionRun["gates"][number]],
    });
    // 那道门是在这一次出价里点出来的（出价开着时 Run 上还没有付费门：fromGate 0）。
    decided.generationPlan = { ...decided.generationPlan!, state: "sealed", presentations: [{ shotIds: ["cand-a"], openedAt: NOW, fromGate: 0 }] };
    expect(projectPendingSpendConfirm(decided, resolvePricing)).toBeUndefined();
    const closed = run();
    closed.generationPlan = { ...closed.generationPlan!, state: "submitted",
      presentations: [{ shotIds: ["cand-a"], openedAt: NOW, fromGate: 0, closed: { at: NOW, by: "user_closed" } }] };
    expect(projectPendingSpendConfirm(closed, resolvePricing)).toBeUndefined();
    const cancelled = run();
    cancelled.generationPlan = { ...cancelled.generationPlan!, state: "cancelled" };
    expect(projectPendingSpendConfirm(cancelled, resolvePricing)).toBeUndefined();
  });

  it("外部 MCP 宿主发起的那笔不进面板：它的用户此刻没在看这块面板", () => {
    expect(projectPendingSpendConfirm(run({ origin: { host: "semantic-mcp" } }), resolvePricing)).toBeUndefined();
    expect(projectPendingSpendConfirm(run({ origin: { host: "codex" } }), resolvePricing)).toBeUndefined();
  });

  it("多镜只投影被勾选的那些，序号从 1 起（翻页器印的就是它）", () => {
    const base = run();
    const multi = run({ generationPlan: {
      ...base.generationPlan!,
      presentations: undefined,
      shots: [
        { shotId: "s1", candidate: candidate("c1", "priced"), nodeId: "node-1", updatedAt: NOW },
        { shotId: "s2", candidate: candidate("c2", "priced"), included: false, updatedAt: NOW },
        { shotId: "s3", candidate: candidate("c3", "unpriced"), nodeId: "node-3", updatedAt: NOW },
      ],
    } });
    const pending = projectPendingSpendConfirm(multi, resolvePricing)!;
    expect(pending.shots.map((shot) => shot.shotId)).toEqual(["s1", "s3"]);
    expect(pending.shots.map((shot) => shot.index)).toEqual([1, 2]);
    expect(pending.unknownShotCount).toBe(1);
  });

  /**
   * 「我知道有一笔在等，但我一镜都画不出来」——这不是空，是失败（2026-09-12）。
   *
   * 它原来写的是 `return undefined`，和「真的没有要确认的东西」长得一模一样。后果是：
   * 门一直 `waiting`，面板一张卡都没有，用户只看到沉默。现在它喊出来，读通道据此拒绝，
   * 渲染层渲那张会说话的卡。
   */
  it("等人点头却投影不出任何一镜 → 抛，不写成「没有」", () => {
    const broken = run();
    broken.generationPlan = { ...broken.generationPlan!, shots: [] };
    // 阳性对照：`shotsOf` 的退路把 `plan.candidate` 当成那一镜，所以正常的空 shots 仍然出卡。
    expect(projectPendingSpendConfirm(broken, resolvePricing)?.shots).toHaveLength(1);

    // 退路自己也塌了的时候：**抛**，不是回 undefined。断在 `shotsOf` 还是断在那道守卫都行，
    // 这条测试要的只有一件事——这个函数不许在「明明有一笔在等」的时候安静地回「没有」。
    const empty = run();
    empty.generationPlan = { ...empty.generationPlan!, shots: [], candidate: undefined as never };
    let outcome: unknown = "did-not-throw";
    try { outcome = projectPendingSpendConfirm(empty, resolvePricing); } catch (error) { outcome = error; }
    expect(outcome).toBeInstanceOf(Error);
  });

  // ── T-AG-04：「全自动」档不该再弹报价卡 ───────────────────────────────────
  //
  // 三条一起才算钉住，少一条就会退回旧形状：①「代答中不出卡」是新行为；②「代答不上的那一笔
  // 照旧出卡」是**必须保留**的行为（策略答不了才问人，也包括用户看着一张卡时切进全自动）；
  // ③ 封印那一支一个字不动——代答链第一步就是封印，之后任何一步失败都停在「sealed + 门还等着」。
  it("全自动档代答中的那一笔不投影成卡（草稿落盘到封印之间不许闪卡）", () => {
    const fullAuto = run();
    fullAuto.generationPlan = { ...fullAuto.generationPlan!, presentations: [{
      ...fullAuto.generationPlan!.presentations![0], policySnapshot: { mode: "project", spend: "confirm" },
    }] };
    expect(projectPendingSpendConfirm(fullAuto, resolvePricing)).toBeUndefined();
    expect(listPendingSpendConfirms([fullAuto], resolvePricing)).toEqual([]);
  });

  it("full-auto policy failure restores the same pending card", () => {
    const failed = run();
    failed.generationPlan = { ...failed.generationPlan!, presentations: [{
      ...failed.generationPlan!.presentations![0],
      policySnapshot: { mode: "project", spend: "confirm" },
      policyDecisionState: "failed",
    }] };
    expect(projectPendingSpendConfirm(failed, resolvePricing)).toBeDefined();
  });

  it("没有代答在飞的草稿照旧出卡（每步问 / 自动改两档，以及代答失败后卡回到原处）", () => {
    expect(projectPendingSpendConfirm(run(), resolvePricing)).toBeDefined();
    expect(projectPendingSpendConfirm(run(), resolvePricing)).toBeDefined();
  });

  it("封印后门还等着的那一笔，在全自动档下仍然出卡（代答链失败 = 它真的在等人）", () => {
    const sealed = run({
      gates: [{ gateId: "gate-a", scope: "budget_envelope", status: "waiting", planHash: "d-a", authorizationDigest: "d-a", authorizationEnvelope: { gateId: "gate-a", jobs: [] } as never, title: "", summary: "", jobIds: [], createdAt: NOW, expiresAt: NOW } as ProductionRun["gates"][number]],
    });
    sealed.generationPlan = { ...sealed.generationPlan!, state: "sealed" };
    expect(projectPendingSpendConfirm(sealed, resolvePricing)).toBeDefined();
  });

  it("一个项目里多笔时按 updatedAt 排序（介入槽只显示第一张，其余算「还有 N 条」）", () => {
    const older = run({ runId: "op-old", updatedAt: "2026-09-10T00:00:00.000Z" });
    const newer = run({ runId: "op-new", updatedAt: "2026-09-12T00:00:00.000Z" });
    expect(listPendingSpendConfirms([newer, older], resolvePricing).map((row) => row.runId))
      .toEqual(["op-old", "op-new"]);
  });
});
