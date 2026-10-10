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
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 2, minimizeUploads: true },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
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
    multiShot: { shots: sealed, scope: sealed.filter((shot) => shot.included !== false).map((shot) => shot.shotId), planHash: "plan-hash-r" },
    run: draft,
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
    expect(plan.costCertainty).toBeUndefined();
    // 那一份授权住在它自己那道门上：门被撤回（下面那条），计划上本来就不挂授权。
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

  it("批过的镜（在生成 / 生成过）不能改：那时钱已经花出去了", () => {
    const run = sealedRun();
    const decided: ProductionRun = {
      ...run,
      gates: run.gates.map((gate) => ({ ...gate, status: "approved" as const })),
    };
    expect(() => applyProductionCommand(decided, {
      commandId: "revise-decided", expectedRevision: decided.revision, type: "generation.revise",
      payload: { shotId: "shot-a", patch: { prompt: "改不动了" } }, issuedAt: NOW,
    }, NOW)).toThrow(/already generating or generated/);
  });

  it("那道门被拒了：这一镜没生成，卡上照样能改（先解封那份没被批准的合同，再改）", () => {
    const run = sealedRun();
    const rejected: ProductionRun = { ...run, gates: run.gates.map((gate) => ({ ...gate, status: "rejected" as const })) };
    const revised = applyProductionCommand(rejected, {
      commandId: "revise-rejected", expectedRevision: rejected.revision, type: "generation.revise",
      payload: { shotId: "shot-a", patch: { prompt: "换个机位重来" } }, issuedAt: NOW,
    }, NOW).run;
    const shot = revised.generationPlan!.shots!.find((entry) => entry.shotId === "shot-a")!;
    expect(shot.candidate.prompt).toBe("换个机位重来");
    expect(shot.contract).toBeUndefined();
    expect(shot.candidate.sealedContractHash).toBeUndefined();
  });

  it("已经在跑的计划（逐镜）：批过的那一镜不能改，卡上还没决定的那一镜能改；多镜计划必须点名改哪一镜", () => {
    const a = candidate("cand-a", "shot a");
    const b = candidate("cand-b", "shot b");
    const run = draftRun([{ shotId: "shot-a", candidate: a, updatedAt: NOW }, { shotId: "shot-b", candidate: b, updatedAt: NOW }], a);
    const live: ProductionRun = {
      ...run,
      gates: [{ gateId: "gate-a", scope: "budget_envelope", status: "approved", planHash: "d-a", authorizationDigest: "d-a",
        authorizationEnvelope: { gateId: "gate-a", jobs: [{ shotId: "shot-a" }] } as never, title: "", summary: "", jobIds: [], createdAt: NOW, expiresAt: NOW }],
      generationPlan: { ...run.generationPlan!, state: "submitted" },
    };
    const revise = (payload: Record<string, unknown>) => applyProductionCommand(live, {
      commandId: `revise-${JSON.stringify(payload).length}`, expectedRevision: 5, type: "generation.revise", payload, issuedAt: NOW,
    }, NOW);
    expect(() => revise({ shotId: "shot-a", patch: { prompt: "晚了" } })).toThrow(/already generating or generated/);
    expect(() => revise({ patch: { prompt: "改哪一镜？" } })).toThrow(/must name its shot/);
    const revised = revise({ shotId: "shot-b", patch: { prompt: "还来得及" } }).run;
    expect(revised.generationPlan!.shots!.find((shot) => shot.shotId === "shot-b")!.candidate.prompt).toBe("还来得及");
    expect(revised.generationPlan!.state).toBe("submitted");
  });
});

/**
 * #748 已知缺口的正面：**卡上换模型不该被那道防 agent 的白名单挡下。**
 *
 * Run 的 policy 是建草稿那一刻从候选身份冻下来的，冻它是为了「后面再来的命令不能偷偷换掉
 * host/provider/model」。那道闸防的是 agent——agent 改候选走 `generation.patch`。
 * 而 `generation.revise` 只有一个入口：付费卡上真人按的那一下。用防 agent 的闸拦真人自己
 * 的选择，用户看到的是「模型未加入白名单」，而他做的只是换了个模型。
 *
 * 放行的边界是**同一个任务类别**（`candidate.mode`）：卡上那个下拉本来就只列同类别的模型，
 * 跨类别换掉的是整个花钱量级，不叫「改一下」——所以类别一变就 fail-closed。
 */
describe("generation.revise · 卡上换模型与 Run 白名单（#748）", () => {
  const FROZEN = {
    trustedHosts: ["nomi"],
    allowedProviders: ["fixture-provider"], allowedModels: ["fixture-model"],
    maxSpend: null, maxAttemptsPerJob: 2, minimizeUploads: true,
  };
  /** 建草稿那一刻的样子：白名单只认当时那一个供应商 + 那一个模型。 */
  function frozenDraft(): ProductionRun {
    const a = candidate("cand-a", "shot a");
    return { ...draftRun([{ shotId: "shot-a", candidate: a, updatedAt: NOW }], a), policy: { ...FROZEN } };
  }
  const revise = (run: ProductionRun, patch: Record<string, unknown>) => applyProductionCommand(run, {
    commandId: "revise-model", expectedRevision: run.revision, type: "generation.revise",
    payload: { shotId: "shot-a", patch }, issuedAt: NOW,
  }, NOW).run;

  it("换成同类别的另一个模型 → 白名单当场认它（否则确认时一句「模型未加入白名单」）", () => {
    const next = revise(frozenDraft(), { modelId: "fixture-model-pro" });
    expect(next.policy.allowedModels).toEqual(["fixture-model", "fixture-model-pro"]);
    expect(next.generationPlan!.shots![0].candidate.modelId).toBe("fixture-model-pro");
    // 旧的没被顶掉：用户还能在卡上换回去。
    expect(next.policy.allowedModels).toContain("fixture-model");
  });

  it("换供应商同样认（卡上的模型 chip 带着它自己那家）", () => {
    const next = revise(frozenDraft(), { providerId: "other-relay", modelId: "fixture-model" });
    expect(next.policy.allowedProviders).toEqual(["fixture-provider", "other-relay"]);
  });

  it("已封印 + 门在等时换模型：撤门回 draft 的同时也把新模型认了", () => {
    const sealed: ProductionRun = { ...sealedRun(), policy: { ...FROZEN } };
    const next = revise(sealed, { modelId: "fixture-model-pro" });
    expect(next.policy.allowedModels).toContain("fixture-model-pro");
    // 放行的只是判据里的身份，不是那笔钱：旧授权照撤，仍要重新出卡、重新由真人按一次。
    expect(next.generationPlan!.state).toBe("draft");
    expect(next.gates.every((gate) => gate.status !== "waiting")).toBe(true);
    expect(next.policy.maxSpend).toBe(FROZEN.maxSpend);
  });

  it("跨任务类别（图 → 视频）不放行：那换掉的是整个花钱量级，白名单照旧挡下", () => {
    const next = revise(frozenDraft(), { modelId: "video-model", mode: "image-to-video" });
    expect(next.policy.allowedModels).toEqual(["fixture-model"]);
    expect(next.policy.allowedProviders).toEqual(["fixture-provider"]);
  });

  it("只改参数、没换身份 → 白名单一个字不动", () => {
    const before = frozenDraft();
    const next = revise(before, { parameters: { aspectRatio: "1:1" } });
    expect(next.policy).toEqual(before.policy);
  });

  it("agent 的 generation.patch 换模型**不**放行——那道防 agent 的闸还在原处", () => {
    const run = frozenDraft();
    const next = applyProductionCommand(run, {
      commandId: "patch-model", expectedRevision: run.revision, type: "generation.patch",
      payload: { shotId: "shot-a", patch: { modelId: "fixture-model-pro" } }, issuedAt: NOW,
    }, NOW).run;
    expect(next.generationPlan!.shots![0].candidate.modelId).toBe("fixture-model-pro");
    expect(next.policy.allowedModels).toEqual(["fixture-model"]);
  });
});


describe("generation.present · 同一方案的新付费范围", () => {
  function present(run: ProductionRun, shotIds: string[]) {
    return applyProductionCommand(run, { commandId: "present-next", expectedRevision: run.revision,
      type: "generation.present", payload: { shotIds }, issuedAt: NOW }, NOW).run;
  }

  it("S04: re-presenting one shot of a waiting sealed card revokes its old authority; the other shot stays in the draft (no silent drop)", () => {
    const run = sealedRun();
    const next = present(run, ["shot-b"]);
    expect(next.generationPlan?.state).toBe("draft");
    // 付费卡逐镜：不再靠「把别的镜取消勾选」来缩范围——这一次出价只摆 shot-b，shot-a 仍在草稿里（下一次出价还能问它）。
    expect(next.generationPlan?.presentations?.at(-1)?.shotIds).toEqual(["shot-b"]);
    expect(next.generationPlan?.shots?.map((shot) => [shot.shotId, shot.included !== false])).toEqual([["shot-a", true], ["shot-b", true]]);
    expect(next.gates[0].status).toBe("revoked");
    expect(next.jobs).toEqual([]);
    expect(next.generationPlan?.shots?.every((shot) => !shot.contract && !shot.approvedReceiptId)).toBe(true);
  });

  it("S06: completed batch leaves the same creative identities available for the next batch", () => {
    const run = sealedRun();
    const completed: ProductionRun = { ...run, status: "completed",
      generationPlan: { ...run.generationPlan!, state: "submitted" },
      gates: run.gates.map((gate) => ({ ...gate, status: "approved" })),
      jobs: run.jobs.map((job) => ({ ...job, status: "ready" })) };
    const next = present(completed, ["shot-b"]);
    expect(next.runId).toBe(completed.runId);
    expect(next.jobs).toEqual(completed.jobs);
    expect(next.gates).toEqual(completed.gates);
    expect(next.generationPlan?.shots?.map((shot) => shot.shotId)).toEqual(["shot-a", "shot-b"]);
    expect(next.generationPlan?.state).toBe("draft");
    expect(next.planVersion).toBe(completed.planVersion + 1);
    // 上一批的批准住在它自己那道门上（原样留着），计划上没有一份「当前批准」可以沿用到下一批。
    expect(next.generationPlan).not.toHaveProperty("approvedReceiptId");
  });

  it("S07: unknown previous submission cannot be reset by presenting another batch", () => {
    const run = sealedRun();
    // 结果未知的那一笔已经批过（提交过的 job 一定有一份批过的授权盖着）。
    const uncertain: ProductionRun = { ...run,
      gates: run.gates.map((gate) => ({ ...gate, status: "approved" as const })),
      generationPlan: { ...run.generationPlan!, state: "submitted" },
      jobs: run.jobs.map((job) => ({ ...job, status: "submission_unknown" })) };
    expect(() => present(uncertain, ["shot-b"])).toThrow(/reconcil|unsettled|in.flight/i);
  });
});
