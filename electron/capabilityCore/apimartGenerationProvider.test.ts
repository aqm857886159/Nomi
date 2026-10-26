import { describe, expect, it, vi } from "vitest";

import { createCatalogGenerationProvider as createProvider } from "./apimartGenerationProvider";
import type { CatalogState } from "../catalog/types";
import { APIMART_IMAGE_MODELS } from "../catalog/apimartImages";
import { APIMART_VIDEO_MODELS } from "../catalog/apimartVideos";
import { APIMART_IMAGE_QUERY_OP, APIMART_STATUS_MAPPING, APIMART_VENDOR_SEED, APIMART_VIDEO_QUERY_OP } from "../catalog/apimartVendor";
import { registerRequestTransform } from "../tasks/requestTransforms";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { readMaterializationOutputs } from "./apimartGenerationOutputs";
import { desktopT } from "../desktopStrings";

/** 授权时封存的那份 URL 快照，键就是付费卡上那一条参考的身份。 */
function approvedUrls(entries: ReadonlyArray<readonly [Record<string, unknown>, string]>): Record<string, string> {
  return Object.fromEntries(entries.map(([reference, url]) =>
    [spendReferenceKey(reference as Parameters<typeof spendReferenceKey>[0]), url]));
}

function catalogFixture(overrides: Partial<CatalogState> = {}): CatalogState {
  const now = "now";
  const models = [
    ...APIMART_IMAGE_MODELS.map((model) => ({
      modelKey: model.modelKey,
      vendorKey: "apimart" as const,
      labelZh: model.labelZh,
      kind: "image" as const,
      enabled: true,
      meta: { archetypeId: model.archetypeId },
      createdAt: now,
      updatedAt: now,
    })),
    ...APIMART_VIDEO_MODELS.map((model) => ({
      modelKey: model.modelKey,
      vendorKey: "apimart" as const,
      labelZh: model.labelZh,
      kind: "video" as const,
      enabled: true,
      meta: { archetypeId: model.archetypeId },
      createdAt: now,
      updatedAt: now,
    })),
  ];
  const mappings = [
    ...APIMART_IMAGE_MODELS.flatMap((model) => model.mappings.map((mapping) => ({
      ...mapping,
      vendorKey: "apimart" as const,
      modelKey: model.modelKey,
      enabled: true,
      query: APIMART_IMAGE_QUERY_OP,
      statusMapping: APIMART_STATUS_MAPPING,
      createdAt: now,
      updatedAt: now,
    }))),
    ...APIMART_VIDEO_MODELS.flatMap((model) => model.mappings.map((mapping) => ({
      ...mapping,
      vendorKey: "apimart" as const,
      modelKey: model.modelKey,
      enabled: true,
      query: APIMART_IMAGE_QUERY_OP,
      statusMapping: APIMART_STATUS_MAPPING,
      createdAt: now,
      updatedAt: now,
    }))),
  ];
  return {
    version: 11,
    vendors: [{
      key: "apimart",
      name: APIMART_VENDOR_SEED.name,
      enabled: true,
      baseUrlHint: APIMART_VENDOR_SEED.baseUrl,
      authType: APIMART_VENDOR_SEED.authType,
      authHeader: APIMART_VENDOR_SEED.authHeader,
      createdAt: "now",
      updatedAt: "now",
    }],
    models,
    mappings,
    apiKeysByVendor: {},
    ...overrides,
  };
}

function dualModeCatalogFixture(): CatalogState {
  const base = catalogFixture();
  const sharedModels: CatalogState["models"] = [
    { modelKey: "shared-model", vendorKey: "apimart", labelZh: "Shared", kind: "image", enabled: true, meta: { archetypeId: "shared", adapter: { state: "verified", activeRevision: "fixture", modes: [{ taskKind: "text_to_image", state: "verified" }] } }, createdAt: "now", updatedAt: "now" },
    { modelKey: "shared-model", vendorKey: "apimart", labelZh: "Shared", kind: "video", enabled: true, meta: { archetypeId: "shared", adapter: { state: "verified", activeRevision: "fixture", modes: [{ taskKind: "text_to_video", state: "verified" }] } }, createdAt: "now", updatedAt: "now" },
  ];
  const sharedMappings: CatalogState["mappings"] = [
    { id: "shared-image", vendorKey: "apimart", modelKey: "shared-model", taskKind: "text_to_image", name: "Shared image", enabled: true, create: { method: "POST", path: "/v1/images/generations", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}" }, response_mapping: { task_id: "data.0.task_id" } }, query: APIMART_IMAGE_QUERY_OP, createdAt: "now", updatedAt: "now" },
    { id: "shared-video", vendorKey: "apimart", modelKey: "shared-model", taskKind: "text_to_video", name: "Shared video", enabled: true, create: { method: "POST", path: "/v1/videos/generations", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}" }, response_mapping: { task_id: "data.0.task_id" } }, query: APIMART_IMAGE_QUERY_OP, createdAt: "now", updatedAt: "now" },
  ];
  return { ...base, models: sharedModels, mappings: sharedMappings };
}

/**
 * 一家**用户自己接的**供应商（非内置 direct-key）：`Authorization: Key <k>` 的方案词、
 * 自己的 base、自己的轮询路径。BL-1 的整条判据就是靠它证明「执行器与供应商无关」。
 */
function acmeCatalog(): CatalogState {
  const base = catalogFixture();
  return {
    ...base,
    vendors: [
      ...base.vendors,
      { key: "acme", name: "Acme", enabled: true, baseUrlHint: "https://acme.example", authType: "bearer", authHeader: "Authorization", authScheme: "Key", createdAt: "now", updatedAt: "now" },
    ],
    models: [
      ...base.models,
      { vendorKey: "acme", modelKey: "acme-image", kind: "image", enabled: true, labelZh: "Acme 图", createdAt: "now", updatedAt: "now" },
    ],
    mappings: [
      ...base.mappings,
      {
        id: "acme-text_to_image", vendorKey: "acme", modelKey: "acme-image", taskKind: "text_to_image",
        name: "Acme 文生图", enabled: true,
        create: { method: "POST", path: "/v2/jobs", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}" }, response_mapping: { task_id: "id" } },
        query: { method: "GET", path: "/v2/jobs/{{providerMeta.task_id}}", response_mapping: { status: "status" } },
        createdAt: "now", updatedAt: "now",
      },
    ],
    apiKeysByVendor: { ...base.apiKeysByVendor },
  } as CatalogState;
}

function createApimartGenerationProvider(options: Omit<Parameters<typeof createProvider>[0], "vendorKey"> & { vendorKey?: string; catalogReader?: () => CatalogState }) {
  return createProvider({ vendorKey: "apimart", catalogReader: () => catalogFixture(), ...options });
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: "generation.single-shot",
    providerId: "apimart",
    modelId: "gpt-image-2",
    mode: "text-to-image",
    prompt: "a red paper crane",
    parameters: { aspectRatio: "1:1", resolution: "1K" },
    references: [],
    contractHash: "a".repeat(64),
    idempotencyKey: "stable-nomi-key",
    requestFingerprint: "b".repeat(64),
    executionBinding: {
      immutableProjectUuid: "project-1",
      projectGeneration: 1,
      runId: "run-1",
      shotId: "shot-1",
      contractHash: "a".repeat(64),
      runtimeTaskId: "runtime-1",
      providerNamespace: "apimart",
      providerIdempotencyKey: "stable-nomi-key",
      requestFingerprint: "b".repeat(64),
      runtimeEnvelopeRef: ".nomi/runs/run-1/runtime.json",
      fencingEpoch: 1,
    },
    ...overrides,
  };
}

describe("APIMart observe-only generation provider", () => {
  it("rejects a certification-owned APIMart transport instead of forcing Bearer and canonical paths", () => {
    const base = catalogFixture();
    base.vendors[0] = {
      ...base.vendors[0]!,
      baseUrlHint: "https://certified.example/api",
      authType: "x-api-key",
      authHeader: "X-API-Key",
      meta: { adapter: { state: "verified", activeRevision: "certified-revision" } },
    };
    const fetchImpl = vi.fn();
    const provider = createProvider({ vendorKey: "apimart",
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => base,
      fetchImpl,
    });

    expect(() => provider.buildRequest(input())).toThrow("apimart certification-owned connection requires its certified transport");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when a request has no catalog-backed mapping", () => {
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key", baseUrl: "https://api.apimart.ai" }),
      catalogReader: () => catalogFixture({ mappings: [] }),
      fetchImpl: vi.fn(),
    } as Parameters<typeof createApimartGenerationProvider>[0] & { catalogReader: () => CatalogState });
    expect(() => provider.buildRequest(input())).toThrow("apimart catalog mapping is unavailable");
  });

  it("uses the catalog vendor endpoint and rejects a missing base URL", () => {
    const state = catalogFixture({
      vendors: [{ ...catalogFixture().vendors[0]!, baseUrlHint: undefined }],
    });
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key", baseUrl: "https://untrusted-connection.example" }),
      catalogReader: () => state,
      fetchImpl: vi.fn(),
    });
    expect(() => provider.buildRequest(input())).toThrow("apimart catalog vendor base URL is missing");
  });

  it("rejects a certification-owned endpoint even when its path could be normalized", () => {
    const base = catalogFixture({ vendors: [{ ...catalogFixture().vendors[0]!, baseUrlHint: "https://api.apimart.ai/v1", meta: { adapter: { state: "verified", activeRevision: "fixture" } } }] });
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => base,
      fetchImpl,
    });
    expect(() => provider.buildRequest(input())).toThrow("apimart certification-owned connection requires its certified transport");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // 2026-09-21（BL-1）：旧判据是「create path 必须是那两条 APIMart 串之一」——对任何别家都必假，
  // 所以它不是这里该守的不变量。守的是「这条 mapping 声明了路径」与「渲染出来的 origin
  // 还在用户保存的那个 base 上」（合同被改成把钱发去别的域名时当场拒）。
  it("rejects a catalog mapping that declares no create path", () => {
    const base = catalogFixture();
    const mappings = base.mappings.map((mapping) => mapping.modelKey === "gpt-image-2" && mapping.taskKind === "text_to_image"
      ? { ...mapping, create: { ...mapping.create, path: "" } }
      : mapping);
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => ({ ...base, mappings }),
      fetchImpl: vi.fn(),
    });
    expect(() => provider.buildRequest(input())).toThrow("has no create path");
  });

  it("发得出去的路径必须还在用户保存的那个域名上（合同被改成发去别处 → 当场拒）", async () => {
    const base = catalogFixture();
    const mappings = base.mappings.map((mapping) => mapping.modelKey === "gpt-image-2" && mapping.taskKind === "text_to_image"
      ? { ...mapping, create: { ...mapping.create, path: "https://evil.example/v1/images/generations", pathFrom: undefined } }
      : mapping);
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => ({ ...base, mappings }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const request = provider.buildRequest(input());
    await expect(provider.submit(structuredClone(request), "stable-key")).rejects.toThrow("off-origin");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects catalog identity drift between authorization and submission", async () => {
    const state = catalogFixture();
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => state,
      fetchImpl,
    });
    const request = provider.buildRequest(input());
    const mappingIndex = state.mappings.findIndex((mapping) => mapping.modelKey === "gpt-image-2" && mapping.taskKind === "text_to_image");
    state.mappings[mappingIndex] = {
      ...state.mappings[mappingIndex]!,
      create: { ...state.mappings[mappingIndex]!.create, defaultParams: { resolution: "2K" } },
    };
    await expect(provider.submit(structuredClone(request), "stable-key"))
      .rejects.toThrow("apimart catalog changed after authorization");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects extra-header drift between authorization and submission", async () => {
    const base = catalogFixture({
      vendors: [{
        ...catalogFixture().vendors[0]!,
        meta: { extraHeaders: { "X-Tenant": "tenant-a" } },
      }],
    });
    const fetchImpl = vi.fn();
    const provider = createProvider({ vendorKey: "apimart",
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => base,
      fetchImpl,
    });
    const request = provider.buildRequest(input());
    base.vendors[0] = { ...base.vendors[0]!, meta: { extraHeaders: { "X-Tenant": "tenant-b" } } };
    await expect(provider.submit(structuredClone(request), "stable-key"))
      .rejects.toThrow("apimart catalog changed after authorization");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // 2026-09-21（BL-1）：轮询路径不再有「唯一合法串」这回事——它由**这条 mapping 的 query op**
  // 声明。下面两条守的是新不变量：声明什么就问什么；一条都没声明时不谎称有轮询能力。
  it("轮询用的是这条 mapping 自己声明的 query op，不是某条写死的串（非内置家）", async () => {
    // 用户自己接的一家（非内置 direct-key）：端点、鉴权方案词、轮询路径全部来自他保存的那条连接
    // 与 mapping 声明。BL-1 之前这条路根本造不出 provider，更谈不上按声明去问。
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "task-9", status: "processing" }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = createProvider({
      vendorKey: "acme",
      resolveConnection: () => ({ apiKey: "acme-key" }),
      catalogReader: () => acmeCatalog(),
      initialState: acmeCatalog(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(provider.capabilities.query).toBe(true);
    await expect(provider.query?.("task-9")).resolves.toMatchObject({ status: "processing" });
    expect(fetchImpl).toHaveBeenCalledWith("https://acme.example/v2/jobs/task-9", expect.objectContaining({ method: "GET" }));
    // 方案词来自那条连接（`Key`），不是写死的 Bearer —— 这正是「key 是对的啊，画布能跑」那条。
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit] | undefined)?.[1]?.headers).toMatchObject({ Authorization: "Key acme-key" });
  });

  it("一条 query op 都没声明的家：不谎称有轮询能力，也问不出去", async () => {
    const base = catalogFixture();
    const mappings = base.mappings.map((mapping) => ({ ...mapping, query: undefined }));
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => ({ ...base, mappings }),
      initialState: { ...base, mappings },
      fetchImpl: vi.fn(),
    });
    expect(provider.capabilities.query).toBe(false);
    await expect(provider.query?.("task-1")).rejects.toThrow("without the model it was submitted with");
  });

  it("projects the sealed variant into curated mappings that declare archetype wire models", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(provider.buildRequest(input({
      modelId: "doubao-seedance-2.0",
      variantId: "fast",
      mode: "text_to_video",
      parameters: { duration: 5, size: "16:9", resolution: "720p" },
    }))).toMatchObject({ model: "seedance-2.0-fast", duration: 5 });
    expect(provider.buildRequest(input({ modelId: "doubao-seedance-2.0", mode: "text_to_video", parameters: {} })) )
      .toMatchObject({ model: "seedance-2.0-fast" });
  });

  it("fails closed when a catalog default accepts a reference but create.body drops it", () => {
    const base = catalogFixture();
    const mappings = base.mappings.map((mapping) => mapping.modelKey === "gpt-image-2" && mapping.taskKind === "text_to_image"
      ? { ...mapping, create: { ...mapping.create, defaultParams: { image_urls: ["https://cdn.example/orphan.png"] } } }
      : mapping);
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => ({ ...base, mappings }),
      fetchImpl: vi.fn(),
    });
    const reference = { assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" as const };
    expect(() => provider.buildRequest(input({
      references: [reference],
      referenceUrls: approvedUrls([[reference, "https://cdn.example/orphan.png"]]),
      // 2026-09-21（BL-1）：现在**更早**一步就被拦住了——引擎 A 那把共享尺子
      // （`imageEditGuardError` 的第三闸「这条 wire 的 body 读不读得到我带的参考」）
      // 在渲染之前就说了人话。两条判据说的是同一件事，留更早、更好读的那条；
      // `assertReferencesReachBody` 仍在渲染之后守着，是纵深防御不是重复判据。
    }))).toThrow("发不出：参考图");
  });

  it("maps a generic image contract to APIMart's flat image request", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(provider.buildRequest(input())).toEqual({
      model: "gpt-image-2",
      prompt: "a red paper crane",
      size: "1:1",
      resolution: "1k",
    });
    expect(provider.capabilities).toEqual({ submitIdempotency: false, query: true, reconcile: true, cancel: false, materialize: true });
  });

  it("keeps image aliases on their intended wire fields", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(provider.buildRequest(input({
      mode: "image_edit",
      parameters: {
        aspectRatio: "1:1",
        inputUrls: ["https://cdn.example/source.png"],
      },
    }))).toMatchObject({
      size: "1:1",
      image_urls: ["https://cdn.example/source.png"],
    });
  });

  it("submits with bearer auth and extracts data[0].task_id", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.apimart.ai/v1/images/generations");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ code: 200, data: [{ status: "submitted", task_id: "task-1" }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: fetchImpl as unknown as typeof fetch });
    const request = provider.buildRequest(input({ prompt: "x" }));
    await expect(provider.submit(structuredClone(request), "stable-key")).resolves.toMatchObject({ providerTaskId: "task-1" });
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("queries by task id and never sends the stable Nomi key as a false provider idempotency claim", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ code: 200, data: { id: "task-1", status: "processing" } }), { status: 200 }));
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.query?.("task-1")).resolves.toMatchObject({ status: "processing" });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.apimart.ai/v1/tasks/task-1", expect.objectContaining({ method: "GET" }));
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Idempotency-Key");
  });

  // 2026-09-25 用户报「Agent 付费卡生成的视频早就出好了，节点一直转圈」。真目录里图片与视频的轮询 op 不同
  // （结果路径 image_url / video_url），供应商实例又是每次读目录新建的——观察窗到期的重踢、重开项目、重启
  // 拿到的都是**没交过这笔任务**的新实例。它必须能靠调用方递来的模型 / 模式（Run 账本里冻着的那份）找到那条查询。
  it("a fresh provider instance polls a video task by the model identity the caller hands it (real image≠video query ops)", async () => {
    const realOps = (): CatalogState => {
      const base = catalogFixture();
      return { ...base, mappings: base.mappings.map((mapping) => mapping.taskKind.includes("video") ? { ...mapping, query: APIMART_VIDEO_QUERY_OP } : mapping) };
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { id: "video-task-1", status: "completed", result: { videos: [{ url: ["https://cdn.example/v.mp4"] }] } } }), { status: 200 }));
    const fresh = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: fetchImpl as unknown as typeof fetch, catalogReader: realOps });
    await expect(fresh.query?.("video-task-1")).rejects.toThrow("without the model it was submitted with");
    const polled = await fresh.query?.("video-task-1", { modelId: "kling-v3", mode: "text_to_video" });
    expect(polled).toMatchObject({ status: "completed" });
    await expect(fresh.materialize?.({ context: {}, providerTaskId: "video-task-1", raw: polled?.raw })).resolves.toMatchObject({ outputs: [{ kind: "video", url: "https://cdn.example/v.mp4" }] });
  });

  it("reconcile returns not-found without a task id and never invents one", async () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    await expect(provider.reconcile?.({ idempotencyKey: "stable-key" })).resolves.toEqual({ disposition: "indeterminate" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps an unknown provider status in manual reconciliation", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ code: 200, data: { id: "task-unknown", status: "mystery" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });

    await expect(provider.reconcile?.({ idempotencyKey: "stable-key", providerTaskId: "task-unknown" }))
      .resolves.toMatchObject({ disposition: "indeterminate", providerTaskId: "task-unknown" });
  });

  it("extracts provider-specific image/video output shapes without making a second request", async () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    // 一笔任务一种产物（#1213 起地址只有一种读法：先合同、再通用规则，不再把响应里出现的每种地址都捞走）。
    await expect(provider.materialize?.({ context: {},
      providerTaskId: "task-1",
      raw: { code: 200, data: { status: "completed", result: { images: [{ url: "https://cdn.example/image.png" }] } } },
    })).resolves.toMatchObject({ outputs: [
      { kind: "image", url: "https://cdn.example/image.png", providerOutputId: "image-1" },
    ] });
    await expect(provider.materialize?.({ context: {},
      providerTaskId: "task-2",
      raw: { code: 200, data: { status: "completed", result: { videos: [{ url: "https://cdn.example/video.mp4" }] } } },
    })).resolves.toMatchObject({ outputs: [
      { kind: "video", url: "https://cdn.example/video.mp4", providerOutputId: "video-1" },
    ] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("extracts the REAL Seedance video payload where videos[].url is an ARRAY of strings", async () => {
    // Live-captured 2026-08-25 (task_01M0VPQMBEN24HA665TM0KQZTS, S6.5 paid acceptance): the vendor
    // delivers `videos[0].url` as ["https://…"], not a plain string. The old extractor returned zero
    // outputs → adapter.materialize threw "no materializable output" on EVERY observe round, so a real
    // completed video never landed. Docs-shaped plain strings must keep working (previous test).
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    await expect(provider.materialize?.({ context: {},
      providerTaskId: "task-1",
      raw: {
        code: 200,
        data: {
          actual_time: 128, progress: 100, status: "completed",
          result: { videos: [{ url: ["https://cdn.example/real-video.mp4"], expires_at: 1787722735 }] },
        },
      },
    })).resolves.toMatchObject({ outputs: [
      { kind: "video", url: "https://cdn.example/real-video.mp4", providerOutputId: "video-1" },
    ] });
  });

  it("keeps a safe provider filename for data-url loopback materialization and drops path-shaped names", async () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    const result = await provider.materialize?.({ context: {},
      providerTaskId: "task-1",
      raw: {
        code: 200,
        data: {
          result: {
            videos: [
              { url: ["data:video/mp4;base64,AAAA"], filename: "fixture-loopback.mp4" },
              { url: ["data:video/mp4;base64,BBBB"], fileName: "/tmp/should-not-leak.mp4" },
            ],
          },
        },
      },
    });
    expect(result?.outputs[0]).toMatchObject({ kind: "video", fileName: "fixture-loopback.mp4" });
    expect(result?.outputs[1]).not.toHaveProperty("fileName");
  });

  it("recognizes a direct video_url array returned by a loopback provider", async () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    const result = await provider.materialize?.({ context: {},
      providerTaskId: "task-direct",
      raw: { data: { result: { video_url: ["data:video/mp4;base64,AAAA"], fileName: "direct.mp4" } } },
    });
    expect(result?.outputs).toEqual([{ kind: "video", url: "data:video/mp4;base64,AAAA", fileName: "direct.mp4", providerOutputId: "video-1" }]);
  });

  it("maps a semantic text-to-video contract to APIMart's flat video body", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(provider.buildRequest(input({
      modelId: "kling-3.0-turbo",
      mode: "text-to-video",
      parameters: {
        aspectRatio: "16:9",
        duration: 5,
        resolution: "720p",
      },
    }))).toEqual({
      model: "kling-3.0-turbo",
      prompt: "a red paper crane",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "16:9",
    });
  });

  it("maps image-to-video reference aliases without leaking image-only fields", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(provider.buildRequest(input({
      modelId: "doubao-seedance-2.0",
      mode: "image_to_video",
      parameters: {
        size: "16:9",
        durationSeconds: 5,
        resolution: "720p",
        imageUrls: ["https://cdn.example/character.png"],
        videoUrls: ["https://cdn.example/motion.mp4"],
        audioUrls: ["https://cdn.example/voice.wav"],
        imageWithRoles: [{ url: "https://cdn.example/character.png", role: "reference_image" }],
      },
    }))).toEqual({
      model: "seedance-2.0-fast",
      prompt: "a red paper crane",
      duration: 5,
      resolution: "720p",
      size: "16:9",
      generate_audio: true,
      image_urls: ["https://cdn.example/character.png"],
      image_with_roles: [{ url: "https://cdn.example/character.png", role: "reference_image" }],
      video_urls: ["https://cdn.example/motion.mp4"],
      audio_urls: ["https://cdn.example/voice.wav"],
    });
  });

  it("keeps MiniMax H3 frame inputs out of its mutually exclusive reference array", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    const body = provider.buildRequest(input({
      modelId: "MiniMax-H3",
      mode: "image_to_video",
      parameters: {
        duration: 5,
        resolution: "768p",
        firstFrameUrl: "https://cdn.example/first.png",
        lastFrameUrl: "https://cdn.example/last.png",
      },
    }));
    expect(body).toMatchObject({
      first_frame_image: "https://cdn.example/first.png",
      last_frame_image: "https://cdn.example/last.png",
    });
    expect(body).not.toHaveProperty("image_urls");
    expect(body).not.toHaveProperty("video_urls");
    expect(body).not.toHaveProperty("audio_urls");
  });

  it("applies the catalog-declared MiniMax H3 transform during synchronous semantic preflight", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    const body = provider.buildRequest(input({
      modelId: "MiniMax-H3",
      mode: "image_to_video",
      parameters: {
        duration: 5,
        resolution: "768p",
        aspectRatio: "16:9",
        firstFrameUrl: "https://cdn.example/first.png",
        webhook: "",
      },
    }));
    expect(body).toMatchObject({
      first_frame_image: "https://cdn.example/first.png",
      duration: 5,
      resolution: "768p",
    });
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(body).not.toHaveProperty("webhook");
  });

  it("enforces MiniMax H3 frame/reference mutual exclusion before approval", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({
      modelId: "MiniMax-H3",
      mode: "image_to_video",
      parameters: {
        firstFrameUrl: "https://cdn.example/first.png",
        imageUrls: ["https://cdn.example/reference.png"],
      },
    }))).toThrow(/首尾帧.*参考素材/);
  });

  it("revalidates and reapplies MiniMax H3 normalization on contextual submit", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.first_frame_image).toBe("https://cdn.example/first.png");
      expect(body).not.toHaveProperty("aspect_ratio");
      return new Response(JSON.stringify({ code: 200, data: [{ task_id: "h3-task" }] }), { status: 200 });
    });
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: fetchImpl as unknown as typeof fetch });
    const requestInput = input({
      modelId: "MiniMax-H3",
      mode: "image_to_video",
      parameters: {
        duration: 5,
        resolution: "768p",
        aspectRatio: "16:9",
        firstFrameUrl: "https://cdn.example/first.png",
      },
    });
    const body = provider.buildRequest(requestInput);
    const contextual = (provider as typeof provider & {
      submitWithContext: (request: unknown, idempotencyKey: string, semanticInput: ReturnType<typeof input>) => Promise<unknown>;
    }).submitWithContext;
    await expect(contextual(structuredClone(body), "h3-key", requestInput)).resolves.toMatchObject({ providerTaskId: "h3-task" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a catalog transform is asynchronous and cannot run in preflight", () => {
    registerRequestTransform("test-apimart-async-transform", async (body) => body, async () => undefined);
    const base = catalogFixture();
    const mappings = base.mappings.map((mapping) => mapping.modelKey === "MiniMax-H3" && mapping.taskKind === "image_to_video"
      ? { ...mapping, create: { ...mapping.create, request_transform: "test-apimart-async-transform" } }
      : mapping);
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => ({ ...base, mappings }),
      fetchImpl: vi.fn(),
    });
    // The registry is deliberately exercised through the same public hook as
    // production, while the provider must refuse an async transform at the
    // synchronous approval boundary.
    expect(() => provider.buildRequest(input({
      modelId: "MiniMax-H3",
      mode: "image_to_video",
      parameters: { firstFrameUrl: "https://cdn.example/first.png" },
    }))).toThrow(/同步|synchronous/i);
  });

  it("does not let a non-idempotent transform mutate the approved payload at submit", async () => {
    let calls = 0;
    registerRequestTransform("test-apimart-nondeterministic-transform", (body) => ({
      ...(body as Record<string, unknown>),
      nonce: ++calls,
    }));
    const base = catalogFixture();
    const mappings = base.mappings.map((mapping) => mapping.modelKey === "MiniMax-H3" && mapping.taskKind === "image_to_video"
      ? { ...mapping, create: { ...mapping.create, request_transform: "test-apimart-nondeterministic-transform" } }
      : mapping);
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => ({ ...base, mappings }),
      fetchImpl,
    });
    const request = provider.buildRequest(input({
      modelId: "MiniMax-H3",
      mode: "image_to_video",
      parameters: { firstFrameUrl: "https://cdn.example/first.png" },
    }));
    await expect(provider.submit(structuredClone(request), "stable-key"))
      .rejects.toThrow("changed the approved payload");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects conflicting snake-case frame aliases before rendering", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({
      modelId: "MiniMax-H3",
      mode: "image_to_video",
      parameters: {
        first_frame_image: "https://cdn.example/first-a.png",
        first_frame_url: "https://cdn.example/first-b.png",
      },
    }))).toThrow("catalog reference URL projection conflicts with canonical parameters");
  });

  it("honors an explicit catalog drop instead of guessing a replacement wire field", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    const body = provider.buildRequest(input({
      modelId: "kling-v3",
      mode: "image_to_video",
      parameters: { aspectRatio: "16:9", duration: 4, imageUrls: ["https://cdn.example/frame.png"] },
    }));
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(body).toMatchObject({ duration: 4, image_urls: ["https://cdn.example/frame.png"] });
  });

  it("submits semantic video payloads to /v1/videos/generations after the authorization clone", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.apimart.ai/v1/videos/generations");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "kling-3.0-turbo", duration: 4, aspect_ratio: "16:9" });
      return new Response(JSON.stringify({ code: 200, data: [{ status: "submitted", task_id: "video-task-1" }] }), { status: 200 });
    });
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: fetchImpl as unknown as typeof fetch });
    const request = provider.buildRequest(input({ modelId: "kling-3.0-turbo", mode: "text_to_video", parameters: { duration: 4, aspect_ratio: "16:9" } }));
    // Runtime Adapter passes a structuredClone of the prepared request.  A
    // deep clone must still select the video endpoint from the local hash map.
    await expect(provider.submit(structuredClone(request), "stable-key")).resolves.toMatchObject({ providerTaskId: "video-task-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of forwarding an unknown semantic video parameter", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({ modelId: "kling-3.0-turbo", mode: "text-to-video", parameters: { duration: 4, mysteryKnob: true } })))
      .toThrow("catalog generation parameter is unsupported: mysteryKnob");
  });

  it("fails closed for direct submit calls that bypass catalog preparation", async () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    await expect(provider.submit({ model: "video-model-v1", prompt: "a cat", duration: 3 }, "stable-key"))
      .rejects.toThrow("apimart sealed catalog identity is missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // 2026-09-29（A10b）：「这条连接归不归认证管」收成一份判据（catalog/certificationOwnership）。
  // 用户自己加的一行带认证标记只管它自己，不再让整条连接翻成认证连接。这份夹具里那一行之外连一个
  // 内置目录模型都没有，于是照旧在付费前拒掉——拒因从「认证连接」换成「代码拥有的契约不在了」。
  it("still rejects a user-added certified row before a contextual submit when the built-in contract is gone", () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: dualModeCatalogFixture,
      fetchImpl,
    });
    expect(() => provider.buildRequest(input({ modelId: "shared-model", mode: "text-to-image", parameters: {} })))
      .toThrow("apimart catalog direct-key contract is unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // 内置目录里的模型带了标记 = 代码拥有的契约被认证接管：整条连接归认证，连没带标记的
  // gpt-image-2 也不许这个执行器接管，付费前就拒。
  it("rejects the whole connection once a built-in catalog model carries a certification mark", () => {
    const fetchImpl = vi.fn();
    const base = catalogFixture();
    base.models = base.models.map((model) => model.modelKey === "viduq3"
      ? { ...model, meta: { ...(model.meta as Record<string, unknown>), adapter: { state: "failed", modes: [] } } }
      : model);
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), catalogReader: () => base, fetchImpl });
    expect(() => provider.buildRequest(input()))
      .toThrow("apimart certification-owned connection requires its certified transport");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an unknown semantic mode instead of defaulting to image submission", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({ mode: "mystery-output", parameters: {} })))
      .toThrow("apimart generation mode is unsupported: mystery-output");
  });

  it("keeps canonical image-to-video references in the real APIMart body and endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.apimart.ai/v1/videos/generations");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.image_urls).toEqual(["https://cdn.example/character.png"]);
      return new Response(JSON.stringify({ code: 200, data: [{ status: "submitted", task_id: "i2v-task-1" }] }), { status: 200 });
    });
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: fetchImpl as unknown as typeof fetch });
    const request = provider.buildRequest(input({
      modelId: "kling-v3",
      mode: "image_to_video",
      references: [{ assetId: "asset-character", contentHash: "c".repeat(64), version: 1, kind: "image", role: "character" }],
      parameters: { duration: 4, imageUrls: ["https://cdn.example/character.png"] },
    }));
    const contextual = (provider as typeof provider & {
      submitWithContext: (request: unknown, idempotencyKey: string, semanticInput: ReturnType<typeof input>) => Promise<unknown>;
    }).submitWithContext;
    await expect(contextual(structuredClone(request), "stable-key", input({
      modelId: "kling-v3",
      mode: "image_to_video",
      references: [{ assetId: "asset-character", contentHash: "c".repeat(64), version: 1, kind: "image", role: "character" }],
      parameters: { duration: 4, imageUrls: ["https://cdn.example/character.png"] },
    }))).resolves.toMatchObject({ providerTaskId: "i2v-task-1" });
  });

  it("projects the approved reference snapshot into the body's image channel", () => {
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      fetchImpl: vi.fn(),
    });
    const references = [{ assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" as const, role: "reference" as const }];
    expect(provider.buildRequest(input({ modelId: "kling-v3", mode: "image_to_video", references,
      referenceUrls: approvedUrls([[references[0], "https://cdn.example/asset-1.png"]]),
      parameters: { duration: 3 } }))).toMatchObject({
      image_urls: ["https://cdn.example/asset-1.png"],
      duration: 3,
    });
  });

  // 0.23.1 用户报的形状：Windows 文件名带空格的参考图走 MiniMax H3 图生视频。参数层把参考链接换成
  // 序列化后的写法；批准时与提交时两次构建一致，最后一道「参考到没到请求体」两边按同一个序列化比。
  it("带空格的已批准参考：请求体和真正发出的报文都是序列化后的写法，不被当成「被丢了」", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(init?.body)).not.toContain("Windows ref.png");
      expect(JSON.parse(String(init?.body))).toMatchObject({ image_urls: ["https://cdn.example/Windows%20ref.png"] });
      return new Response(JSON.stringify({ code: 200, data: [{ task_id: "h3-ref-task" }] }), { status: 200 });
    });
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: fetchImpl as unknown as typeof fetch });
    const reference = { assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" as const, role: "reference" as const };
    const requestInput = input({
      modelId: "MiniMax-H3",
      mode: "image_to_video",
      references: [reference],
      referenceUrls: approvedUrls([[reference, "https://cdn.example/Windows ref.png"]]),
      parameters: { duration: 5, resolution: "768p" },
    });
    const body = provider.buildRequest(requestInput);
    expect(body).toMatchObject({ image_urls: ["https://cdn.example/Windows%20ref.png"] });
    const contextual = (provider as typeof provider & {
      submitWithContext: (request: unknown, idempotencyKey: string, semanticInput: ReturnType<typeof input>) => Promise<unknown>;
    }).submitWithContext;
    await expect(contextual(structuredClone(body), "h3-ref-key", requestInput)).resolves.toMatchObject({ providerTaskId: "h3-ref-task" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not serialize unused reference channels as optional APIMart fields", () => {
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      fetchImpl: vi.fn(),
    });
    const reference = { assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" as const };
    const body = provider.buildRequest(input({
      modelId: "doubao-seedance-2.0",
      mode: "image_to_video",
      references: [reference],
      referenceUrls: approvedUrls([[reference, "https://cdn.example/character.png"]]),
      parameters: { duration: 3 },
    }));
    // 2026-09-21 更正（NEW-1）：这条 mapping 的 body **同时**声明 image_urls 与 image_with_roles
    // （官方互斥，由档案模式区分）。旧口径「通道由 mapping 决定」在这里答不出来，于是无条件选了
    // image_with_roles——手动路同一张图走的却是 image_urls。没有 modeId = 没有模式 = 扁平族键。
    expect(body).toMatchObject({ image_urls: ["https://cdn.example/character.png"] });
    expect(body).not.toHaveProperty("image_with_roles");
    expect(body).not.toHaveProperty("video_urls");
    expect(body).not.toHaveProperty("audio_urls");
  });

  it("首尾帧模式声明了合并槽 → 同一条 mapping 改走 image_with_roles（通道由档案模式决定）", () => {
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      fetchImpl: vi.fn(),
    });
    const reference = { assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" as const, role: "first_frame" as const };
    const body = provider.buildRequest(input({
      modelId: "doubao-seedance-2.0",
      mode: "image_to_video",
      modeId: "firstlast",
      references: [reference],
      referenceUrls: approvedUrls([[reference, "https://cdn.example/character.png"]]),
      parameters: { duration: 3 },
    }));
    expect(body).toMatchObject({ image_with_roles: [{ url: "https://cdn.example/character.png", role: "first_frame" }] });
    expect(body).not.toHaveProperty("image_urls");
  });

  it("fails closed when references have no resolved provider URL", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({
      modelId: "kling-v3",
      mode: "image_to_video",
      references: [{ assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" }],
      parameters: { duration: 3 },
    }))).toThrow("catalog references must be resolved to provider URLs before submission");
  });

  it("fails closed when fewer resolved URLs than references survive canonical projection", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({
      modelId: "kling-v3",
      mode: "image_to_video",
      // One typed image plus one legacy reference without a kind: both must
      // resolve independently; sharing one URL must not pass the final gate.
      references: [
        { assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" },
        { assetId: "asset-2", contentHash: "b".repeat(64), version: 1 },
      ],
      parameters: { duration: 3, imageUrls: ["https://cdn.example/only-one.png"] },
    }))).toThrow("catalog references must be resolved to provider URLs before submission");
  });

  it("rejects local-only reference URLs instead of sending an unreachable paid request", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({
      modelId: "kling-v3",
      mode: "image_to_video",
      references: [{ assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" }],
      parameters: { duration: 3, imageUrls: ["nomi-local://project/assets/asset-1.png"] },
    }))).toThrow("catalog references must be resolved to provider URLs before submission");
  });

  // 批准的是 A、要发出去的是 B —— 在花钱这条轴上这件事不许悄悄发生。
  it("rejects an approved reference snapshot that conflicts with an explicit canonical URL", () => {
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      fetchImpl: vi.fn(),
    });
    const reference = { assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" as const };
    expect(() => provider.buildRequest(input({
      modelId: "kling-v3",
      mode: "image_to_video",
      references: [reference],
      referenceUrls: approvedUrls([[reference, "https://cdn.example/from-approval.png"]]),
      parameters: { duration: 3, imageUrls: ["https://cdn.example/explicit.png"] },
    }))).toThrow("catalog reference URL projection conflicts with canonical parameters");
  });

  it("blocks direct submission when a caller bypasses buildRequest with a local-only URL", async () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    await expect(provider.submit({
      model: "kling-v3",
      prompt: "a cat",
      image_urls: ["file:///Users/me/character.png"],
    }, "stable-key")).rejects.toThrow("apimart sealed catalog identity is missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on an unsupported direct-submit body field", async () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    await expect(provider.submit({ model: "kling-v3", prompt: "a cat", duration: 3, mysteryKnob: true }, "stable-key"))
      .rejects.toThrow("apimart sealed catalog identity is missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts typed image, video, and audio references only when each channel is projected", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(provider.buildRequest(input({
      modelId: "doubao-seedance-2.0",
      mode: "image_to_video",
      references: [
        { assetId: "image", contentHash: "i".repeat(64), version: 1, kind: "image" },
        { assetId: "video", contentHash: "v".repeat(64), version: 1, kind: "video" },
        { assetId: "audio", contentHash: "u".repeat(64), version: 1, kind: "audio" },
      ],
      parameters: {
        imageUrls: ["https://cdn.example/image.png"],
        videoUrls: ["https://cdn.example/video.mp4"],
        audioUrls: ["https://cdn.example/audio.wav"],
      },
    }))).toMatchObject({
      image_urls: ["https://cdn.example/image.png"],
      video_urls: ["https://cdn.example/video.mp4"],
      audio_urls: ["https://cdn.example/audio.wav"],
    });
  });
});

// V-1213 复验阻断：合同字段（query response_mapping 的 video_url）回显的是本次请求里的参考图，引擎 B 曾把它当产物落盘成 PNG。
// 用例取自验收线复现（vendor / 模型 / 合同形状照抄）；改前前三条红、改后绿。
describe("引擎 B 取产物：合同字段回显的参考图不当产物（V-1213）", () => {
  const REF = "https://fixture.invalid/reference.png";
  // 签名地址常没有扩展名：类型那道筛判不了，只剩「认得出回显」这一道——单独钉住它。
  const BARE_REF = "https://fixture.invalid/signed-reference";
  const VIDEO = "https://fixture.invalid/paid-result.mp4";
  function echoContractProvider() {
    const state = catalogFixture();
    state.vendors.forEach((vendor) => { vendor.key = "v1213"; });
    state.models.forEach((model) => { model.vendorKey = "v1213"; });
    for (const mapping of state.mappings) {
      mapping.vendorKey = "v1213";
      mapping.query = { method: "GET", path: "/v1/tasks/{{providerMeta.task_id}}", response_mapping: { status: "status", video_url: "output" } };
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: [{ status: "submitted", task_id: "echo-task" }] }), { status: 200 }));
    return createProvider({ vendorKey: "v1213", catalogReader: () => state, resolveConnection: () => ({ apiKey: "synthetic" }), fetchImpl: fetchImpl as unknown as typeof fetch });
  }
  const semantic = (imageUrls: string[]) => input({
    providerId: "v1213", modelId: "kling-v3", mode: "image_to_video",
    references: [{ assetId: "synthetic-ref", contentHash: "c".repeat(64), version: 1, kind: "image", role: "character" }],
    parameters: { duration: 4, imageUrls },
  });
  const context = (imageUrls: string[]) => ({ modelId: "kling-v3", mode: "image_to_video", parameters: { duration: 4, imageUrls } });

  it.each([REF, BARE_REF])("同一进程提交过：提交时发出去的参考地址被记住，合同位置回显它 → 不落产物（%s）", async (ref) => {
    const provider = echoContractProvider();
    const request = semantic([ref]);
    const contextual = (provider as typeof provider & {
      submitWithContext: (request: unknown, idempotencyKey: string, semanticInput: ReturnType<typeof input>) => Promise<unknown>;
    }).submitWithContext;
    await contextual(provider.buildRequest(request), "synthetic-key", request);
    const result = await provider.materialize!({ context: {}, providerTaskId: "echo-task", raw: { status: "success", output: ref } });
    expect(result.outputs).toEqual([]);
  });

  it.each([REF, BARE_REF])("重启后（内存里没有这笔）：凭账本冻结合同的上下文认出回显 → 不落产物（%s）", async (ref) => {
    const result = await echoContractProvider().materialize!({ providerTaskId: "echo-task", raw: { status: "success", output: ref }, context: context([ref]) });
    expect(result.outputs).toEqual([]);
  });

  // 第二个形状照验收线「错误 PNG 落盘」复现：合同位置给 data:image/png，曾被定成 image 落进项目。
  it.each([REF, "data:image/png;base64,iVBORw0KGgo="])("参考地址对不上（授权快照换过 URL）：视频任务的合同位置给图片，按类型也不收（%s）", async (imageUrl) => {
    const result = await echoContractProvider().materialize!({ providerTaskId: "echo-task", raw: { status: "success", output: imageUrl }, context: context([]) });
    expect(result.outputs).toEqual([]);
  });

  it("对照：合同位置是真视频照常取回；看不出扩展名的地址按任务定种类为 video", async () => {
    const provider = echoContractProvider();
    const mp4 = await provider.materialize!({ providerTaskId: "echo-task", raw: { status: "success", output: VIDEO }, context: context([REF]) });
    expect(mp4.outputs.map((output) => ({ url: output.url, kind: output.kind }))).toEqual([{ url: VIDEO, kind: "video" }]);
    const bare = await provider.materialize!({ providerTaskId: "echo-task", raw: { status: "success", output: "https://fixture.invalid/signed-result" }, context: context([REF]) });
    expect(bare.outputs.map((output) => output.kind)).toEqual(["video"]);
  });

  it("种类跟着任务走：音频任务的合同位置给 .mp4 容器 → 收下且种类是 audio，不按扩展名改判成 video", () => {
    const outputs = readMaterializationOutputs({ status: "success", output: "https://fixture.invalid/voice.mp4" }, { responseMapping: { audio_url: "output" } }, "audio", new Set());
    expect(outputs.map((output) => ({ url: output.url, kind: output.kind }))).toEqual([{ url: "https://fixture.invalid/voice.mp4", kind: "audio" }]);
  });
});

// 2026-10-27：引擎 B 的第一闸（applyHeadlessParamDefaults）收的是与清单、第三闸、引擎 A 同一个 helper 产出的完整身份。
// 以前这里只递 archetypeId，自写能力合同（customCapabilityContract）声明的参考上限进不了第一闸；拒发时还被改写成
// 一句笼统的「catalog mapping defaults are invalid」。出网用的是注入的 fetchImpl（进程内记账，不出网、不花钱）。
describe("引擎 B 第一闸：自写能力合同的参考上限在出网前拒（与引擎 A 同一句）", () => {
  const customCapabilityContract = {
    version: 1,
    kind: "video",
    defaultModeId: "references",
    transportTaskKind: "image_to_video",
    modes: [{
      id: "references", intent: "character", vendorTerm: "Multi reference", hint: "One to eight ordered reference images",
      promptRequired: true, transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "Reference images", min: 1, max: 8, inputKey: "image_urls", asArray: true }],
      params: [],
    }],
  };
  function customRelayCatalog(): CatalogState {
    const base = catalogFixture();
    return {
      ...base,
      vendors: [...base.vendors,
        { key: "custom-relay", name: "Custom relay", enabled: true, baseUrlHint: "https://relay.example", authType: "bearer", createdAt: "now", updatedAt: "now" }],
      models: [...base.models,
        { vendorKey: "custom-relay", modelKey: "custom-video-v1", kind: "video", enabled: true, labelZh: "Custom video", meta: { customCapabilityContract }, createdAt: "now", updatedAt: "now" }],
      mappings: [...base.mappings, {
        id: "custom-relay-image_to_video", vendorKey: "custom-relay", modelKey: "custom-video-v1", taskKind: "image_to_video",
        name: "Custom references", enabled: true,
        create: { method: "POST", path: "/v1/videos", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", image_urls: "{{request.params.image_urls}}" }, response_mapping: { task_id: "id" } },
        query: { method: "GET", path: "/v1/videos/{{providerMeta.task_id}}", response_mapping: { status: "status" } },
        createdAt: "now", updatedAt: "now",
      }],
    } as CatalogState;
  }
  const referencesOf = (count: number) => Array.from({ length: count }, (_, index) =>
    ({ assetId: `asset-${index + 1}`, contentHash: String(index + 1).padStart(64, "0"), version: 1, kind: "image" as const, role: "reference" as const }));
  const requestWith = (count: number) => {
    const references = referencesOf(count);
    return input({
      providerId: "custom-relay", modelId: "custom-video-v1", mode: "image_to_video", parameters: {},
      references, referenceUrls: approvedUrls(references.map((reference, index) => [reference, `https://cdn.example/reference-${index + 1}.png`] as const)),
    });
  };
  const providerWith = (fetchImpl: ReturnType<typeof vi.fn>) => createProvider({
    vendorKey: "custom-relay", resolveConnection: () => ({ apiKey: "relay-key" }),
    catalogReader: () => customRelayCatalog(), initialState: customRelayCatalog(), fetchImpl: fetchImpl as unknown as typeof fetch,
  });

  it("9 张参考：buildRequest 以「这个模型最多收 8张图片参考。」拒，不被改写成 defaults invalid，一次都没发", () => {
    const fetchImpl = vi.fn();
    const provider = providerWith(fetchImpl);
    let message = "";
    try {
      provider.buildRequest(requestWith(9));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(desktopT("modelConstraints.imageReferenceCapacity", { max: 8 }));
    expect(message).not.toContain("defaults are invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("阳性对照：8 张照常投进 image_urls 并提交一次", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((JSON.parse(String(init?.body)) as { image_urls?: unknown[] }).image_urls).toHaveLength(8);
      return new Response(JSON.stringify({ id: "relay-task-1" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = providerWith(fetchImpl);
    const requestInput = requestWith(8);
    const body = provider.buildRequest(requestInput);
    expect((body as { image_urls?: unknown[] }).image_urls).toHaveLength(8);
    const contextual = (provider as typeof provider & {
      submitWithContext: (request: unknown, idempotencyKey: string, semanticInput: ReturnType<typeof input>) => Promise<unknown>;
    }).submitWithContext;
    await expect(contextual(structuredClone(body), "relay-key-1", requestInput)).resolves.toMatchObject({ providerTaskId: "relay-task-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
