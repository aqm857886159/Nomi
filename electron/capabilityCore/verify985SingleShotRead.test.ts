import { describe, expect, it } from "vitest";
import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "./mcpGenerationTools";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import { createPiGenerationTransportAdapter } from "./generationTransportAdapters";
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image"],
  modes: ["text-to-image", "image-to-image"],
  parameterSchema: { aspectRatio: { type: "enum", enum: ["1:1", "16:9"] } },
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "fixture-provider",
    models: [{
      modelId: "fixture-model",
      modes: ["text-to-image", "image-to-image"],
      parameterSchema: { seed: { type: "integer" } },
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    }],
  }],
}]);

// 完整的 ProjectLeaseV2 形状。签名相关字段（keyId/nonce/scopeHash/mac）这些用例用不到
// （handler 只读 projectId 之类），但类型上是必填的——缺了就是夹具在类型上撒谎。
const lease: ProjectLeaseV2 = {
  version: PROJECT_LEASE_VERSION,
  keyId: "key-1",
  algorithm: PROJECT_LEASE_ALGORITHM,
  issuer: "nomi-main",
  nonce: "nonce-1",
  scopeHash: "scope-hash-1",
  mac: "mac-1",
  projectId: "project-1",
  immutableProjectUuid: "project-uuid-1",
  projectGeneration: 1,
  canonicalRootDigest: "root-1",
  manifestDigest: "manifest-1",
  issuedAt: "2026-08-23T00:00:00.000Z",
  expiresAt: "2026-08-23T01:00:00.000Z",
  audience: PROJECT_LEASE_AUDIENCE,
  leasePrincipal: "mcp:codex",
  sessionId: "session-1",
  connectionNonce: "connection-1",
  revocationEpoch: 0,
  scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:read", "generation:cancel"],
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "candidate-1",
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "fixture-provider",
    modelId: "fixture-model",
    mode: "text-to-image",
    prompt: "A paper boat on a quiet lake",
    parameters: { aspectRatio: "1:1", seed: 7 },
    references: [],
    ...overrides,
  };
}

describe("V-3b: preflight candidate read on a SINGLE-shot draft (what draft_shots with one plain shot creates)", () => {
  it("readShotCandidateFacts on a real single-shot operation", async () => {
    const handler = createGenerationPlanningHandler({ registry, operations: createInMemoryGenerationOperationStore(), now: () => "2026-08-23T00:00:00.000Z" });
    const created = await handler({ capability: "create", params: { candidate: candidate() }, lease });
    const operationId = (created as { operation: { operationId: string } }).operation.operationId;
    const read = await handler({ capability: "read", params: { operationId }, lease }) as { operation: Record<string, unknown> };
    console.log("SINGLE_SHOT_OPERATION_KEYS", Object.keys(read.operation).join(","), "hasShots=", "shots" in read.operation);
    const adapter = createPiGenerationTransportAdapter(
      { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1 } as never,
      { planning: (async (input: { capability: string; params: Record<string, unknown> }) => handler({ ...input, lease } as never)) as never, leaseFor: () => lease },
    );
    await expect(adapter.readShotCandidateFacts!(operationId)).resolves.toBeDefined();
  });
});

describe("single-shot draft: references are read from operation.candidate; a missing operation still fails", () => {
  const adapterFor = (handler: ReturnType<typeof createGenerationPlanningHandler>) => createPiGenerationTransportAdapter(
    { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1 } as never,
    { planning: (async (input: { capability: string; params: Record<string, unknown> }) => handler({ ...input, lease } as never)) as never, leaseFor: () => lease },
  );
  it("a single-shot draft with a reference reports it under the no-shot key", async () => {
    const handler = createGenerationPlanningHandler({ registry, operations: createInMemoryGenerationOperationStore(), now: () => "2026-08-23T00:00:00.000Z" });
    const created = await handler({ capability: "create", params: { candidate: candidate({ references: [{ assetId: "asset-pre", contentHash: "a".repeat(64), version: 1, kind: "video" }] }) }, lease });
    const operationId = (created as { operation: { operationId: string } }).operation.operationId;
    await expect(adapterFor(handler).readShotCandidateFacts!(operationId)).resolves.toEqual({ references: { "": ["asset-pre"] }, durationSeconds: {} });
  });
  it("an operation that does not exist is not mistaken for the single-shot shape", async () => {
    const handler = createGenerationPlanningHandler({ registry, operations: createInMemoryGenerationOperationStore(), now: () => "2026-08-23T00:00:00.000Z" });
    await expect(adapterFor(handler).readShotCandidateFacts!("op-missing")).rejects.toThrow();
  });
});
