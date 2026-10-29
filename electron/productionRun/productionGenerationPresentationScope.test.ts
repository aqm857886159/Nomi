import { describe, expect, it } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { currentPresentation, normalizeLegacyPresentation } from "../shared/productionGenerationPresentation";
import { prepareProductionGenerationAuthorization } from "./prepareProductionGenerationAuthorization";
import { applyProductionCommand } from "./productionRunReducer";
import type { ProductionGenerationShot, ProductionRun } from "./productionRunTypes";

// reducer 这一层的范围（设计卡 docs/plan/2026-10-27-shot-scope-undecided.md ★9 A5 / A6 / A7 / A13）：
// 持久出价 `presentationScope` 与封印 `sealScopeOf` 只认一条规则——不点名 = 最近一张卡上还没定的；
// 没有出价 = 勾着、没送过、没去掉过的；一镜不剩就拒；多镜封印必须点名范围。

const NOW = "2026-10-27T00:00:00.000Z";
const LATER = "2026-10-27T01:00:00.000Z";

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "string" } },
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "fixture-provider",
    models: [{ modelId: "fixture-model", modes: ["text-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }],
  }],
}]);

function candidate(candidateId: string): PlanCandidate {
  return { candidateId, revision: 1, moduleId: "generation.single-shot", providerId: "fixture-provider", modelId: "fixture-model",
    mode: "text-to-image", prompt: candidateId, parameters: { aspectRatio: "16:9" }, references: [] };
}

function provider(): GenerationProvider {
  return { providerId: "fixture-provider", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    buildRequest: (input) => input, submit: async () => ({ providerTaskId: "unused" }) };
}

/** 三镜草稿：a、b 勾着，c 没勾（旧版本静默移出的那种，Q9：不自动复活）。没有出价记录。 */
function draftRun(extra: Partial<ProductionRun["generationPlan"] & object> = {}): ProductionRun {
  const shots: ProductionGenerationShot[] = [
    { shotId: "shot-a", candidate: candidate("cand-a"), included: true, nodeId: "node-a", updatedAt: NOW },
    { shotId: "shot-b", candidate: candidate("cand-b"), included: true, nodeId: "node-b", updatedAt: NOW },
    { shotId: "shot-c", candidate: candidate("cand-c"), included: false, nodeId: "node-c", updatedAt: NOW },
  ];
  return {
    schemaVersion: 1, runId: "op-scope", projectId: "project-1", revision: 5,
    status: "draft", stageId: "generate", playbook: { name: "generation.single-shot", version: "1.0.0" },
    origin: { host: "nomi" },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: 100, maxAttemptsPerJob: 2, minimizeUploads: true },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1, snapshotCursor: 5, stages: [], gates: [], jobs: [], artifacts: [],
    generationPlan: { operationId: "op-scope", state: "draft", candidate: shots[0].candidate, shots, updatedAt: NOW, ...extra },
    createdAt: NOW, updatedAt: NOW,
  };
}

function apply(run: ProductionRun, type: "generation.seal" | "generation.present", payload: Record<string, unknown>, at = NOW): ProductionRun {
  return applyProductionCommand(run, { commandId: `test-${run.revision}-${type}`, expectedRevision: run.revision, type, payload, issuedAt: at }, at).run;
}

/** 封这几镜的一份真载荷（和宿主 gate_request 同形：只编译 scope 里的镜，其余原样随行）。 */
function sealPayload(run: ProductionRun, scope: readonly string[]) {
  const plan = run.generationPlan!;
  const sealing = new Set(scope);
  const shots = plan.shots!.map((shot) => {
    if (!sealing.has(shot.shotId)) return shot;
    const contract = compileExecutionContract(shot.candidate, registry);
    return { ...shot, candidate: { ...shot.candidate, sealedContractHash: contract.contractHash }, contract };
  });
  const contract = compileExecutionContract(plan.candidate, registry);
  const authorization = prepareProductionGenerationAuthorization({
    run, lease: { projectId: run.projectId, immutableProjectUuid: "uuid", projectGeneration: 1, revocationEpoch: 0 }, projectRevision: 0,
    operation: { operationId: run.runId, projectId: run.projectId, candidate: plan.candidate, planVersion: run.planVersion },
    contract, multiShot: { shots, planHash: "plan-hash", scope: [...scope] }, providers: [provider()],
    resolveShotPrice: () => ({ known: true, amount: 1 }), now: NOW,
  });
  return { contract, shots, planHash: "plan-hash", scope: [...scope], authorization };
}

/** a、b 都封过、批过、跑完（外部宿主那一条路的第一批），没有出价记录。 */
function everyIncludedShotGenerated(): ProductionRun {
  const run = draftRun();
  const sealed = apply(run, "generation.seal", sealPayload(run, ["shot-a", "shot-b"]));
  return { ...sealed, budget: { ...sealed.budget, actual: 2, authorized: 2 },
    gates: sealed.gates.map((gate) => ({ ...gate, status: "approved" as const, decidedAt: NOW })),
    jobs: sealed.jobs.map((job) => ({ ...job, status: "ready" as const })),
    generationPlan: { ...sealed.generationPlan!, state: "submitted" as const } };
}

const card = (run: ProductionRun) => currentPresentation(run.generationPlan)?.shotIds;

describe("持久出价 presentationScope", () => {
  it("A6：从没出过价，不点名 → 勾着、没送过、没去掉过的全部（计划顺序）；没勾的 c 不复活", () => {
    expect(card(apply(draftRun(), "generation.present", {}))).toEqual(["shot-a", "shot-b"]);
  });

  it("A6：从没出过价、可摆的都送过了，不点名 → 拒绝（以前是「整份再来一轮」），账本不动；点名重试照常收下", () => {
    const run = everyIncludedShotGenerated();
    const before = JSON.stringify(run);
    expect(() => apply(run, "generation.present", {}, LATER)).toThrow(/waiting to be offered[\s\S]*call generate again with shotIds naming them/);
    expect(JSON.stringify(run)).toBe(before);
    expect(card(apply(run, "generation.present", { shotIds: ["shot-b"] }, LATER))).toEqual(["shot-b"]);
  });

  it("A7：旧 Run（没有出价记录、没有 cardHidden）读盘归一成开着的卡 → 不点名 = 勾着的那几镜", () => {
    const legacy = normalizeLegacyPresentation(draftRun());
    expect(card(legacy), "归一只在读盘那一处").toEqual(["shot-a", "shot-b"]);
    expect(card(apply(legacy, "generation.present", {}))).toEqual(["shot-a", "shot-b"]);
  });

  it("A7：旧 Run 带 cardHidden: true → 没有当前出价 → 勾着、没送过的", () => {
    const hidden = normalizeLegacyPresentation(draftRun({ cardHidden: true } as never));
    expect(currentPresentation(hidden.generationPlan)).toBeUndefined();
    expect(card(apply(hidden, "generation.present", {}))).toEqual(["shot-a", "shot-b"]);
  });

  it("A5：点名无效 → 模型可读的拒绝，账本一个字不动", () => {
    const run = draftRun();
    const before = JSON.stringify(run);
    expect(() => apply(run, "generation.present", { shotIds: ["shot-a", "shot-a"] })).toThrow(/names shot-a more than once/);
    expect(() => apply(run, "generation.present", { shotIds: ["foreign"] })).toThrow(/foreign is not one of the shots you can name here/);
    expect(() => apply(run, "generation.present", { shotIds: null })).toThrow(/shotIds must be a list of shot ids/);
    expect(JSON.stringify(run)).toBe(before);
  });

  it("有出价：卡上还没定的重试镜照样算还没定（不按「送过没有」再筛一遍）", () => {
    const run = everyIncludedShotGenerated();
    const retry = apply(run, "generation.present", { shotIds: ["shot-a"] }, LATER);
    const closed = { ...retry, generationPlan: { ...retry.generationPlan!, presentations: retry.generationPlan!.presentations!.map((presentation) => ({ ...presentation, closed: { at: LATER, by: "user_closed" as const } })) } };
    expect(card(apply(closed, "generation.present", {}, LATER))).toEqual(["shot-a"]);
  });
});

describe("reducer 封印 sealScopeOf（D4）", () => {
  it("A13：多镜封印不带 scope → 拒绝，结构上封不出「全部」", () => {
    const run = draftRun();
    const { scope: _scope, ...withoutScope } = sealPayload(run, ["shot-a", "shot-b"]);
    expect(() => apply(run, "generation.seal", withoutScope)).toThrow(/must name its shot scope/);
  });

  it("A13：带 scope 且都还能封 → 收下，只封这几镜", () => {
    const run = draftRun();
    const sealed = apply(run, "generation.seal", sealPayload(run, ["shot-b"]));
    expect(sealed.generationPlan!.shots!.filter((shot) => shot.contract).map((shot) => shot.shotId)).toEqual(["shot-b"]);
  });

  it("A13：scope 重复 → 拒绝（点名规则只留一份，不再静默去重）", () => {
    const run = draftRun();
    const payload = sealPayload(run, ["shot-b"]);
    expect(() => apply(run, "generation.seal", { ...payload, scope: ["shot-b", "shot-b"] })).toThrow(/names shot-b more than once/);
  });
});
