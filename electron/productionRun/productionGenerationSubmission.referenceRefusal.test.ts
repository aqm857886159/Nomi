import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { ProjectLeaseV2 } from "../capabilityCore/projectLease";
import { decideGenerationFailure } from "../shared/generationFailure";
import { encodeStructuredErrorMessage, VendorRequestError } from "../vendor/vendorHttp";
import { landedAdmission } from "./landFirstTestUtils";
import { prepareProductionGenerationAuthorization } from "./prepareProductionGenerationAuthorization";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { createProductionRunRepository } from "./productionRunRepository";

// 两台生成引擎都保留本次供应商拒绝的原因，提交次数由账本决定。
const NOW = "2026-11-01T00:00:00.000Z";
const REPORTED = "An input media URL could not be fetched (403/404/410).";
const roots: string[] = [];
const lease = { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 } as ProjectLeaseV2;

beforeEach(() => {
  const settings = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-reference-refusal-settings-"));
  roots.push(settings);
  vi.stubEnv("NOMI_SETTINGS_DIR", settings);
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

type Engine = { name: string; providerId: string; connection: string; rejection: (text: string) => Error; failedRaw: (text: string) => unknown };

/** 画布那台：runTask 直接抛 VendorRequestError；任务结果是 TaskResult，失败原话在 `.error`。 */
const canvasEngine: Engine = {
  name: "画布引擎",
  providerId: "canvas:relay-a",
  connection: "relay-a",
  rejection: (text) => new VendorRequestError(`Provider request failed (HTTP 400) at relay-a POST https://relay.example.com/v1/videos: ${text}`, {
    vendorKey: "relay-a", method: "POST", url: "https://relay.example.com/v1/videos", httpStatus: 400, upstreamMsg: text, category: "input", retryable: false,
  }, { httpStatus: 400, envelopeFailure: false, taskIdReturned: false }),
  failedRaw: (text) => ({ id: "task-1", kind: "text_to_video", status: "failed", assets: [], error: text }),
};

/** 做片目录引擎：包了一层 CatalogGenerationProviderError，真正的上游原话与码在 cause（VendorRequestError）上；任务结果是供应商报文。 */
const catalogEngine: Engine = {
  name: "做片引擎",
  providerId: "relay-b",
  connection: "relay-b",
  rejection: (text) => {
    const inner = new VendorRequestError(`Provider request failed (HTTP 422) at relay-b POST https://relay.example.com/v1/videos: ${text}`, {
      vendorKey: "relay-b", method: "POST", url: "https://relay.example.com/v1/videos", httpStatus: 422, upstreamMsg: text, category: "input", retryable: false,
    }, { httpStatus: 422, envelopeFailure: false, taskIdReturned: false });
    return Object.assign(new Error(`relay-b submission failed: ${inner.message}`, { cause: inner }), { providerAnswer: inner.providerAnswer });
  },
  failedRaw: (text) => ({ data: { status: "failed", error: { message: text } } }),
};

function harness(engine: Engine) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-reference-refusal-"));
  roots.push(root);
  const registry = createModuleRegistry([{
    moduleId: "generation.single-shot", version: "1.0.0", inputKinds: ["text"], outputKinds: ["video"], modes: ["text-to-video"], parameterSchema: {}, assetInputSchema: {},
    providers: [{ providerId: engine.providerId, models: [{ modelId: "m", modes: ["text-to-video"], parameterSchema: {}, capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false } }] }],
  }]);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => projectId === "project-1" ? root : null, now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const candidate: PlanCandidate = { candidateId: "c-1", revision: 1, moduleId: "generation.single-shot", providerId: engine.providerId, modelId: "m", mode: "text-to-video", prompt: "a boat", parameters: {}, references: [] };
  const contract = compileExecutionContract(candidate, registry);
  const submit = vi.fn<(request: unknown) => Promise<{ providerTaskId: string }>>(async () => ({ providerTaskId: "provider-task-1" }));
  const query = vi.fn<() => Promise<{ status: string; raw: unknown }>>(async () => ({ status: "failed", raw: {} }));
  const provider: GenerationProvider = {
    providerId: engine.providerId,
    capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
    buildRequest: (request) => ({ model: request.modelId, prompt: request.prompt }),
    submit,
    query,
  };
  repository.createGenerationDraft({
    operationId: "op-1", projectId: "project-1", origin: { host: "semantic-mcp" }, candidate,
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: [engine.providerId], allowedModels: ["m"], maxSpend: 100, maxAttemptsPerJob: 2 },
  });
  const authorization = prepareProductionGenerationAuthorization({
    lease, projectRevision: 1, operation: { operationId: "op-1", projectId: "project-1", candidate, planVersion: 1 }, contract,
    run: repository.read("project-1", "op-1")!, providers: [provider], resolveShotPrice: () => ({ known: true, amount: 3 }), now: NOW,
  });
  const sealed = repository.execute("project-1", "op-1", { commandId: "seal", expectedRevision: 0, type: "generation.seal", payload: { contract, authorization }, issuedAt: NOW }).run;
  repository.execute("project-1", "op-1", {
    commandId: "approve", expectedRevision: sealed.revision, type: "gate.decide",
    payload: { gateId: authorization.envelope.gateId, status: "approved", receiptId: "receipt-1", authorizationDigest: authorization.authorizationDigest }, issuedAt: NOW,
  });
  const submission = createProductionGenerationSubmission({
    repository, beforeDispatch: () => undefined, projectRoot: root, immutableProjectUuid: lease.immutableProjectUuid,
    projectGeneration: lease.projectGeneration, intentMacKey: "test-intent-key", providers: [provider], now: () => NOW,
  });
  const start = async () => submission.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(repository, "project-1", "op-1") });
  return { repository, submission, submit, query, start };
}

describe.each([canvasEngine, catalogEngine])("$name", (engine) => {
  it("提交被拒（4xx）：POST 仍只有 1 次，没有自动重发", async () => {
    const h = harness(engine);
    h.submit.mockRejectedValue(engine.rejection(REPORTED));
    await expect(h.start()).rejects.toThrow(/could not be fetched/);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it("提交被拒但不是这一类（余额不足）：保留本次失败", async () => {
    const h = harness(engine);
    h.submit.mockRejectedValue(engine.rejection("The account has run out of credit for this request"));
    await expect(h.start()).rejects.toThrow();
  });

  it("任务失败（轮询）：errorMessage 换成上游原话，errorCode 不变", async () => {
    const h = harness(engine);
    await h.start();
    h.query.mockResolvedValue({ status: "failed", raw: engine.failedRaw(REPORTED) });
    const result = await h.submission.poll({ projectId: "project-1", operationId: "op-1" });
    expect(result.nextAction).toBe("attention");
    const job = h.repository.read("project-1", "op-1")!.jobs[0];
    expect(job.errorCode).toBe("provider_task_failed");
    expect(job.errorMessage).toBe(REPORTED);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it.each([
    { category: "quota", kind: "quota" },
    { category: "input", upstreamCode: "model_not_found", kind: "model-unavailable-upstream" },
  ])("terminal failure retains $kind when read from the Run", async ({ category, upstreamCode, kind }) => {
    const h = harness(engine);
    await h.start();
    h.query.mockResolvedValue({ status: "failed", raw: engine.failedRaw(encodeStructuredErrorMessage({ category, upstreamCode }, "opaque diagnostic")) });
    await h.submission.poll({ projectId: "project-1", operationId: "op-1" });
    const job = h.repository.read("project-1", "op-1")!.jobs[0];
    expect(job.errorCode).toBe("provider_task_failed");
    expect(job.errorMessage).not.toContain("opaque diagnostic");
    expect(decideGenerationFailure({ message: job.errorMessage ?? "", locale: "en" }).kind).toBe(kind);
  });
});
