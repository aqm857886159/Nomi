import { describe, expect, it } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { prepareProductionGenerationAuthorization } from "./prepareProductionGenerationAuthorization";
import { applyProductionCommand } from "./productionRunReducer";
import type { ProductionGenerationShot, ProductionRun } from "./productionRunTypes";

// `generation.revise` = 「用户在付费确认卡上改了参数」。
//
// 守的是一条不变量：**收据 = 实际执行**。改了供应商真正会收到的那份载荷，就不许沿用旧授权——
// 否则面板收据上写的和真正跑的会分叉，而用户是照着收据点的头。所以它必须逐字做到
// `trial_narrow` 那五件事：门在等 → 没有 job 越线 → 撤门 → 丢旧 digest 的 job → 清封印回 draft。

const NOW = "2026-09-11T00:00:00.000Z";

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
    models: [{
      modelId: "fixture-model",
      modes: ["text-to-image"],
      parameterSchema: {},
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    }],
  }],
}]);

function candidate(candidateId: string, prompt: string): PlanCandidate {
  return {
    candidateId,
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "fixture-provider",
    modelId: "fixture-model",
    mode: "text-to-image",
    prompt,
    parameters: { aspectRatio: "16:9" },
    references: [],
  };
}

function provider(): GenerationProvider {
  return {
    providerId: "fixture-provider",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    buildRequest: (input) => input,
    submit: async () => ({ providerTaskId: "unused" }),
  };
}

function draftRun(shots: ProductionGenerationShot[], top: PlanCandidate): ProductionRun {
  return {
    schemaVersion: 1, runId: "op-r", projectId: "project-1", revision: 5,
    status: "draft", stageId: "generate", playbook: { name: "generation.single-shot", version: "1.0.0" },
    origin: { host: "nomi" },
    policy: { mode: "balanced", trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 2, minimizeUploads: true },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1, snapshotCursor: 5, stages: [], gates: [], jobs: [], artifacts: [],
    generationPlan: { operationId: "op-r", state: "draft", candidate: top, shots, updatedAt: NOW },
    createdAt: NOW, updatedAt: NOW,
  };
}

/** 一份「已封印 + 付费门在等」的两镜计划——付费卡出现的那一刻，Run 就长这样。 */
function sealedRun(): ProductionRun {
  const a = candidate("cand-a", "shot a");
  const b = candidate("cand-b", "shot b");
  const contractA = compileExecutionContract(a, registry);
  const contractB = compileExecutionContract(b, registry);
  const sealed: ProductionGenerationShot[] = [
    { shotId: "shot-a", candidate: { ...a, sealedContractHash: contractA.contractHash }, contract: contractA, updatedAt: NOW },
    { shotId: "shot-b", candidate: { ...b, sealedContractHash: contractB.contractHash }, contract: contractB, updatedAt: NOW },
  ];
  const draft = draftRun([
    { shotId: "shot-a", candidate: a, updatedAt: NOW },
    { shotId: "shot-b", candidate: b, updatedAt: NOW },
  ], a);
  const authorization = prepareProductionGenerationAuthorization({
    lease: { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 },
    projectRevision: 0,
    operation: { operationId: "op-r", projectId: "project-1", candidate: a, planVersion: 1 },
    contract: contractA,
    multiShot: { shots: sealed, planHash: "plan-hash-r" },
    providers: [provider()],
    resolveShotPrice: () => ({ known: true, amount: 0.3 }),
    now: NOW,
  });
  return applyProductionCommand(draft, {
    commandId: "seal-op-r", expectedRevision: 5, type: "generation.seal",
    payload: { contract: contractA, shots: sealed, planHash: "plan-hash-r", authorization }, issuedAt: NOW,
  }, NOW).run;
}

describe("generation.revise · 卡上改参数", () => {
  it("已封印 + 门在等：撤门、丢 job、清封印回 draft，并把改动落到那一镜", () => {
    const run = sealedRun();
    expect(run.generationPlan?.state).toBe("sealed");
    expect(run.jobs.length).toBeGreaterThan(0);
    const before = run.generationPlan!.shots!.find((shot) => shot.shotId === "shot-b")!.candidate.revision;

    const effect = applyProductionCommand(run, {
      commandId: "revise-1", expectedRevision: run.revision, type: "generation.revise",
      payload: { shotId: "shot-b", patch: { parameters: { aspectRatio: "9:16" } } }, issuedAt: NOW,
    }, NOW);

    const plan = effect.run.generationPlan!;
    expect(plan.state).toBe("draft");
    // 封印/授权字段整组清零——重新计价、重新封印、重新出卡才能拿到新的 digest。
    expect(plan.contract).toBeUndefined();
    expect(plan.planHash).toBeUndefined();
    expect(plan.authorizationDigest).toBeUndefined();
    expect(plan.authorizationEnvelope).toBeUndefined();
    expect(plan.authorizationGateId).toBeUndefined();
    expect(plan.costCertainty).toBeUndefined();
    expect(effect.run.gates).toEqual([expect.objectContaining({ status: "revoked" })]);
    expect(effect.run.jobs).toEqual([]);
    expect(effect.run.planVersion).toBe(2);
    // 改动真的落到了那一镜，而且 revision 前进（幂等键与「意图变了没有」都靠它）。
    const revised = plan.shots!.find((shot) => shot.shotId === "shot-b")!;
    expect(revised.candidate.parameters).toEqual({ aspectRatio: "9:16" });
    expect(revised.candidate.revision).toBe(before + 1);
    expect(revised.candidate.sealedContractHash).toBeUndefined();
    // 没被改的那一镜同样退回未封印——整份合同作废，不留半张。
    expect(plan.shots!.find((shot) => shot.shotId === "shot-a")!.contract).toBeUndefined();
  });

  it("范围切换：把一镜取消勾选（「逐镜」那一档的落点）", () => {
    const effect = applyProductionCommand(sealedRun(), {
      commandId: "revise-scope", expectedRevision: 5, type: "generation.revise",
      payload: { shotId: "shot-b", patch: {}, included: false }, issuedAt: NOW,
    }, NOW);
    const plan = effect.run.generationPlan!;
    expect(plan.shots!.find((shot) => shot.shotId === "shot-b")!.included).toBe(false);
    expect(plan.shots!.find((shot) => shot.shotId === "shot-a")!.included).not.toBe(false);
  });

  it("还是草稿时直接改：不撤门（没有门可撤）、planVersion 不动", () => {
    const a = candidate("cand-a", "shot a");
    const run = draftRun([{ shotId: "shot-a", candidate: a, updatedAt: NOW }], a);
    const effect = applyProductionCommand(run, {
      commandId: "revise-draft", expectedRevision: 5, type: "generation.revise",
      payload: { shotId: "shot-a", patch: { prompt: "六棱柱" } }, issuedAt: NOW,
    }, NOW);
    expect(effect.run.planVersion).toBe(1);
    expect(effect.run.gates).toEqual([]);
    expect(effect.run.generationPlan!.shots![0].candidate.prompt).toBe("六棱柱");
  });

  it("授权已经开始执行 → 拒绝：那时改载荷会让收据和实际执行分叉", () => {
    const run = sealedRun();
    const started: ProductionRun = {
      ...run,
      jobs: run.jobs.map((job) => ({ ...job, status: "authorized" as const })),
    };
    expect(() => applyProductionCommand(started, {
      commandId: "revise-late", expectedRevision: started.revision, type: "generation.revise",
      payload: { shotId: "shot-a", patch: { prompt: "太晚了" } }, issuedAt: NOW,
    }, NOW)).toThrow(/begun execution/);
  });

  it("门已经被决定（批了/拒了）→ 拒绝", () => {
    const run = sealedRun();
    const decided: ProductionRun = {
      ...run,
      gates: run.gates.map((gate) => ({ ...gate, status: "approved" as const })),
    };
    expect(() => applyProductionCommand(decided, {
      commandId: "revise-decided", expectedRevision: decided.revision, type: "generation.revise",
      payload: { shotId: "shot-a", patch: { prompt: "改不动了" } }, issuedAt: NOW,
    }, NOW)).toThrow(/before the spend gate is decided/);
  });

  it("已提交的计划不可改：那时钱已经花出去了", () => {
    const a = candidate("cand-a", "shot a");
    const run = draftRun([{ shotId: "shot-a", candidate: a, updatedAt: NOW }], a);
    const submitted: ProductionRun = {
      ...run,
      generationPlan: { ...run.generationPlan!, state: "submitted" },
    };
    expect(() => applyProductionCommand(submitted, {
      commandId: "revise-submitted", expectedRevision: 5, type: "generation.revise",
      payload: { patch: { prompt: "晚了" } }, issuedAt: NOW,
    }, NOW)).toThrow(/submitted or cancelled/);
  });
});
