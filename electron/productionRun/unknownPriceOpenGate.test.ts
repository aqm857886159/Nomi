// 未知价开闸（2026-09-21 用户拍板：「我们现在都没有建立价格的标尺，不能因此不让用户处理问题」）。
//
// 这一组守两件**同时**成立的事——缺任何一件这次改动就白做了：
//   ① 价格未知**不挡住生成**：首波 / 重拍，一条都不许因为没价格被拒（续批那条路 2026-10-01 随 Run 级预算停一起删了）；
//   ② 价格未知**绝不被当成 0 元**：信封、账本、收据上它都有自己的位置（`price.maximum: null`
//      与 `budget.unknownJobCount`），而已知价那条硬上限一个字没松。
//
// 规格正本：docs/plan/2026-09-21-unknown-price-open-gate.md
// 根因合同：docs/fixes/2026-09-21-unknown-price-blocks-generation.root-cause.json
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { ProjectLeaseV2 } from "../capabilityCore/projectLease";
import {
  prepareProductionGenerationAuthorization,
  prepareProductionGenerationReauthorization,
} from "./prepareProductionGenerationAuthorization";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { createProductionRunRepository } from "./productionRunRepository";
import { readTrustGrantBinding } from "./productionRunTrustGrant";
import type { ShotPrice } from "./shotPricing";
import { landedAdmission } from "./landFirstTestUtils";

const NOW = "2026-09-21T00:00:00.000Z";
const LATER = "2026-09-21T00:01:00.000Z";
const roots: string[] = [];

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "string" } },
  assetInputSchema: {},
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

const lease = {
  projectId: "project-1",
  immutableProjectUuid: "project-uuid-1",
  projectGeneration: 1,
  revocationEpoch: 0,
} as ProjectLeaseV2;

function candidate(id = "candidate-1"): PlanCandidate {
  return {
    candidateId: id,
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "fixture-provider",
    modelId: "fixture-model",
    mode: "text-to-image",
    prompt: `a paper boat ${id}`,
    parameters: { aspectRatio: "16:9" },
    references: [],
  };
}

function setup(options: Readonly<{ maxSpend?: number | null; shotIds?: readonly string[] }> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-unknown-price-gate-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => (projectId === "project-1" ? root : null),
    now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const submit = vi.fn(async () => ({ providerTaskId: `provider-task-${submit.mock.calls.length}` }));
  const provider: GenerationProvider = {
    providerId: "fixture-provider",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    buildRequest: (request) => ({ model: request.modelId, prompt: request.prompt, parameters: request.parameters }),
    submit,
  };
  const top = candidate();
  const shots = (options.shotIds ?? []).map((shotId) => ({
    shotId,
    candidate: candidate(shotId),
    contract: compileExecutionContract(candidate(shotId), registry),
  }));
  repository.createGenerationDraft({
    operationId: "op-1",
    projectId: "project-1",
    origin: { host: "semantic-mcp" },
    candidate: top,
    ...(shots.length ? { shots: shots.map(({ shotId, candidate: shotCandidate }) => ({ shotId, candidate: shotCandidate })) } : {}),
    policy: {
      trustedHosts: ["semantic-mcp"],
      allowedProviders: ["fixture-provider"],
      allowedModels: ["fixture-model"],
      maxSpend: options.maxSpend ?? null,
      maxAttemptsPerJob: 2,
    },
  });
  const submission = createProductionGenerationSubmission({
    repository,
    beforeDispatch: () => undefined,
    projectRoot: root,
    immutableProjectUuid: lease.immutableProjectUuid,
    projectGeneration: lease.projectGeneration,
    intentMacKey: "test-intent-key",
    providers: [provider],
    now: () => NOW,
  });
  return { root, repository, provider, submit, submission, top, shots, contract: compileExecutionContract(top, registry) };
}

/** 为首波封一份授权（不落进 Run）。 */
function prepareFirstWave(base: ReturnType<typeof setup>, resolveShotPrice: (shotId: string) => ShotPrice) {
  const { repository, provider, top, shots, contract } = base;
  const multiShot = shots.length
    ? {
        shots: shots.map((entry) => ({
          shotId: entry.shotId,
          // 封印要求逐镜候选带上它自己那份合同的 hash（`productionGenerationSeal` 的同一性判据）。
          candidate: { ...entry.candidate, sealedContractHash: entry.contract.contractHash },
          contract: entry.contract,
          included: true,
        })),
        // 这一次封印盖的镜：首波就是整批（逐镜点击时只有点到的那几镜）。
        scope: shots.map((entry) => entry.shotId),
        planHash: "plan-hash-1",
      }
    : undefined;
  const authorization = prepareProductionGenerationAuthorization({
    lease,
    projectRevision: 12,
    operation: { operationId: "op-1", projectId: "project-1", candidate: top, planVersion: 1 },
    contract,
    ...(multiShot ? { multiShot: multiShot as never } : {}),
    run: repository.read("project-1", "op-1")!,
    providers: [provider],
    resolveShotPrice: (shotContract) => resolveShotPrice(shotContract.candidateId),
    now: NOW,
  });
  return { authorization, multiShot };
}

/** 封印首波并让门通过，返回封印后的 Run。 */
function sealAndApprove(base: ReturnType<typeof setup>, resolveShotPrice: (shotId: string) => ShotPrice) {
  const { repository, contract } = base;
  const { authorization, multiShot } = prepareFirstWave(base, resolveShotPrice);
  const sealed = repository.execute("project-1", "op-1", {
    commandId: "seal",
    expectedRevision: 0,
    type: "generation.seal",
    payload: { contract, authorization, ...(multiShot ? { shots: multiShot.shots, planHash: multiShot.planHash } : {}) },
    issuedAt: NOW,
  }).run;
  const run = repository.execute("project-1", "op-1", {
    commandId: "decide",
    expectedRevision: sealed.revision,
    type: "gate.decide",
    payload: {
      gateId: authorization.envelope.gateId,
      status: "approved",
      receiptId: "receipt-1",
      authorizationDigest: authorization.authorizationDigest,
    },
    issuedAt: NOW,
  }).run;
  return { authorization, run };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("未知价：每一条路径都能生成，而且没有一处把它写成 0", () => {
  it("首波：算不出价的单镜照样封印、开门、真提交，账本记的是「未知」不是「0 元」", async () => {
    const base = setup();
    const { authorization } = sealAndApprove(base, () => ({ known: false }));
    // 信封上那个格子：金额位是 null（不是 0），未知走自己那根轴。
    expect(authorization.envelope.jobs[0].price.maximum).toBeNull();
    expect(authorization.envelope.budget).toMatchObject({ maximum: 0, unknownJobCount: 1 });

    await base.submission.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(base.repository, "project-1", "op-1") });
    expect(base.submit).toHaveBeenCalledTimes(1);

    const run = base.repository.read("project-1", "op-1")!;
    expect(run.budget.reserved).toBe(0);
    expect(run.budget.unknownInFlight).toBe(1);
    const reserve = base.repository.readBudgetLedger("project-1", "op-1").entries.find((entry) => entry.kind === "reserve");
    expect(reserve).toMatchObject({ kind: "reserve", amount: null });
  });

  it("重拍：算不出价的那一镜重拍不再被拒，新信封仍如实标未知", async () => {
    const base = setup();
    sealAndApprove(base, () => ({ known: false }));
    await base.submission.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(base.repository, "project-1", "op-1") });
    let run = base.repository.read("project-1", "op-1")!;
    run = base.repository.execute("project-1", "op-1", {
      commandId: "first-ready",
      expectedRevision: run.revision,
      type: "job.status",
      payload: { jobId: run.jobs[0].jobId, status: "ready" },
      issuedAt: NOW,
    }).run;

    const reauthorization = prepareProductionGenerationReauthorization({
      lease,
      projectRevision: 12,
      run,
      providers: [base.provider],
      resolveShotPrice: () => ({ known: false }),
      now: LATER,
    });
    expect(reauthorization.envelope.jobs[0].price.maximum).toBeNull();
    expect(reauthorization.envelope.budget).toMatchObject({ maximum: 0, unknownJobCount: 1 });
    // 重拍真的进得了 Run（从前这里抛 generation_pricing_unknown，用户点了「重拍这一镜」什么都不会发生）。
    run = base.repository.execute("project-1", "op-1", {
      commandId: "rework",
      expectedRevision: run.revision,
      type: "generation.reauthorize",
      payload: { authorization: reauthorization },
      issuedAt: LATER,
    }).run;
    expect(run.jobs.find((job) => job.attempt === 2)).toMatchObject({ status: "authorization_required" });
  });

  it("混合批次：未知的不占额度也不被算进去；已知的超了 Run 的硬上限就整份拒，不批一半", () => {
    const base = setup({ maxSpend: 10, shotIds: ["shot-a", "shot-b", "shot-c"] });
    // shot-a 已知 6、shot-b 未知、shot-c 已知 6 → 已知合计 12 > 10。
    const price = (shotId: string): ShotPrice => (shotId === "shot-b" ? { known: false } : { known: true, amount: 6 });
    const { authorization } = prepareFirstWave(base, price);
    // 已知之和 12 没有因为「多了一镜未知」被悄悄抬高或压低——未知不参与任何金额运算；它仍然在 job 表里（它能跑）。
    expect(authorization.envelope.budget).toMatchObject({ maximum: 12, ledgerCeiling: 12, unknownJobCount: 1 });
    expect(authorization.envelope.jobs.map((job) => job.price.maximum)).toEqual([6, null, 6]);
    // 盖不住就整份拒（2026-10-01 以前是只批得起的那 10、派到第三镜时停批再续——那条路随 Run 级预算停一起删了）。
    expect(() => sealAndApprove(base, price)).toThrow(/hard spend ceiling/);
  });

  it("信任降档仍然对未知 fail-closed：「以后 ¥X 内不再问」给不出 X 就不许问", () => {
    const base = setup();
    sealAndApprove(base, () => ({ known: false }));
    const run = base.repository.read("project-1", "op-1")!;
    expect(() => readTrustGrantBinding(run)).toThrow(/no known price/);
  });
});
