import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compileExecutionContract } from "../capabilityCore/executionContract";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import { createProductionRunRepository } from "./productionRunRepository";
import { createProductionGenerationOperationStore } from "./productionGenerationOperationStore";
import { createProductionRunService } from "./productionRunService";

const roots: string[] = [];
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "fixture-provider",
    models: [{ modelId: "fixture-model", modes: ["text-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }],
  }],
}]);

function candidate() {
  return {
    candidateId: "candidate-1", revision: 1, moduleId: "generation.single-shot", providerId: "fixture-provider", modelId: "fixture-model", mode: "text-to-image", prompt: "A paper boat", parameters: {}, references: [],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ProductionRun-owned generation operation store", () => {
  it("persists create, edit, seal and restart reads through the Run event log", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-generation-run-store-"));
    roots.push(root);
    const repository = createProductionRunRepository({ projectDirResolver: () => root, now: () => "2026-08-23T00:00:00.000Z" });
    const service = createProductionRunService({ repository, projectRootResolver: () => root, sleep: async () => {} });
    const operations = createProductionGenerationOperationStore(service);
    const created = await operations.create({ operationId: "op-1", projectId: "project-1", candidate: candidate(), now: "2026-08-23T00:00:00.000Z" });
    expect(created).toMatchObject({ operationId: "op-1", state: "draft", candidate: { revision: 1 } });

    const edited = await operations.patch("project-1", "op-1", { mode: "text-to-image", prompt: "A red paper boat" }, "2026-08-23T00:00:01.000Z");
    expect(edited).toMatchObject({ candidate: { revision: 2, prompt: "A red paper boat" } });
    const contract = compileExecutionContract(edited.candidate, registry);
    const sealed = await operations.seal("project-1", "op-1", contract, "2026-08-23T00:00:02.000Z");
    expect(sealed).toMatchObject({ state: "sealed", contract: { contractHash: contract.contractHash } });
    // Approval is owned by the Run authority, not by a second operation-store
    // history. Exercise the same durable command that the signed gate uses.
    const approving = service.readFull("project-1", "op-1");
    const approved = await service.command("project-1", "op-1", {
      commandId: "generation.approve:op-1:receipt-1",
      expectedRevision: approving.revision,
      type: "generation.approve",
      payload: { receiptId: "receipt-1", contractHash: contract.contractHash },
      issuedAt: "2026-08-23T00:00:02.500Z",
    });
    expect(approved.run.generationPlan).toMatchObject({ state: "sealed", approvedReceiptId: "receipt-1" });

    const restartedService = createProductionRunService({
      repository: createProductionRunRepository({ projectDirResolver: () => root, now: () => "2026-08-23T00:00:03.000Z" }),
      projectRootResolver: () => root,
      sleep: async () => {},
    });
    expect(createProductionGenerationOperationStore(restartedService).read("project-1", "op-1")).toMatchObject({ state: "sealed", approvedReceiptId: "receipt-1", contract: { contractHash: contract.contractHash } });
  });

  it("persists the authenticated transport origin instead of replacing it with a semantic default", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-generation-origin-"));
    roots.push(root);
    const repository = createProductionRunRepository({ projectDirResolver: () => root, now: () => "2026-08-23T00:00:00.000Z" });
    const service = createProductionRunService({ repository, projectRootResolver: () => root, sleep: async () => {} });
    const operations = createProductionGenerationOperationStore(service);

    await operations.create({
      operationId: "op-origin",
      projectId: "project-1",
      origin: { host: "codex", actorId: "client-1" },
      candidate: candidate(),
      now: "2026-08-23T00:00:00.000Z",
    });

    expect(service.readFull("project-1", "op-origin")).toMatchObject({
      origin: { host: "codex", actorId: "client-1" },
      policy: { trustedHosts: ["codex"], allowedProviders: ["fixture-provider"], allowedModels: ["fixture-model"] },
    });
  });

  it("inherits live automation budget and retry policy for semantic drafts", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-generation-policy-"));
    roots.push(root);
    const repository = createProductionRunRepository({ projectDirResolver: () => root, now: () => "2026-08-23T00:00:00.000Z" });
    const service = createProductionRunService({
      repository,
      projectRootResolver: () => root,
      sleep: async () => {},
      policyResolver: () => ({
        mode: "policy-auto",
        maxSpend: 100,
        maxAttemptsPerJob: 2,
        trustedHosts: ["nomi"],
        allowedProviders: ["fixture-provider"],
        allowedModels: ["fixture-model"],
        minimizeUploads: false,
      }),
    });
    const operations = createProductionGenerationOperationStore(service);

    await operations.create({ operationId: "op-policy", projectId: "project-1", origin: { host: "codex" }, candidate: candidate(), now: "2026-08-23T00:00:00.000Z" });

    expect(service.readFull("project-1", "op-policy").policy).toMatchObject({
      mode: "policy-auto",
      maxSpend: 100,
      maxAttemptsPerJob: 2,
      minimizeUploads: false,
      // The semantic operation still narrows the configured allowlist to the
      // authenticated candidate and transport origin.
      trustedHosts: ["codex"],
      allowedProviders: ["fixture-provider"],
      allowedModels: ["fixture-model"],
    });
  });
});
