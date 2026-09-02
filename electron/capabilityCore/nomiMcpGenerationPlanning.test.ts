import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMcpProtocol, type McpTransport } from "./mcpProtocol";
import { dispatch } from "./dispatcher";
import type { McpConnectionContext } from "./mcpConnectionContext";
import { createMcpGenerationPolicy } from "./mcpGenerationPolicy";
import { createGenerationPlanningHandler } from "./mcpGenerationTools";
import { createModuleRegistry } from "./moduleRegistry";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import { createProjectLeaseAuthority } from "./projectLease";
import { createProjectLeaseStore } from "./projectLeaseStore";
import { createProjectSessionAuthority } from "./projectSessionAuthority";
import { createProductionGenerationOperationStore } from "../productionRun/productionGenerationOperationStore";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import { createProductionRunService } from "../productionRun/productionRunService";
import { APIMART_VIDEO_MODELS } from "../catalog/apimartVideos";
import { applyBuiltinSeeds } from "../catalog/seedBuiltins";
import { buildVideoModelCandidates, recommendVideoGeneration, videoArchetypeIdFromMeta } from "../shared/videoCapabilities";

const videoModelCandidates = buildVideoModelCandidates([
  { provider: "apimart", modelKey: "doubao-seedance-2.0", label: "Seedance 2.0" },
  { provider: "apimart", modelKey: "doubao-seedance-2.0-fast", label: "Seedance 2.0 Fast" },
  { provider: "apimart", modelKey: "doubao-seedance-2.0-mini", label: "Seedance 2.0 Mini" },
]);

const seededCatalog = applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, "2026-08-23T00:00:00.000Z").state;
const realCatalogModelKeys = new Set(APIMART_VIDEO_MODELS
  .filter((model) => ["doubao-seedance-2.0", "veo3.1-fast", "MiniMax-Hailuo-2.3"].includes(model.modelKey))
  .map((model) => model.modelKey));
const realCatalogModels = seededCatalog.models.filter((model) => model.vendorKey === "apimart" && model.kind === "video" && realCatalogModelKeys.has(model.modelKey));
const realCatalogVideoModelCandidates = buildVideoModelCandidates(realCatalogModels.map((model) => ({
  provider: model.vendorKey,
  modelKey: model.modelKey,
  label: model.labelZh,
  archetypeId: videoArchetypeIdFromMeta(model.meta),
})));

const roots: string[] = [];
const connection: McpConnectionContext = Object.freeze({
  authenticatedClient: "codex",
  principal: "mcp:codex",
  sessionId: "mcp-session:test",
  connectionNonce: "connection-test",
});
const projectIdentity = Object.freeze({
  projectId: "project-1",
  immutableProjectUuid: "project-uuid",
  projectGeneration: 1,
  canonicalRootDigest: "root",
});
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
    models: [{ modelId: "fixture-model", modes: ["text-to-image", "image-to-image"], parameterSchema: { seed: { type: "integer" } }, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }],
  }],
}]);

const degradedRegistry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["image"],
  modes: ["text-to-image"],
  parameterSchema: { aspectRatio: { type: "enum", enum: ["1:1", "16:9"] } },
  assetInputSchema: {},
  providers: [{
    providerId: "apimart",
    models: [{ modelId: "gpt-image-2", modes: ["text-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false } }],
  }],
}]);

const editableRegistry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["image", "video"],
  outputKinds: ["image", "video"],
  modes: ["text-to-image", "image-to-image", "text-to-video", "image-to-video"],
  parameterSchema: { aspectRatio: { type: "enum", enum: ["1:1", "16:9"] }, duration: { type: "number" }, seed: { type: "integer" } },
  assetInputSchema: { references: { kind: "asset", max: 4 } },
  providers: [
    { providerId: "provider-image", models: [{ modelId: "model-image-a", modes: ["text-to-image", "image-to-image"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] },
    { providerId: "provider-video", models: [{ modelId: "model-video-b", modes: ["text-to-video", "image-to-video"], parameterSchema: {}, capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true } }] },
  ],
}]);

const videoEditableRegistry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image", "video"],
  outputKinds: ["video"],
  modes: ["text-to-video", "image-to-video", "firstlast"],
  parameterSchema: { duration: { type: "number" }, seed: { type: "integer" } },
  assetInputSchema: { references: { kind: "asset", max: 9 } },
  providers: [{
    providerId: "video-provider",
    models: [{
      modelId: "video-model",
      modes: ["text-to-video", "image-to-video", "firstlast"],
      parameterSchema: { duration: { type: "number" }, seed: { type: "integer" } },
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    }],
  }],
}]);

const realCatalogVideoRegistry = createCatalogModuleRegistry(seededCatalog, {
  readinessByProvider: {
    apimart: {
      providerReady: true,
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    },
  },
});

function makeAuthority(root: string) {
  return createProjectLeaseAuthority({
    macKey: "mcp-journey-authority",
    keyId: "mcp-journey-v1",
    store: createProjectLeaseStore({ filePath: path.join(root, "leases.json"), macKey: "mcp-journey-store", keyId: "mcp-journey-store-v1", now: () => "2026-08-23T00:00:00.000Z" }),
    verifyProjectIdentity: async (projectId) => {
      if (projectId !== projectIdentity.projectId) throw new Error("project identity unavailable");
      return projectIdentity;
    },
    now: () => "2026-08-23T00:00:00.000Z",
    randomId: (() => { let n = 0; return () => `lease-${++n}` })(),
  });
}

async function makeLease(
  authority: ReturnType<typeof makeAuthority>,
  scopeSet: string[],
) {
  const selection = authority.issueSelectionHandle({
    ...projectIdentity,
    manifestDigest: "manifest",
    scopeSet,
  }, connection);
  return authority.issueLease(selection.token, connection);
}

function makeProjectSession(
  leaseAuthority: ReturnType<typeof makeAuthority>,
  generationPolicy: ReturnType<typeof createMcpGenerationPolicy>,
) {
  return {
    authority: createProjectSessionAuthority({
      leaseAuthority,
      generationPolicy,
      resolveProjectSelection: async () => ({ ...projectIdentity, manifestDigest: "manifest" }),
    }),
    connection,
  };
}

function makeCandidate() {
  return {
    candidateId: "candidate-journey",
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "fixture-provider",
    modelId: "fixture-model",
    mode: "text-to-image",
    prompt: "A quiet paper boat on a lake",
    parameters: { aspectRatio: "1:1", seed: 4 },
    references: [],
  };
}

function makeEditableCandidate() {
  return {
    candidateId: "candidate-editable",
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "provider-image",
    modelId: "model-image-a",
    mode: "text-to-image",
    prompt: "A quiet paper boat on a lake",
    parameters: { aspectRatio: "1:1", seed: 4 },
    references: [{ assetId: "asset-a", contentHash: "hash-a", version: 1 }],
  };
}

class McpJourneyHarness {
  readonly invoke = vi.fn<(method: string, params: Record<string, unknown>) => Promise<unknown>>();
  private readonly protocol: ReturnType<typeof createMcpProtocol>;
  private readonly queue: Array<Record<string, unknown>> = [];
  private readonly waiters: Array<(message: Record<string, unknown>) => void> = [];

  constructor(invoke: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
    this.invoke.mockImplementation(invoke);
    const transport: McpTransport = {
      send: (message) => {
        const frame = message as Record<string, unknown>;
        const waiter = this.waiters.shift();
        if (waiter) waiter(frame);
        else this.queue.push(frame);
      },
      invoke: this.invoke,
      isAppOpen: () => false,
    };
    this.protocol = createMcpProtocol(transport);
  }

  private next(): Promise<Record<string, unknown>> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async call(id: number, method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.protocol.handleIncoming({ jsonrpc: "2.0", id, method, params });
    const response = await this.next();
    expect(response.id).toBe(id);
    return response;
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("MCP semantic generation planning journey", () => {
  it("tools/call create → edit → preview reaches one durable Run and never reaches runTask", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-mcp-generation-journey-"));
    roots.push(root);
    const repository = createProductionRunRepository({ projectDirResolver: () => root, now: () => "2026-08-23T00:00:00.000Z" });
    const service = createProductionRunService({ repository, projectRootResolver: () => root, sleep: async () => {} });
    const operations = createProductionGenerationOperationStore(service);
    const handler = createGenerationPlanningHandler({ registry, operations, now: () => "2026-08-23T00:00:00.000Z" });
    const authority = makeAuthority(root);
    const lease = (await makeLease(authority, ["context:read", "generation:create", "generation:plan", "generation:preview", "generation:read"])).token;
    const generationPolicy = createMcpGenerationPolicy({ env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: "1" }, checkpoints: { p0Passed: true, p2Passed: true } });
    const runTask = vi.fn(async () => { throw new Error("semantic planning must not call runTask"); });
    const context = {
      runTask,
      makeGateway: () => { throw new Error("semantic planning must not create a gateway"); },
      productionRuns: service,
      origin: { host: "codex" as const },
      generationPolicy,
      projectSession: makeProjectSession(authority, generationPolicy),
      generationPlanning: handler,
    };
    const harness = new McpJourneyHarness((method, params) => dispatch(method, params, context));

    await harness.call(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Codex" } });
    const created = await harness.call(2, "tools/call", { name: "nomi_operation_plan", arguments: { leaseHandle: lease, candidate: makeCandidate() } });
    expect(created.result).toBeTruthy();
    const operationId = [...(await repository.list("project-1"))][0]?.runId;
    expect(operationId).toMatch(/^op-/);

    await harness.call(3, "tools/call", { name: "nomi_operation_plan", arguments: { leaseHandle: lease, operationId, patch: { mode: "image-to-image", references: [{ assetId: "asset-1", contentHash: "hash-1", version: 1 }], parameters: { aspectRatio: "16:9", seed: 9 } } } });
    const preview = await harness.call(4, "tools/call", { name: "nomi_operation_preview", arguments: { leaseHandle: lease, operationId } });
    expect(preview.result).toBeTruthy();
    expect(repository.read("project-1", operationId!).generationPlan).toMatchObject({ state: "draft", candidate: { revision: 2, mode: "image-to-image" } });
    expect(runTask).not.toHaveBeenCalled();
    // 面收敛：nomi_operation_preview 工具在 catalog 层路由到原内部 method 字面量 nomi_preview_execution（handler 不变）。
    expect(harness.invoke).toHaveBeenCalledWith("nomi_preview_execution", expect.objectContaining({ operationId }));
  });

  it("keeps real-page freedom across provider/model/mode/parameter/reference edits", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-mcp-generation-edit-matrix-"));
    roots.push(root);
    const repository = createProductionRunRepository({ projectDirResolver: () => root, now: () => "2026-08-23T00:00:00.000Z" });
    const service = createProductionRunService({ repository, projectRootResolver: () => root, sleep: async () => {} });
    const operations = createProductionGenerationOperationStore(service);
    const handler = createGenerationPlanningHandler({ registry: editableRegistry, operations, now: () => "2026-08-23T00:00:00.000Z" });
    const authority = makeAuthority(root);
    const lease = (await makeLease(authority, ["context:read", "generation:create", "generation:plan", "generation:preview", "generation:read"])).token;
    const generationPolicy = createMcpGenerationPolicy({ env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: "1" }, checkpoints: { p0Passed: true, p2Passed: true } });
    const context = {
      runTask: vi.fn(async () => { throw new Error("editable semantic journey must not call runTask"); }),
      makeGateway: () => { throw new Error("editable semantic journey must not create a gateway"); },
      productionRuns: service,
      origin: { host: "codex" as const },
      generationPolicy,
      projectSession: makeProjectSession(authority, generationPolicy),
      generationPlanning: handler,
    };
    const harness = new McpJourneyHarness((method, params) => dispatch(method, params, context));
    await harness.call(11, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Codex" } });
    const created = await harness.call(12, "tools/call", { name: "nomi_operation_plan", arguments: { leaseHandle: lease, candidate: makeEditableCandidate() } });
    expect(created.result).toBeTruthy();
    const operationId = [...(await repository.list("project-1"))][0]?.runId;
    expect(operationId).toMatch(/^op-/);

    const edits = [
      { providerId: "provider-image", modelId: "model-image-a", mode: "image-to-image", parameters: { aspectRatio: "16:9", seed: 8 }, references: [{ assetId: "asset-b", contentHash: "hash-b", version: 2 }, { assetId: "asset-a", contentHash: "hash-a", version: 1 }] },
      { providerId: "provider-video", modelId: "model-video-b", mode: "image-to-video", parameters: { duration: 5 }, references: [{ assetId: "asset-c", contentHash: "hash-c", version: 1 }] },
    ];
    for (const [index, patch] of edits.entries()) {
      await harness.call(13 + index * 2, "tools/call", { name: "nomi_operation_plan", arguments: { leaseHandle: lease, operationId, patch } });
      const preview = await harness.call(14 + index * 2, "tools/call", { name: "nomi_operation_preview", arguments: { leaseHandle: lease, operationId } });
      expect(preview.result).toBeTruthy();
      expect(repository.read("project-1", operationId!).generationPlan).toMatchObject({ state: "draft", candidate: patch });
      const previewText = (preview.result as { content?: Array<{ text?: string }> }).content?.[0]?.text;
      const previewPayload = JSON.parse(previewText ?? "{}");
      expect(previewPayload.contract).toMatchObject({ providerId: patch.providerId, mode: patch.mode, contractHash: expect.any(String) });
    }
    expect(repository.read("project-1", operationId!).generationPlan?.candidate.revision).toBe(3);
    expect(context.runTask).not.toHaveBeenCalled();
  });

  it("recomputes shared recommendations when a user replaces references and edits a model parameter", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-mcp-generation-video-edit-"));
    roots.push(root);
    const repository = createProductionRunRepository({ projectDirResolver: () => root, now: () => "2026-08-23T00:00:00.000Z" });
    const service = createProductionRunService({ repository, projectRootResolver: () => root, sleep: async () => {} });
    const operations = createProductionGenerationOperationStore(service);
    const runTask = vi.fn(async () => { throw new Error("video planning must not call runTask"); });
    const handler = createGenerationPlanningHandler({
      registry: videoEditableRegistry,
      operations,
      videoModelCandidates,
      recommendVideoGeneration,
      now: () => "2026-08-23T00:00:00.000Z",
    });
    const authority = makeAuthority(root);
    const lease = (await makeLease(authority, ["context:read", "generation:create", "generation:plan", "generation:preview", "generation:read"])).token;
    const generationPolicy = createMcpGenerationPolicy({ env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: "1" }, checkpoints: { p0Passed: true, p2Passed: true } });
    const context = {
      runTask,
      makeGateway: () => { throw new Error("video planning must not create a gateway"); },
      productionRuns: service,
      origin: { host: "codex" as const },
      generationPolicy,
      projectSession: makeProjectSession(authority, generationPolicy),
      generationPlanning: handler,
    };
    const harness = new McpJourneyHarness((method, params) => dispatch(method, params, context));
    await harness.call(21, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Codex" } });
    const created = await harness.call(22, "tools/call", {
      name: "nomi_operation_plan",
      arguments: {
        leaseHandle: lease,
        candidate: {
          candidateId: "video-editable",
          revision: 1,
          moduleId: "generation.single-shot",
          providerId: "video-provider",
          modelId: "video-model",
          mode: "image-to-video",
          prompt: "角色走向镜头",
          parameters: { duration: 5 },
          references: [{ assetId: "character", contentHash: "c".repeat(64), version: 1, kind: "image", role: "character" }],
        },
      },
    });
    const operationId = [...(await repository.list("project-1"))][0]?.runId;
    expect(created.result).toBeTruthy();
    expect(operationId).toMatch(/^op-/);

    const firstPreview = await harness.call(23, "tools/call", { name: "nomi_operation_preview", arguments: { leaseHandle: lease, operationId } });
    const firstPayload = JSON.parse((firstPreview.result as { content: Array<{ text: string }> }).content[0]!.text) as { recommendation: { recommendations: Array<{ modeId: string }> }; contract: { contractHash: string } };
    expect(firstPayload.recommendation.recommendations[0]?.modeId).toBe("omni");
    const firstHash = firstPayload.contract.contractHash;

    await harness.call(24, "tools/call", {
      name: "nomi_operation_plan",
      arguments: {
        leaseHandle: lease,
        operationId,
        patch: {
          mode: "firstlast",
          parameters: { duration: 8, trajectory: "orbit" },
          references: [
            { assetId: "first", contentHash: "f".repeat(64), version: 1, kind: "image", role: "first_frame" },
            { assetId: "last", contentHash: "l".repeat(64), version: 1, kind: "image", role: "last_frame" },
          ],
        },
      },
    });
    const secondPreview = await harness.call(25, "tools/call", { name: "nomi_operation_preview", arguments: { leaseHandle: lease, operationId } });
    const secondPayload = JSON.parse((secondPreview.result as { content: Array<{ text: string }> }).content[0]!.text) as { recommendation: { recommendations: Array<{ modeId: string }> }; contract: { contractHash: string; droppedFields: Array<{ path: string }> } };
    expect(secondPayload.recommendation.recommendations[0]?.modeId).toBe("firstlast");
    expect(secondPayload.contract.contractHash).not.toBe(firstHash);
    expect(secondPayload.contract.droppedFields).toEqual([{ path: "parameters.trajectory", reason: "unsupported_parameter" }]);
    expect(repository.read("project-1", operationId!).generationPlan).toMatchObject({ state: "draft", candidate: { revision: 2, mode: "firstlast" } });
    expect(runTask).not.toHaveBeenCalled();
  });

  it("walks the real GUI catalog profiles through model, mode, reference and parameter switches", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-mcp-generation-real-catalog-"));
    roots.push(root);
    const repository = createProductionRunRepository({ projectDirResolver: () => root, now: () => "2026-08-23T00:00:00.000Z" });
    const service = createProductionRunService({ repository, projectRootResolver: () => root, sleep: async () => {} });
    const operations = createProductionGenerationOperationStore(service);
    const runTask = vi.fn(async () => { throw new Error("real catalog planning must not call runTask"); });
    const handler = createGenerationPlanningHandler({
      registry: realCatalogVideoRegistry,
      operations,
      videoModelCandidates: realCatalogVideoModelCandidates,
      recommendVideoGeneration,
      now: () => "2026-08-23T00:00:00.000Z",
    });
    const authority = makeAuthority(root);
    const lease = (await makeLease(authority, ["context:read", "generation:create", "generation:plan", "generation:preview", "generation:read"])).token;
    const verifiedLease = await authority.verifyLease(lease, { connection });
    const generationPolicy = createMcpGenerationPolicy({ env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: "1" }, checkpoints: { p0Passed: true, p2Passed: true } });
    const context = {
      runTask,
      makeGateway: () => { throw new Error("real catalog planning must not create a gateway"); },
      productionRuns: service,
      origin: { host: "codex" as const },
      generationPolicy,
      projectSession: makeProjectSession(authority, generationPolicy),
      generationPlanning: handler,
    };
    const harness = new McpJourneyHarness((method, params) => dispatch(method, params, context));
    await harness.call(31, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Codex" } });
    const contextResponse = await harness.call(315, "tools/call", { name: "nomi_read", arguments: { target: "generation_context", leaseHandle: lease } });
    const contextPayload = JSON.parse((contextResponse.result as { content: Array<{ text: string }> }).content[0]!.text) as {
      videoModels?: Array<{
        modelId: string;
        archetypeId: string;
        modes: Array<{ id: string; parameters: Array<{ key: string; options?: Array<{ value: unknown }> }> }>;
        variants: Array<{ id: string; modelKey: string; modes: Array<{ id: string; parameters: Array<{ key: string; options?: Array<{ value: unknown }> }> }> }>;
      }>;
    };
    const seedanceContext = contextPayload.videoModels?.find((model) => model.modelId === "doubao-seedance-2.0");
    expect(seedanceContext).toMatchObject({ modelId: "doubao-seedance-2.0", archetypeId: "seedance-2-apimart" });
    expect(seedanceContext?.variants.map((variant) => variant.id)).toEqual(expect.arrayContaining(["standard", "fast", "mini"]));
    const resolutionOptions = (modes: Array<{ parameters: Array<{ key: string; options?: Array<{ value: unknown }> }> }>) => modes.find((mode) => mode.id === "omni")?.parameters.find((parameter) => parameter.key === "resolution")?.options?.map((option) => option.value);
    expect(resolutionOptions(seedanceContext?.modes ?? [])).toEqual(["480p", "720p", "1080p", "4k"]);
    expect(resolutionOptions(seedanceContext?.variants.find((variant) => variant.id === "standard")?.modes ?? [])).toEqual(["480p", "720p", "1080p", "4k"]);
    expect(resolutionOptions(seedanceContext?.variants.find((variant) => variant.id === "fast")?.modes ?? [])).toEqual(["480p", "720p"]);
    const created = await harness.call(32, "tools/call", {
      name: "nomi_operation_plan",
      arguments: {
        leaseHandle: lease,
        candidate: {
          candidateId: "real-catalog-video",
          revision: 1,
          moduleId: "generation.single-shot",
          providerId: "apimart",
          modelId: "doubao-seedance-2.0",
          variantId: "standard",
          mode: "image_to_video",
          prompt: "角色走向镜头",
          parameters: { duration: 5, resolution: "720p" },
          references: [{ assetId: "character", contentHash: "c".repeat(64), version: 1, kind: "image", role: "character" }],
        },
      },
    });
    const operationId = [...(await repository.list("project-1"))][0]?.runId;
    expect(created.result).toBeTruthy();
    expect(operationId).toMatch(/^op-/);

    const preview = async (id: number) => {
      const response = await harness.call(id, "tools/call", { name: "nomi_operation_preview", arguments: { leaseHandle: lease, operationId } });
      return JSON.parse((response.result as { content: Array<{ text: string }> }).content[0]!.text) as {
        recommendation?: { recommendations?: Array<{ modelKey: string; variantId?: string; modeId: string; params: Record<string, unknown> }> };
        contract: { providerId: string; modelId: string; variantId?: string; mode: string; contractHash: string };
      };
    };
    const seedance = await preview(33);
    expect(seedance.contract).toMatchObject({ providerId: "apimart", modelId: "doubao-seedance-2.0", variantId: "standard", mode: "image_to_video" });
    expect(seedance.recommendation?.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelKey: "doubao-seedance-2.0", variantId: "standard", modeId: "omni" }),
    ]));
    expect(seedance.recommendation?.recommendations?.every((item) => item.modelKey === "doubao-seedance-2.0" && item.variantId === "standard")).toBe(true);

    await harness.call(335, "tools/call", {
      name: "nomi_operation_plan",
      arguments: { leaseHandle: lease, operationId, patch: { variantId: "fast-face", parameters: { duration: 6, resolution: "720p" } } },
    });
    const seedanceFast = await preview(336);
    expect(seedanceFast.contract).toMatchObject({ modelId: "doubao-seedance-2.0", variantId: "fast" });
    expect(seedanceFast.recommendation?.recommendations?.every((item) => item.modelKey === "doubao-seedance-2.0" && item.variantId === "fast")).toBe(true);

    await harness.call(3365, "tools/call", {
      name: "nomi_operation_plan",
      arguments: { leaseHandle: lease, operationId, patch: { modelId: "doubao-seedance-2.0", parameters: { duration: 7, resolution: "720p" } } },
    });
    const sameModelFast = await preview(3366);
    expect(sameModelFast.contract).toMatchObject({ modelId: "doubao-seedance-2.0", variantId: "fast" });

    await expect(handler({ capability: "plan", params: { operationId, patch: { variantId: "ghost" } }, lease: verifiedLease }))
      .rejects.toThrow("Unknown video variant");
    await harness.call(337, "tools/call", {
      name: "nomi_operation_plan",
      arguments: { leaseHandle: lease, operationId, patch: { variantId: "fast", parameters: { duration: 6, resolution: "1080p" } } },
    });
    await expect(handler({ capability: "preview", params: { operationId }, lease: verifiedLease }))
      .rejects.toThrow("parameters.resolution");

    await harness.call(338, "tools/call", {
      name: "nomi_operation_plan",
      arguments: { leaseHandle: lease, operationId, patch: { variantId: "mini", parameters: { duration: 6, resolution: "720p" } } },
    });
    const seedanceMini = await preview(339);
    expect(seedanceMini.contract).toMatchObject({ modelId: "doubao-seedance-2.0", variantId: "mini" });
    expect(seedanceMini.recommendation?.recommendations?.every((item) => item.modelKey === "doubao-seedance-2.0" && item.variantId === "mini")).toBe(true);

    await harness.call(34, "tools/call", {
      name: "nomi_operation_plan",
      arguments: {
        leaseHandle: lease,
        operationId,
        patch: {
          modelId: "veo3.1-fast",
          mode: "image_to_video",
          parameters: { resolution: "720p" },
          references: [{ assetId: "style", contentHash: "s".repeat(64), version: 1, kind: "image", role: "reference" }],
        },
      },
    });
    const veo = await preview(35);
    expect(veo.recommendation?.recommendations?.every((item) => item.modelKey === "veo3.1-fast" && item.variantId === "fast")).toBe(true);
    expect(veo.recommendation?.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelKey: "veo3.1-fast", variantId: "fast", modeId: "reference" }),
    ]));
    expect(veo.contract).toMatchObject({ providerId: "apimart", modelId: "veo3.1-fast", variantId: "fast", mode: "image_to_video" });
    expect(veo.contract.contractHash).not.toBe(seedance.contract.contractHash);

    await harness.call(36, "tools/call", {
      name: "nomi_operation_plan",
      arguments: {
        leaseHandle: lease,
        operationId,
        patch: {
          modelId: "MiniMax-Hailuo-2.3",
          variantId: "standard",
          mode: "image_to_video",
          parameters: { duration: 6, resolution: "768p" },
          references: [{ assetId: "first", contentHash: "f".repeat(64), version: 1, kind: "image", role: "first_frame" }],
        },
      },
    });
    const hailuo = await preview(37);
    expect(hailuo.recommendation?.recommendations?.every((item) => item.modelKey === "MiniMax-Hailuo-2.3" && item.variantId === "standard")).toBe(true);
    expect(hailuo.recommendation?.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelKey: "MiniMax-Hailuo-2.3", variantId: "standard", modeId: "i2v" }),
    ]));
    expect(hailuo.recommendation?.recommendations?.[0]?.params).not.toHaveProperty("aspect_ratio");
    expect(hailuo.contract).toMatchObject({ providerId: "apimart", modelId: "MiniMax-Hailuo-2.3", variantId: "standard", mode: "image_to_video" });
    const hailuoContext = contextPayload.videoModels?.find((model) => model.modelId === "MiniMax-Hailuo-2.3");
    const hailuoDuration = hailuoContext?.modes.find((mode) => mode.id === "i2v")?.parameters.find((parameter) => parameter.key === "duration");
    expect(hailuoDuration?.options?.map((option) => option.value)).toEqual([6, 10]);
    expect(context.runTask).not.toHaveBeenCalled();
  });

  it("allows gate request for an observe-only provider and explains recovery limits", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-mcp-generation-degraded-"));
    roots.push(root);
    const repository = createProductionRunRepository({ projectDirResolver: () => root, now: () => "2026-08-23T00:00:00.000Z" });
    const service = createProductionRunService({ repository, projectRootResolver: () => root, sleep: async () => {} });
    const operations = createProductionGenerationOperationStore(service);
    const handler = createGenerationPlanningHandler({
      registry: degradedRegistry,
      operations,
      // Recovery capability is the subject of this test; a zero-cost catalog
      // row is still a known price and therefore may pass the paid gate.
      resolveModelPricing: () => ({ cost: 0, enabled: true, specCosts: [] }),
      now: () => "2026-08-23T00:00:00.000Z",
    });
    const authority = makeAuthority(root);
    const lease = (await makeLease(authority, ["generation:create", "generation:preview", "generation:gate"])).lease;
    const candidate = {
      candidateId: "candidate-degraded",
      revision: 1,
      moduleId: "generation.single-shot",
      providerId: "apimart",
      modelId: "gpt-image-2",
      mode: "text-to-image",
      prompt: "A red paper crane",
      parameters: { aspectRatio: "1:1" },
      references: [],
    };
    const created = await handler({ capability: "create", params: { candidate }, lease });
    const operationId = (created as { operation: { operationId: string } }).operation.operationId;
    const preview = await handler({ capability: "preview", params: { operationId }, lease }) as Record<string, unknown>;
    expect(preview.providerReady).toBe(true);
    expect(preview.providerCapabilityProfile).toBe("observe_only");
    expect(preview.recoveryNotice).toContain("核对");
    await expect(handler({ capability: "gate_request", params: { operationId }, lease })).resolves.toMatchObject({ nextAction: "confirm" });
  });
});
