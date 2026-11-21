// 类级回归：**上个模型留下的参数**与**调用方这一次点名的参数**是两件事，待遇不同。
//
//   · 点名的 → 当场拒（模型才有得自纠）；
//   · 残留的 → 清掉 + 如实上报，**绝不拒**（升级前落盘的草稿必须还读得起来）。
//
// 2026-09-22 验收查到两个缺口，这条测试各钉一个：
//   ① 「不上报 clearedParameters」这个变异**杀不掉**——因为清理根本没落盘：
//      `normalizedPatch` 里没有 `parameters`，算了一遍、报了一遍，存的还是旧参数。
//   ② 存量草稿的残留在 preview 时会被当场拒，旧数据一打开就报错。
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "./mcpGenerationTools";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import { withFixedCatalog } from "./generationFixedCatalog.testkit";

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{
    providerId: "vendor-a",
    models: [
      // 两个模型，参数表**故意不同**：`grain` 只有 old 有，`sharpen` 只有 new 有。
      { modelId: "model-old", modes: ["text-to-image"], parameterSchema: { aspect_ratio: { type: "enum", enum: ["1:1"] }, grain: { type: "number" } }, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } },
      { modelId: "model-new", modes: ["text-to-image"], parameterSchema: { aspect_ratio: { type: "enum", enum: ["1:1"] }, sharpen: { type: "number" } }, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } },
    ],
  }],
}]);

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

function candidate(parameters: Record<string, unknown>) {
  return {
    candidateId: "candidate-1", revision: 1, moduleId: "generation.single-shot",
    providerId: "vendor-a", modelId: "model-old", mode: "text-to-image",
    prompt: "a paper boat", parameters, references: [],
  };
}

async function draft(parameters: Record<string, unknown>) {
  const operations = createInMemoryGenerationOperationStore();
  const handler = createGenerationPlanningHandler(withFixedCatalog({ registry, operations, resolveModelPricing: () => ({ cost: 0, enabled: true, specCosts: [] }), now: () => "2026-09-22T00:00:00.000Z" }));
  const created = await handler({ capability: "create", params: { candidate: candidate(parameters) }, lease }) as { operation: { operationId: string } };
  return { handler, operationId: created.operation.operationId, operations };
}

/**
 * 升级前落盘的草稿：直接写进存储，**不经过起草准入**。起草现在就拒不认识的键（2026-10-18），
 * 所以这样的草稿只可能是旧数据——正是这两条回归要守的「旧数据仍读得起来」。
 */
async function legacyDraft(parameters: Record<string, unknown>) {
  const operations = createInMemoryGenerationOperationStore();
  const handler = createGenerationPlanningHandler(withFixedCatalog({ registry, operations, resolveModelPricing: () => ({ cost: 0, enabled: true, specCosts: [] }), now: () => "2026-09-22T00:00:00.000Z" }));
  const created = await operations.create({ operationId: "op-legacy", projectId: "project-1", candidate: candidate(parameters), now: "2026-09-22T00:00:00.000Z" });
  return { handler, operationId: created.operationId, operations };
}

describe("cross-model parameter leftovers", () => {
  it("clears the previous model's parameters on a model switch, reports them, and persists the cleanup", async () => {
    const { handler, operationId } = await draft({ aspect_ratio: "1:1", grain: 4 });
    const patched = await handler({
      capability: "plan",
      params: { operationId, patch: { modelId: "model-new" } },
      lease,
    }) as { operation: { candidate: { parameters: Record<string, unknown> } }; changeset?: { clearedParameters?: string[] } };

    // ① 上报（这一半原本就有）
    expect(patched.changeset?.clearedParameters).toEqual(["grain"]);
    // ② **落盘**（这一半原本缺失，正是「不上报」那个变异杀不掉的原因）
    expect(patched.operation.candidate.parameters).toEqual({ aspect_ratio: "1:1" });
    expect(patched.operation.candidate.parameters).not.toHaveProperty("grain");
  });

  it("keeps a legacy draft readable: preview cleans stored leftovers instead of refusing", async () => {
    // 升级前落盘的草稿：参数里带着这个模型不认的键，而这一次调用没有任何人点名它。
    const { handler, operationId, operations } = await legacyDraft({ aspect_ratio: "1:1", legacy_knob: 9 });
    const current = await operations.read("project-1", operationId);
    expect(current?.candidate.parameters).toHaveProperty("legacy_knob");

    const preview = await handler({ capability: "preview", params: { operationId }, lease }) as {
      contract: { parameters: Record<string, unknown> }; clearedParameters?: string[];
    };
    // 不拒：旧数据读得起来。
    expect(preview.clearedParameters).toEqual(["legacy_knob"]);
    // 而且清掉的东西不会上 wire。
    expect(preview.contract.parameters).toEqual({ aspect_ratio: "1:1" });
  });

  it("preview -> gate_request on the SAME untouched legacy draft: the cleanup is persisted, the paid gate does not explode", async () => {
    // 2026-09-22 第二轮验收的阻断项①：上一轮 preview 只在局部清、不回写，gate_request 压根不清
    // ⇒ 同一张未改动的草稿**预览看得见、点确认时炸**。破坏没关闭，只是从预览挪到了付费闸。
    const { handler, operationId, operations } = await legacyDraft({ aspect_ratio: "1:1", legacy_knob: 9 });

    const preview = await handler({ capability: "preview", params: { operationId }, lease }) as { clearedParameters?: string[] };
    expect(preview.clearedParameters).toEqual(["legacy_knob"]);

    // ① **读盘验证**，不只看返回值：清理必须已经落盘。
    const afterPreview = await operations.read("project-1", operationId);
    expect(afterPreview?.candidate.parameters).toEqual({ aspect_ratio: "1:1" });

    // ② 再 preview 一次不该再报同一批（报了就说明还是没落盘）。
    const again = await handler({ capability: "preview", params: { operationId }, lease }) as { clearedParameters?: string[] };
    expect(again.clearedParameters).toBeUndefined();

    // ③ 同一张草稿、什么都没改，直接走付费闸——这一步以前抛 unknown_parameter。
    //    （gate_request 会密封草稿，所以它放在最后。）
    await expect(handler({ capability: "gate_request", params: { operationId }, lease })).resolves.toBeTruthy();
  });

  it("still refuses a parameter the caller names in this very call", async () => {
    const { handler, operationId } = await draft({ aspect_ratio: "1:1" });
    await expect(handler({
      capability: "plan",
      params: { operationId, patch: { parameters: { aspect_ratio: "1:1", not_a_real_key: 1 } } },
      lease,
    })).rejects.toThrow(/not_a_real_key/);
  });
});
