import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { ProjectLeaseV2 } from "../capabilityCore/projectLease";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { authorizedReferenceUrls } from "../shared/productionSpendAuthority";
import { landedAdmission } from "./landFirstTestUtils";
import { prepareProductionGenerationAuthorization, prepareProductionGenerationReauthorization } from "./prepareProductionGenerationAuthorization";
import { deriveGenerationReauthorizationState } from "./productionGenerationAuthorizationState";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { createProductionRunRepository } from "./productionRunRepository";

// 做片返工换链接：重做是又一份自带信封的授权，线上报文哈希按**这一份授权自己的**链接算、派发时也按它自己的核。
// 所以重新换过的链接不会被「报文对不上」拒发（productionSpendAuthority.authorizedReferenceUrls 旧注释说的"哈希就对不上了"不成立）。
// 这里用真的授权 → 重做授权 → 派发链，把它钉住；没换链接的返工（沿用冻住的那份）逐字不变。
const NOW = "2026-11-01T00:00:00.000Z";
const roots: string[] = [];
const OLD_URL = "https://tmp.example.com/old.png";
const FRESH_URL = "https://cdn.example.com/fresh.png";
const reference = { assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" as const };

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image"],
  modes: ["image-to-image"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "fixture-provider",
    models: [{
      modelId: "fixture-model",
      modes: ["image-to-image"],
      parameterSchema: {},
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    }],
  }],
}]);

const lease = { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1, revocationEpoch: 0 } as ProjectLeaseV2;

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-rework-reference-links-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => projectId === "project-1" ? root : null,
    now: () => NOW,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const candidate: PlanCandidate = {
    candidateId: "candidate-1", revision: 1, moduleId: "generation.single-shot", providerId: "fixture-provider", modelId: "fixture-model",
    mode: "image-to-image", prompt: "edit it", parameters: {}, references: [reference],
  };
  const contract = compileExecutionContract(candidate, registry);
  const submit = vi.fn(async (_request: unknown, _idempotencyKey?: string) => ({ providerTaskId: `provider-task-${submit.mock.calls.length}` }));
  // 发出去的请求里带着授权时冻住的参考链接：换链接 = 请求体变 = 哈希变，正是要钉住"换了也不被拒发"的那个量。
  const provider: GenerationProvider = {
    providerId: "fixture-provider",
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    buildRequest: (request) => ({ model: request.modelId, prompt: request.prompt, referenceUrls: request.referenceUrls ?? null }),
    submit,
  };
  repository.createGenerationDraft({
    operationId: "op-1", projectId: "project-1", origin: { host: "semantic-mcp" }, candidate,
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["fixture-provider"], allowedModels: ["fixture-model"], maxSpend: 100, maxAttemptsPerJob: 3 },
  });
  const initial = prepareProductionGenerationAuthorization({
    lease, projectRevision: 12, operation: { operationId: "op-1", projectId: "project-1", candidate, planVersion: 1 }, contract,
    run: repository.read("project-1", "op-1")!, providers: [provider], resolveShotPrice: () => ({ known: true, amount: 6 }), now: NOW,
    referenceUrlsByContract: { [contract.contractHash]: { [spendReferenceKey(reference)]: OLD_URL } },
  });
  const sealed = repository.execute("project-1", "op-1", { commandId: "seal", expectedRevision: 0, type: "generation.seal", payload: { contract, authorization: initial }, issuedAt: NOW }).run;
  repository.execute("project-1", "op-1", {
    commandId: "approve", expectedRevision: sealed.revision, type: "gate.decide",
    payload: { gateId: initial.envelope.gateId, status: "approved", receiptId: "receipt-1", authorizationDigest: initial.authorizationDigest }, issuedAt: NOW,
  });
  const submission = createProductionGenerationSubmission({
    repository, beforeDispatch: () => undefined, projectRoot: root, immutableProjectUuid: lease.immutableProjectUuid,
    projectGeneration: lease.projectGeneration, intentMacKey: "test-intent-key", providers: [provider], now: () => NOW,
  });
  return { repository, contract, submission, submit, provider };
}

async function firstAttemptReady(h: ReturnType<typeof harness>) {
  await h.submission.start({ projectId: "project-1", operationId: "op-1", admission: await landedAdmission(h.repository, "project-1", "op-1") });
  const run = h.repository.read("project-1", "op-1")!;
  return h.repository.execute("project-1", "op-1", {
    commandId: "first-attempt-ready", expectedRevision: run.revision, type: "job.status", payload: { jobId: run.jobs[0].jobId, status: "ready" }, issuedAt: NOW,
  }).run;
}

async function reworkAndDispatch(h: ReturnType<typeof harness>, referenceUrls?: Readonly<Record<string, string>>) {
  const run = await firstAttemptReady(h);
  const reauthorization = prepareProductionGenerationReauthorization({
    lease, projectRevision: 12, run, providers: [h.provider], resolveShotPrice: () => ({ known: true, amount: 6 }),
    now: "2026-11-01T00:01:00.000Z", ...(referenceUrls ? { referenceUrls } : {}),
  });
  // 重做授权的状态校验只钉 references，不钉链接：换了链接照样过。
  expect(() => deriveGenerationReauthorizationState({ run, preparation: reauthorization, now: NOW })).not.toThrow();
  let current = h.repository.execute("project-1", "op-1", {
    commandId: "request-rework", expectedRevision: run.revision, type: "generation.reauthorize", payload: { authorization: reauthorization }, issuedAt: "2026-11-01T00:01:00.000Z",
  }).run;
  current = h.repository.execute("project-1", "op-1", {
    commandId: "approve-rework", expectedRevision: current.revision, type: "gate.decide",
    payload: { gateId: reauthorization.envelope.gateId, status: "approved", receiptId: "receipt-rework", authorizationDigest: reauthorization.authorizationDigest }, issuedAt: "2026-11-01T00:01:00.000Z",
  }).run;
  await h.submission.start({ projectId: "project-1", operationId: "op-1", attempt: 2, admission: await landedAdmission(h.repository, "project-1", "op-1") });
  return { reauthorization, run: current };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("做片返工发的参考链接", () => {
  it("不给 referenceUrls：沿用上一次批准冻住的那份（行为一字不变），POST 共 2 次", async () => {
    const h = harness();
    const { reauthorization } = await reworkAndDispatch(h);
    expect(reauthorization.envelope.jobs[0].referenceUrls).toEqual({ [spendReferenceKey(reference)]: OLD_URL });
    expect(h.submit).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(h.submit.mock.calls[1][0])).toContain(OLD_URL);
  });

  it("给了换过的 referenceUrls：重做授权封的是新链接，派发的请求带新链接，封存校验不拒发，POST 仍只多 1 次", async () => {
    const h = harness();
    const fresh = { [spendReferenceKey(reference)]: FRESH_URL };
    const { reauthorization, run } = await reworkAndDispatch(h, fresh);
    expect(reauthorization.envelope.jobs[0].referenceUrls).toEqual(fresh);
    // 新链接进了这一份授权的线上报文哈希：和第一份授权（旧链接）的哈希不同。
    const firstGate = run.gates.find((gate) => gate.authorizationEnvelope && gate.authorizationEnvelope.gateId !== reauthorization.envelope.gateId);
    expect(firstGate?.authorizationEnvelope?.jobs[0].providerWirePayloadHash).toBeDefined();
    expect(reauthorization.envelope.jobs[0].providerWirePayloadHash).not.toBe(firstGate?.authorizationEnvelope?.jobs[0].providerWirePayloadHash);
    expect(h.submit).toHaveBeenCalledTimes(2);
    const secondRequest = JSON.stringify(h.submit.mock.calls[1][0]);
    expect(secondRequest).toContain(FRESH_URL);
    expect(secondRequest).not.toContain(OLD_URL);
    // 第一次发出去的仍是旧链接（历史不改写）。
    expect(JSON.stringify(h.submit.mock.calls[0][0])).toContain(OLD_URL);
    const final = h.repository.read("project-1", "op-1")!;
    expect(final.jobs.find((job) => job.attempt === 2)).toMatchObject({ status: "provider_accepted" });
  });

  it("换链接之后再返工（第三次）：沿用的是最近一份批准冻住的，也就是新链接", async () => {
    const h = harness();
    const fresh = { [spendReferenceKey(reference)]: FRESH_URL };
    const { run } = await reworkAndDispatch(h, fresh);
    expect(authorizedReferenceUrls(run, h.contract.contractHash)).toEqual(fresh);
  });
});
