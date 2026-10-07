import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CatalogGenerationProviderError } from "../capabilityCore/apimartGenerationProvider";
import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { createProductionRunRepository } from "./productionRunRepository";
import { SubmissionReceiptUnknownError, SubmissionReconciliationRequiredError } from "./submissionOutbox";
import { jobMayHaveReachedProvider } from "../shared/productionShotJobs";

// 提交出口对「供应商当场明确拒绝」的回答（发动机收敛第一刀 F3，2026-10-05 用户拍板）：
// 收到了响应、4xx 或 2xx + 失败信封、没有任务号 → 确定没受理：job 落确定的 needs_attention（provider_rejected），
// 预留 provider-safe 释放、不挂 unsettled，记成「没花钱」，可以正常重来。5xx 照旧是「结果未知」、锁住。
// 动手前这里钉的是旧回答（一律 submission_unknown），拍板后按结论翻转。

const CAPS = { submitIdempotency: false, query: true, reconcile: false, cancel: false, materialize: true } as const;
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text"], outputKinds: ["image"], modes: ["text-to-image"],
  parameterSchema: {}, assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: "apimart", models: [{ modelId: "img", modes: ["text-to-image"], parameterSchema: {}, capabilities: CAPS }] }],
}]);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function answeringProvider(submits: string[], httpStatus: number): GenerationProvider {
  return {
    providerId: "apimart", capabilities: CAPS, buildRequest: (input) => input,
    submit: async (_request, key) => {
      submits.push(key);
      // 真实执行器收到响应之后抛的就是这个形状（providerAnswer 由它挂上）。
      throw new CatalogGenerationProviderError(`apimart create rejected the request: prompt violates content policy (HTTP ${httpStatus})`, {
        providerAnswer: { httpStatus, envelopeFailure: false, taskIdReturned: false },
      });
    },
  };
}

function setup(httpStatus: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-provider-rejection-"));
  roots.push(root);
  const now = () => "2026-10-05T00:00:00.000Z";
  const repository = createProductionRunRepository({ projectDirResolver: (id) => (id === "p" ? root : null), now });
  const cand: PlanCandidate = { candidateId: "c-1", revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "img", mode: "text-to-image", prompt: "a red cube", parameters: {}, references: [] };
  const contract = compileExecutionContract(cand, registry);
  const candidate = { ...cand, sealedContractHash: contract.contractHash };
  repository.createGenerationDraft({ operationId: "op-1", projectId: "p", origin: { host: "semantic-mcp" }, candidate, policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["apimart"], allowedModels: ["img"], maxSpend: null, maxAttemptsPerJob: 3 } });
  const submits: string[] = [];
  const provider = answeringProvider(submits, httpStatus);
  sealAndApproveProductionGeneration({ repository, projectId: "p", operationId: "op-1", immutableProjectUuid: "u", projectGeneration: 1, projectRevision: 0, candidate, contract, providers: [provider], resolveShotPrice: () => ({ known: true, amount: 2 }), now: now() });
  const submission = createProductionGenerationSubmission({
    repository, projectRoot: root, immutableProjectUuid: "u", projectGeneration: 1, intentMacKey: "k", provider, beforeDispatch: () => undefined, now,
  });
  return { repository, submission, submits };
}

describe("制作那台：供应商当场明确拒绝", () => {
  it("4xx：确定没受理——失败带原话、预留释放、记成没花钱，供应商只收到 1 次", async () => {
    const { repository, submission, submits } = setup(400);

    await expect(submission.start({ projectId: "p", operationId: "op-1" })).rejects.toBeInstanceOf(CatalogGenerationProviderError);

    const run = repository.read("p", "op-1")!;
    expect(run.jobs[0]).toMatchObject({ status: "needs_attention", errorCode: "provider_rejected", errorMessage: expect.stringContaining("content policy") });
    expect(jobMayHaveReachedProvider(run.jobs[0]!)).toBe(false);
    expect(run.budget).toMatchObject({ reserved: 0, unsettled: 0 });
    expect(submits).toHaveLength(1);
  });

  it("5xx：照旧是结果未知、这一镜再发被拦", async () => {
    const { repository, submission, submits } = setup(502);

    await expect(submission.start({ projectId: "p", operationId: "op-1" })).rejects.toBeInstanceOf(SubmissionReceiptUnknownError);
    expect(repository.read("p", "op-1")?.jobs[0]?.status).toBe("submission_unknown");

    await expect(submission.start({ projectId: "p", operationId: "op-1" })).rejects.toBeInstanceOf(SubmissionReconciliationRequiredError);
    expect(submits).toHaveLength(1);
  });
});
