import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "./moduleRegistry";
import {
  createGenerationPlanningHandler,
  createInMemoryGenerationOperationStore,
} from "./mcpGenerationTools";
import { SEEDANCE_2_5_APIMART_ARCHETYPE, GenerationResolveErrorCode } from "../shared/videoCapabilities";
import { PROJECT_LEASE_ALGORITHM, PROJECT_LEASE_AUDIENCE, PROJECT_LEASE_VERSION, type ProjectLeaseV2 } from "./projectLease";
import {
  GenerationResolveError,
  resolveGenerationPlanForProject,
  toResolveEnvelopeError,
} from "./generationResolveIpc";

const candidate = { provider: "apimart", modelKey: "doubao-seedance-2.5", label: "Seedance 2.5", archetype: SEEDANCE_2_5_APIMART_ARCHETYPE };

const videoRegistry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image", "video"],
  outputKinds: ["video"],
  modes: ["text-to-video", "image-to-video"],
  parameterSchema: { duration: { type: "number" } },
  assetInputSchema: { references: { kind: "asset", max: 30 } },
  providers: [{
    providerId: "video-provider",
    models: [{
      modelId: "video-model",
      modes: ["text-to-video", "image-to-video"],
      parameterSchema: { duration: { type: "number" } },
      capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
    }],
  }],
}]);

/** 与 mcpGenerationTools.test.ts 同构的完整 lease 夹具（resolve 分支不读其签名域，类型上必须齐全）。 */
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
  projectGeneration: 3,
  canonicalRootDigest: "root-digest-1",
  manifestDigest: "manifest-digest-1",
  audience: PROJECT_LEASE_AUDIENCE,
  leasePrincipal: "fixture",
  sessionId: "session-1",
  connectionNonce: "conn-1",
  issuedAt: "2026-08-23T00:00:00.000Z",
  expiresAt: "2026-08-23T01:00:00.000Z",
  revocationEpoch: 0,
  scopeSet: ["generation:plan"],
};

function planningHandler() {
  return createGenerationPlanningHandler({
    registry: videoRegistry,
    operations: createInMemoryGenerationOperationStore(),
    videoModelCandidates: [candidate],
    now: () => "2026-08-23T00:00:00.000Z",
  });
}

function depsFor(overrides: Partial<Parameters<typeof resolveGenerationPlanForProject>[0]> = {}) {
  const handler = planningHandler();
  return {
    getGenerationPlanning: () => handler,
    getCommittedProjectId: () => "project-1",
    ...overrides,
  };
}

const validRequest = {
  projectId: "project-1",
  shots: [
    { id: "s1", durationSec: 6, sceneAnchorId: "hall" },
    { id: "s2", durationSec: 4, sceneAnchorId: "hall" },
  ],
};

describe("resolveGenerationPlanForProject (GUI 窄 IPC 纯核心)", () => {
  it("调 seam resolve 并返回与 agent/MCP 同源的执行计划载荷", async () => {
    const value = await resolveGenerationPlanForProject(depsFor(), validRequest);
    expect(value.resolvedShots).toHaveLength(2);
    // 短拍同场合并建议（6+4=10 ≤ 上限）由同一 planResolver 引擎给出。
    expect(value.mergeProposals.length).toBeGreaterThan(0);
    expect(value.splitProposals).toEqual([]);
    expect(Array.isArray(value.planIssues)).toBe(true);
    for (const shot of value.resolvedShots) {
      expect(shot).toMatchObject({ modelKey: "doubao-seedance-2.5", modeId: expect.any(String) });
    }
  });

  it("GUI 通道（无 lease）与直接 seam（带 lease，agent/MCP 同路）产出逐字段一致 → 双端同源", async () => {
    const handler = planningHandler();
    const gui = await resolveGenerationPlanForProject(
      { getGenerationPlanning: () => handler, getCommittedProjectId: () => "project-1" },
      validRequest,
    );
    const mcp = await handler({
      capability: "resolve",
      params: { shots: validRequest.shots },
      lease,
    }) as {
      resolvedShots: unknown;
      mergeProposals: unknown;
      splitProposals: unknown;
      planIssues: unknown;
    };
    expect(gui.resolvedShots).toEqual(mcp.resolvedShots);
    expect(gui.mergeProposals).toEqual(mcp.mergeProposals);
    expect(gui.splitProposals).toEqual(mcp.splitProposals);
    expect(gui.planIssues).toEqual(mcp.planIssues);
  });

  it("请求形状非法 → fail-closed（code=generation_input_invalid）", async () => {
    const deps = depsFor();
    for (const raw of [
      null,
      [],
      {},
      { projectId: "project-1" },
      { projectId: "  ", shots: [{ id: "s1", durationSec: 5 }] },
      { projectId: "project-1", shots: [] },
      { projectId: "project-1", shots: [{ id: "s1", durationSec: 5 }], goals: { allowAdvisoryMerge: "yes" } },
    ]) {
      await expect(resolveGenerationPlanForProject(deps, raw)).rejects.toMatchObject({
        code: GenerationResolveErrorCode.InputInvalid,
      });
    }
  });

  it("没有打开项目 / 请求的 projectId 不是当前项目 → project_binding_stale", async () => {
    await expect(
      resolveGenerationPlanForProject(
        { getGenerationPlanning: () => planningHandler(), getCommittedProjectId: () => null },
        validRequest,
      ),
    ).rejects.toMatchObject({ code: GenerationResolveErrorCode.ProjectStale });

    await expect(
      resolveGenerationPlanForProject(
        { getGenerationPlanning: () => planningHandler(), getCommittedProjectId: () => "project-2" },
        validRequest,
      ),
    ).rejects.toMatchObject({ code: GenerationResolveErrorCode.ProjectStale });
  });

  it("能力核未装配 → generation_core_unavailable", async () => {
    await expect(
      resolveGenerationPlanForProject(
        { getGenerationPlanning: () => null, getCommittedProjectId: () => "project-1" },
        validRequest,
      ),
    ).rejects.toMatchObject({ code: GenerationResolveErrorCode.CoreUnavailable });
  });

  it("shot 深层非法（缺有限 durationSec）由 seam 拦截，code 透传为 generation_input_invalid", async () => {
    await expect(
      resolveGenerationPlanForProject(depsFor(), {
        projectId: "project-1",
        shots: [{ id: "s1", durationSec: "六秒" }],
      }),
    ).rejects.toMatchObject({ code: GenerationResolveErrorCode.InputInvalid });
  });

  it("seam 返回形状退化 → invalid_result（防御性闸，不放垃圾到渲染层）", async () => {
    const fake = {
      getGenerationPlanning: () => (async () => ({ resolvedShots: "nope" })) as never,
      getCommittedProjectId: () => "project-1",
    };
    await expect(resolveGenerationPlanForProject(fake, validRequest)).rejects.toMatchObject({
      code: GenerationResolveErrorCode.InvalidResult,
    });
  });
});

describe("toResolveEnvelopeError (ok=false 信封映射)", () => {
  it("GenerationResolveError → 自带 code", () => {
    expect(toResolveEnvelopeError(new GenerationResolveError("x.y", "m"))).toEqual({ code: "x.y", message: "m" });
  });

  it("带 code 的普通对象错误（seam 的 Object.assign 风格）→ 优先用原始 code", () => {
    expect(toResolveEnvelopeError(Object.assign(new Error("bad"), { code: "generation_input_invalid" }))).toEqual({
      code: "generation_input_invalid",
      message: "bad",
    });
  });

  it("无 code 的未知错误 → generation_resolve_failed", () => {
    expect(toResolveEnvelopeError(new Error("boom"))).toEqual({ code: "generation_resolve_failed", message: "boom" });
    expect(toResolveEnvelopeError("oops")).toEqual({ code: "generation_resolve_failed", message: "oops" });
  });
});
