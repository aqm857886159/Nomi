// 「域里那句可行动的话到底有没有到模型那里」——2026-09-21 真实模型轨迹的回归锁。
//
// 入参**逐字**取自 `docs/evidence/2026-09-21-askback-real-model/trajectories/A3.jsonl`（seq=25，
// attempt=1）。那次模型收到的是：
//   The generation action could not be completed; its submission outcome may be unknown.
//   Next: Query the same domain-qualified task and reconcile its existing submission…
// 而复现拿到的真异常是两句它**改一次就能对**的话。`draft_shots` 一分钱花不出去，却被指挥去核对
// 一个从不存在的任务，A3 那一轮因此 27 次调用 / 696 秒。
//
// 这条测试走的是真正的那条链：动词投影 → 生成域 handler → adapter 的失败收敛 → lane 的措辞。
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "./moduleRegistry";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "./mcpGenerationTools";
import { createPiGenerationTransportAdapter } from "./generationTransportAdapters";
import { buildVideoModelCandidates } from "../shared/videoCapabilities";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import { verbToTransportCall } from "../agentLane/laneVerbTransport";
import { laneFailureFromDecision } from "../shared/agentLane/laneFailureFromDecision";
import type { ProjectBinding } from "../shared/projectBinding";

const videoModelCandidates = buildVideoModelCandidates([
  { provider: "apimart", modelKey: "doubao-seedance-2.5", label: "Seedance 2.5" },
]);

const anyParam = { type: "any" } as const;
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0",
  inputKinds: ["text", "image", "video"], outputKinds: ["video"],
  modes: ["text_to_video", "image_to_video"],
  parameterSchema: { duration: { type: "number" }, size: anyParam, resolution: anyParam, generate_audio: anyParam },
  assetInputSchema: { references: { kind: "asset", max: 30 } },
  providers: [{ providerId: "apimart", models: [{ modelId: "doubao-seedance-2.5",
    modes: ["text_to_video", "image_to_video"],
    parameterSchema: { duration: { type: "number" }, size: anyParam, resolution: anyParam, generate_audio: anyParam },
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] }],
}]);

const binding: ProjectBinding = { projectId: "project-1", immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1 };
const lease = {
  version: PROJECT_LEASE_VERSION, keyId: "k", algorithm: PROJECT_LEASE_ALGORITHM, issuer: "nomi-main",
  nonce: "n", scopeHash: "s", mac: "m", ...binding,
  canonicalRootDigest: "r", manifestDigest: "mf",
  issuedAt: "2026-09-21T00:00:00.000Z", expiresAt: "2099-09-21T00:00:00.000Z",
  audience: PROJECT_LEASE_AUDIENCE, leasePrincipal: "mcp:codex", sessionId: "s1", connectionNonce: "c1",
  revocationEpoch: 0, scopeSet: ["generation:create", "generation:plan", "generation:preview", "generation:read", "generation:cancel"],
} as ProjectLeaseV2;

/** A3 seq=25 那一镜，逐字（提示词截短，其余原样）。 */
const A3_SHOT = {
  title: "镜4 · 参考图融入",
  prompt: "深夜街道，参考图中的场景作为背景，一位疲惫的夜归人从远处走近",
  taskKind: "text_to_video", durationSec: 43.7,
  candidate: { providerId: "apimart", modelId: "doubao-seedance-2.5" },
  modeId: "omni",
  parameters: { size: "16:9", resolution: "720p", duration: 5, generate_audio: true },
  references: ["gen-v2-asset-mubc3wx1-i0us"],
};

async function modelSees(shot: Record<string, unknown>) {
  const handler = createGenerationPlanningHandler({
    registry, operations: createInMemoryGenerationOperationStore(),
    videoModelCandidates, now: () => "2026-09-21T00:00:00.000Z",
  } as never);
  const adapter = createPiGenerationTransportAdapter(binding, {
    planning: handler as never, leaseFor: () => lease,
  });
  const translated = verbToTransportCall({ toolCallId: "call-1", toolName: "draft_shots", args: { shots: [shot] } })!;
  const decision = await adapter.tryExecute(translated.call, new AbortController().signal);
  expect(decision && decision.ok === false).toBe(true);
  const failed = decision as Extract<typeof decision, { ok: false }>;
  return laneFailureFromDecision({
    toolName: "draft_shots", code: failed.code, message: failed.message,
    admission: failed.admission, issues: failed.issues, problem: failed.problem,
    fallbackCode: "tool_execution_failed", nextAction: "Read the canvas again and retry.",
  });
}

describe("生成域有意拒绝一次调用时，模型读到的是拒绝的理由", () => {
  it("参考素材不在库里 → 模型读到该去 look_at_media，而不是「去核对一个任务」", async () => {
    const failure = await modelSees(A3_SHOT);
    expect(failure.message).toContain("gen-v2-asset-mubc3wx1-i0us");
    expect(failure.message).toContain("look_at_media");
    // 兜底那句是这次实测里 23 次重试的直接原因，它不许再出现在一个起草工具上。
    expect(failure.message).not.toContain("submission outcome may be unknown");
    expect(failure.nextAction).not.toContain("Query the same domain-qualified task");
  });

  it("模式决定种类后继续校验时长 → 模型读到越界字段、合法范围与下一步", async () => {
    const { references: _dropped, ...withoutReferences } = A3_SHOT;
    const failure = await modelSees(withoutReferences);
    expect(failure.problem).toMatchObject({ code: "duration_not_in_mode", field: "durationSec", min: 4, max: 30, next: "use_allowed_value", charged: false });
    expect(failure.message).toContain("时长只能在 4～30 秒之间，收到 43.7 秒");
    expect(failure.message).toContain("请改成这个范围里的秒数，或者先问用户");
    expect(failure.nextAction).toContain("Nothing was submitted and nothing was charged");
    expect(failure.nextAction).toContain("Use one of the allowed values listed above and call the same tool again");
    expect(failure.message).not.toContain("submission outcome may be unknown");
    expect(failure.nextAction).not.toContain("Query the same domain-qualified task");
  });

  it("阳性对照：不是我们有意抛的那一档，正文一个字都不许流出去", async () => {
    const adapter = createPiGenerationTransportAdapter(binding, {
      planning: async () => { throw new Error("provider said: key sk-live-xxx is over quota at https://vendor.example"); },
      leaseFor: () => lease,
    });
    const decision = await adapter.tryExecute(
      { toolCallId: "call-2", toolName: "nomi_generation_status", args: { operation: "read", operationId: "op-1" } },
      new AbortController().signal);
    expect(JSON.stringify(decision)).not.toContain("sk-live");
    expect(JSON.stringify(decision)).not.toContain("vendor.example");
    expect(decision).toMatchObject({ ok: false, code: "generation_execution_failed" });
  });
});
