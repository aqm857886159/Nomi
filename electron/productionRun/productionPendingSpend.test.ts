import { describe, expect, it } from "vitest";

import type { PlanCandidate } from "../capabilityCore/executionContract";
import { listPendingSpendConfirms, projectPendingSpendConfirm } from "./productionPendingSpend";
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

function run(overrides: Partial<ProductionRun> = {}): ProductionRun {
  const top = candidate("cand-a", "priced", { duration: "3" });
  return {
    schemaVersion: 1, runId: "op-a", projectId: "project-1", revision: 3,
    status: "draft", stageId: "generate", playbook: { name: "generation.single-shot", version: "1.0.0" },
    origin: { host: "nomi", actorId: "project-agent-host" },
    policy: { mode: "balanced", trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 2, minimizeUploads: true },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1, snapshotCursor: 3, stages: [], gates: [], jobs: [], artifacts: [],
    generationPlan: { operationId: "op-a", state: "draft", candidate: top, nodeId: "node-a", updatedAt: NOW },
    createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
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
      gates: [{ gateId: "gate-1", scope: "budget_envelope", status: "waiting", planHash: "d1", authorizationDigest: "d1", title: "", summary: "", jobIds: [], createdAt: NOW, expiresAt: NOW } as ProductionRun["gates"][number]],
    });
    sealed.generationPlan = { ...sealed.generationPlan!, state: "sealed", authorizationGateId: "gate-1", authorizationDigest: "d1" };
    const pending = projectPendingSpendConfirm(sealed, resolvePricing);
    expect(pending?.gateId).toBe("gate-1");
  });

  it("门已经批过 / 计划已提交 / 已取消 → 不出卡（那已经不是「等你决定」了）", () => {
    const decided = run({
      gates: [{ gateId: "gate-1", scope: "budget_envelope", status: "approved", planHash: "d1", authorizationDigest: "d1", title: "", summary: "", jobIds: [], createdAt: NOW, expiresAt: NOW } as ProductionRun["gates"][number]],
    });
    decided.generationPlan = { ...decided.generationPlan!, state: "sealed", authorizationGateId: "gate-1", authorizationDigest: "d1" };
    expect(projectPendingSpendConfirm(decided, resolvePricing)).toBeUndefined();
    for (const state of ["submitted", "cancelled"] as const) {
      const other = run();
      other.generationPlan = { ...other.generationPlan!, state };
      expect(projectPendingSpendConfirm(other, resolvePricing)).toBeUndefined();
    }
  });

  it("外部 MCP 宿主发起的那笔不进面板：它的用户此刻没在看这块面板", () => {
    expect(projectPendingSpendConfirm(run({ origin: { host: "semantic-mcp" } }), resolvePricing)).toBeUndefined();
    expect(projectPendingSpendConfirm(run({ origin: { host: "codex" } }), resolvePricing)).toBeUndefined();
  });

  it("多镜只投影被勾选的那些，序号从 1 起（翻页器印的就是它）", () => {
    const multi = run();
    multi.generationPlan = {
      ...multi.generationPlan!,
      shots: [
        { shotId: "s1", candidate: candidate("c1", "priced"), nodeId: "node-1", updatedAt: NOW },
        { shotId: "s2", candidate: candidate("c2", "priced"), included: false, updatedAt: NOW },
        { shotId: "s3", candidate: candidate("c3", "unpriced"), nodeId: "node-3", updatedAt: NOW },
      ],
    };
    const pending = projectPendingSpendConfirm(multi, resolvePricing)!;
    expect(pending.shots.map((shot) => shot.shotId)).toEqual(["s1", "s3"]);
    expect(pending.shots.map((shot) => shot.index)).toEqual([1, 2]);
    expect(pending.unknownShotCount).toBe(1);
  });

  it("一个项目里多笔时按 updatedAt 排序（介入槽只显示第一张，其余算「还有 N 条」）", () => {
    const older = run({ runId: "op-old", updatedAt: "2026-09-10T00:00:00.000Z" });
    const newer = run({ runId: "op-new", updatedAt: "2026-09-12T00:00:00.000Z" });
    expect(listPendingSpendConfirms([newer, older], resolvePricing).map((row) => row.runId))
      .toEqual(["op-old", "op-new"]);
  });
});
