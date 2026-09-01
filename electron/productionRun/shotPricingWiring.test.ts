import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { applyProductionCommand, SealBudgetExceededError } from "./productionRunReducer";
import { createProductionGenerationSubmission } from "./productionGenerationSubmission";
import { sealAndApproveProductionGeneration } from "./productionGenerationAuthorizationTestUtils";
import { createProductionRunRepository } from "./productionRunRepository";
import type { ProductionGenerationShot, ProductionRun } from "./productionRunTypes";

// P4 S2 wiring: the seal precheck (reducer, hard-cap enforced at the single source of truth) and the
// real-number ledger on the submission seam (approval.maxSpend / budget authorize / reserve = derived
// price, not ¥0). These are the "接线" half of S2 — the pure derive is covered in shotPricing.test.ts.

const now = "2026-08-24T00:00:00.000Z";
const roots: string[] = [];

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

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------------------------
// Seal precheck (reducer)
// -----------------------------------------------------------------------------------------------

function threeShotDraft(maxSpend: number | null): ProductionRun {
  const a = candidate("cand-a", "shot a");
  const b = candidate("cand-b", "shot b");
  const c = candidate("cand-c", "shot c");
  return {
    schemaVersion: 1, runId: "op-seal", projectId: "project-1", revision: 2,
    status: "draft", stageId: "generate", playbook: { name: "generation.single-shot", version: "1.0.0" },
    origin: { host: "semantic-mcp" },
    policy: { mode: "balanced", trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend, maxAttemptsPerJob: 2, minimizeUploads: true },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1, snapshotCursor: 2, stages: [], gates: [], jobs: [], artifacts: [],
    generationPlan: {
      operationId: "op-seal", state: "draft", candidate: a,
      shots: [
        { shotId: "shot-a", candidate: a, updatedAt: now },
        { shotId: "shot-b", candidate: b, updatedAt: now },
        { shotId: "shot-c", candidate: c, updatedAt: now },
      ],
      updatedAt: now,
    },
    createdAt: now, updatedAt: now,
  };
}

function sealCommand(draft: ProductionRun, shotPrices: Array<{ shotId: string; price: unknown }> | undefined) {
  const a = draft.generationPlan!.shots![0].candidate;
  const b = draft.generationPlan!.shots![1].candidate;
  const c = draft.generationPlan!.shots![2].candidate;
  const aContract = compileExecutionContract(a, registry);
  const bContract = compileExecutionContract(b, registry);
  const cContract = compileExecutionContract(c, registry);
  const shots: ProductionGenerationShot[] = [
    { shotId: "shot-a", candidate: { ...a, sealedContractHash: aContract.contractHash }, contract: aContract, updatedAt: now },
    { shotId: "shot-b", candidate: { ...b, sealedContractHash: bContract.contractHash }, contract: bContract, updatedAt: now },
    { shotId: "shot-c", candidate: { ...c, sealedContractHash: cContract.contractHash }, contract: cContract, updatedAt: now },
  ];
  return {
    commandId: "seal-op", expectedRevision: 2, type: "generation.seal" as const,
    payload: { contract: aContract, shots, planHash: "plan-hash-seal", ...(shotPrices ? { shotPrices } : {}) },
    issuedAt: now,
  };
}

describe("P4 S2 seal precheck", () => {
  it("rejects the seal with maxAffordableShots when the hard cap cannot cover the known subtotal", () => {
    const draft = threeShotDraft(25);
    const command = sealCommand(draft, [
      { shotId: "shot-a", price: { known: true, amount: 10 } },
      { shotId: "shot-b", price: { known: true, amount: 10 } },
      { shotId: "shot-c", price: { known: true, amount: 10 } },
    ]);
    try {
      applyProductionCommand(draft, command, now);
      throw new Error("expected SealBudgetExceededError");
    } catch (error) {
      expect(error).toBeInstanceOf(SealBudgetExceededError);
      const typed = error as SealBudgetExceededError;
      expect(typed.code).toBe("seal_budget_exceeded");
      expect(typed.maxAffordableShots).toBe(2); // 10 + 10 fit under 25; the third breaches.
      expect(typed.maxSpend).toBe(25);
      expect(typed.knownSubtotal).toBe(30);
    }
  });

  it("seals and marks costCertainty=known when the cap covers every priced shot", () => {
    const draft = threeShotDraft(40);
    const effect = applyProductionCommand(draft, sealCommand(draft, [
      { shotId: "shot-a", price: { known: true, amount: 10 } },
      { shotId: "shot-b", price: { known: true, amount: 10 } },
      { shotId: "shot-c", price: { known: true, amount: 10 } },
    ]), now);
    expect(effect.run.generationPlan?.state).toBe("sealed");
    expect(effect.run.generationPlan?.costCertainty).toBe("known");
  });

  it("seals and marks costCertainty=partial when a shot price is unknown (cap satisfied by known ones)", () => {
    const draft = threeShotDraft(25);
    const effect = applyProductionCommand(draft, sealCommand(draft, [
      { shotId: "shot-a", price: { known: true, amount: 10 } },
      { shotId: "shot-b", price: { known: false } },
      { shotId: "shot-c", price: { known: true, amount: 10 } },
    ]), now);
    // Known subtotal 20 ≤ 25 → seals; unknown shot flags partial certainty.
    expect(effect.run.generationPlan?.state).toBe("sealed");
    expect(effect.run.generationPlan?.costCertainty).toBe("partial");
  });

  it("seals unbounded (no maxSpend) and still records certainty", () => {
    const draft = threeShotDraft(null);
    const effect = applyProductionCommand(draft, sealCommand(draft, [
      { shotId: "shot-a", price: { known: true, amount: 100 } },
      { shotId: "shot-b", price: { known: true, amount: 100 } },
      { shotId: "shot-c", price: { known: true, amount: 100 } },
    ]), now);
    expect(effect.run.generationPlan?.state).toBe("sealed");
    expect(effect.run.generationPlan?.costCertainty).toBe("known");
  });

  it("stays byte-identical (no precheck, no costCertainty) when the caller supplies no shotPrices", () => {
    const draft = threeShotDraft(25); // a cap that WOULD reject if a precheck ran
    const effect = applyProductionCommand(draft, sealCommand(draft, undefined), now);
    expect(effect.run.generationPlan?.state).toBe("sealed");
    expect(effect.run.generationPlan?.costCertainty).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------------------------
// Real-number ledger on the submission seam
// -----------------------------------------------------------------------------------------------

function sealedApprovedSingleShot(priceAmount: number | null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-s2-ledger-"));
  roots.push(root);
  const repository = createProductionRunRepository({
    projectDirResolver: (projectId) => (projectId === "project-1" ? root : null),
    now: () => now,
    randomId: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const planCandidate = candidate("candidate-1", "a paper boat");
  const contract = compileExecutionContract(planCandidate, registry);
  repository.createGenerationDraft({
    operationId: "op-1", projectId: "project-1", origin: { host: "semantic-mcp" }, candidate: planCandidate,
    policy: { trustedHosts: ["semantic-mcp"], allowedProviders: ["fixture-provider"], allowedModels: ["fixture-model"], maxSpend: null, maxAttemptsPerJob: 2 },
  });
  const submit = vi.fn(async () => ({ providerTaskId: "provider-task-1", raw: { accepted: true } }));
  const provider = { providerId: "fixture-provider", capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true }, buildRequest: (input: unknown) => input, submit } as const;
  sealAndApproveProductionGeneration({
    repository,
    projectId: "project-1",
    operationId: "op-1",
    immutableProjectUuid: "project-uuid-1",
    projectGeneration: 1,
    projectRevision: 0,
    candidate: planCandidate,
    contract,
    providers: [provider],
    resolveShotPrice: () => (priceAmount === null ? { known: false } : { known: true, amount: priceAmount }),
    receiptId: "receipt-1",
    now,
  });
  const runner = createProductionGenerationSubmission({
    repository, projectRoot: root, immutableProjectUuid: "project-uuid-1", projectGeneration: 1, projectRevision: 0, intentMacKey: "test-intent-key",
    provider,
    now: () => now,
  });
  return { repository, runner, submit };
}

describe("P4 S2 real-number ledger on submission", () => {
  it("authorizes + reserves the derived price and records it as the approval's maxSpend", async () => {
    const { repository, runner } = sealedApprovedSingleShot(12);
    await runner.start({ projectId: "project-1", operationId: "op-1" });

    const run = repository.read("project-1", "op-1")!;
    // Ledger authorized to the derived price, and the shot's price reserved (no longer ¥0).
    expect(run.budget.authorized).toBe(12);
    expect(run.budget.reserved).toBe(12);

    const approval = repository.readApprovals("project-1", "op-1").find((a) => a.jobIds.includes(run.jobs[0].jobId));
    expect(approval?.maxSpend).toBe(12);
  });

  it("fails closed before the gate when the provider price is unknown", () => {
    expect(() => sealedApprovedSingleShot(null)).toThrow("Cannot authorize paid generation without a known price");
  });
});
