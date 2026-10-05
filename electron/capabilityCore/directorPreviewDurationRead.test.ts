// 3D-BOX 花钱闸复核时长的主进程一半：出卡前预检从真的草稿账本（planning handler 的 read）读出每一镜候选的时长，
// 与参考素材同一次读、同一个只读口（不另开通道）。时长按候选参数的唯一 owner shotDurationSeconds 读。
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
  parameterSchema: { aspectRatio: { type: "enum", enum: ["1:1", "16:9"] }, duration: { type: "integer" } },
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

describe("readShotCandidateFacts: references and durations from one read of the real draft ledger", () => {
  const adapterFor = (handler: ReturnType<typeof createGenerationPlanningHandler>) => createPiGenerationTransportAdapter(
    { projectId: "project-1", immutableProjectUuid: "project-uuid-1", projectGeneration: 1 } as never,
    { planning: (async (input: { capability: string; params: Record<string, unknown> }) => handler({ ...input, lease } as never)) as never, leaseFor: () => lease },
  );
  it("a single-shot draft reports its duration under the no-shot key; no duration parameter = not declared", async () => {
    const handler = createGenerationPlanningHandler({ registry, operations: createInMemoryGenerationOperationStore(), now: () => "2026-08-23T00:00:00.000Z" });
    const withDuration = await handler({ capability: "create", params: { candidate: candidate({ parameters: { aspectRatio: "16:9", duration: 6 } }) }, lease }) as { operation: { operationId: string } };
    await expect(adapterFor(handler).readShotCandidateFacts!(withDuration.operation.operationId)).resolves.toEqual({ references: { "": [] }, durationSeconds: { "": 6 } });
    const without = await handler({ capability: "create", params: { candidate: candidate({ candidateId: "candidate-2" }) }, lease }) as { operation: { operationId: string } };
    await expect(adapterFor(handler).readShotCandidateFacts!(without.operation.operationId)).resolves.toEqual({ references: { "": [] }, durationSeconds: {} });
  });
});
