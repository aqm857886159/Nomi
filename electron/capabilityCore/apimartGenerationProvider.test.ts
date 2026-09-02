import { describe, expect, it, vi } from "vitest";

import { createApimartGenerationProvider as createProvider } from "./apimartGenerationProvider";
import type { ApimartReferenceUrlResolver } from "./apimartGenerationProjection";
import type { CatalogState } from "../catalog/types";
import { APIMART_IMAGE_MODELS } from "../catalog/apimartImages";
import { APIMART_VIDEO_MODELS } from "../catalog/apimartVideos";
import { APIMART_IMAGE_QUERY_OP, APIMART_STATUS_MAPPING, APIMART_VENDOR_SEED } from "../catalog/apimartVendor";
import { registerRequestTransform } from "../tasks/requestTransforms";

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

function createApimartGenerationProvider(options: Parameters<typeof createProvider>[0] & { catalogReader?: () => CatalogState }) {
  return createProvider({ catalogReader: () => catalogFixture(), ...options });
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
    const provider = createProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => base,
      fetchImpl,
    });

    expect(() => provider.buildRequest(input())).toThrow("APIMart certification-owned connection requires its certified transport");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when a request has no catalog-backed mapping", () => {
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key", baseUrl: "https://api.apimart.ai" }),
      catalogReader: () => catalogFixture({ mappings: [] }),
      fetchImpl: vi.fn(),
    } as Parameters<typeof createApimartGenerationProvider>[0] & { catalogReader: () => CatalogState });
    expect(() => provider.buildRequest(input())).toThrow("APIMart catalog mapping is unavailable");
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
    expect(() => provider.buildRequest(input())).toThrow("APIMart catalog vendor base URL is missing");
  });

  it("rejects a certification-owned endpoint even when its path could be normalized", () => {
    const base = catalogFixture({ vendors: [{ ...catalogFixture().vendors[0]!, baseUrlHint: "https://api.apimart.ai/v1", meta: { adapter: { state: "verified", activeRevision: "fixture" } } }] });
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => base,
      fetchImpl,
    });
    expect(() => provider.buildRequest(input())).toThrow("APIMart certification-owned connection requires its certified transport");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an endpoint that is not declared by the APIMart catalog mapping", () => {
    const base = catalogFixture();
    const mappings = base.mappings.map((mapping) => mapping.modelKey === "gpt-image-2" && mapping.taskKind === "text_to_image"
      ? { ...mapping, create: { ...mapping.create, path: "/v1/guess" } }
      : mapping);
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => ({ ...base, mappings }),
      fetchImpl: vi.fn(),
    });
    expect(() => provider.buildRequest(input())).toThrow("has an unsupported create path");
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
      .rejects.toThrow("APIMart catalog changed after authorization");
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
    const provider = createProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => base,
      fetchImpl,
    });
    const request = provider.buildRequest(input());
    base.vendors[0] = { ...base.vendors[0]!, meta: { extraHeaders: { "X-Tenant": "tenant-b" } } };
    await expect(provider.submit(structuredClone(request), "stable-key"))
      .rejects.toThrow("APIMart catalog changed after authorization");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-canonical query mapping before any paid request", () => {
    const base = catalogFixture();
    const mappings = base.mappings.map((mapping) => mapping.modelKey === "gpt-image-2" && mapping.taskKind === "text_to_image"
      ? { ...mapping, query: { ...mapping.query!, path: "/v1/tasks/{{providerMeta.id}}" } }
      : mapping);
    const provider = createProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => ({ ...base, mappings }),
      fetchImpl: vi.fn(),
    });
    expect(() => provider.buildRequest(input())).toThrow("unsupported query path");
  });

  it("rejects a catalog mapping that omits the task query operation", () => {
    const base = catalogFixture();
    const mappings = base.mappings.map((mapping) => mapping.modelKey === "gpt-image-2" && mapping.taskKind === "text_to_image"
      ? { ...mapping, query: undefined }
      : mapping);
    const provider = createProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: () => ({ ...base, mappings }),
      fetchImpl: vi.fn(),
    });
    expect(() => provider.buildRequest(input())).toThrow("unsupported query path");
  });

  it("projects a selected variant into mappings that explicitly consume request.params.model", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(provider.buildRequest(input({
      modelId: "doubao-seedance-2.0",
      transportModelId: "doubao-seedance-2.0-fast",
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
      resolveReferenceUrls: () => ({ imageUrls: ["https://cdn.example/orphan.png"] }),
      fetchImpl: vi.fn(),
    });
    expect(() => provider.buildRequest(input({
      references: [{ assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" }],
    }))).toThrow("APIMart catalog mapping dropped a resolved reference");
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
    await expect(provider.materialize?.({
      providerTaskId: "task-1",
      raw: { code: 200, data: { status: "completed", result: { images: [{ url: "https://cdn.example/image.png" }], videos: [{ url: "https://cdn.example/video.mp4" }] } } },
    })).resolves.toMatchObject({ outputs: [
      { kind: "image", url: "https://cdn.example/image.png" },
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
    await expect(provider.materialize?.({
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
    const result = await provider.materialize?.({
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
    const result = await provider.materialize?.({
      providerTaskId: "task-direct",
      raw: { data: { result: { video_url: ["data:video/mp4;base64,AAAA"], fileName: "direct.mp4" } } },
    });
    expect(result?.outputs).toEqual([{ kind: "video", url: "data:video/mp4;base64,AAAA", fileName: "direct.mp4" }]);
  });

  it("maps a semantic text-to-video contract to APIMart's flat video body", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(provider.buildRequest(input({
      modelId: "sora-2",
      mode: "text-to-video",
      parameters: {
        aspectRatio: "16:9",
        duration: 5,
        resolution: "720p",
      },
    }))).toEqual({
      model: "sora-2",
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
    }))).toThrow("APIMart reference URL projection conflicts with canonical parameters");
  });

  it("honors an explicit catalog drop instead of guessing a replacement wire field", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    const body = provider.buildRequest(input({
      modelId: "sora-2",
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
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "sora-2", duration: 4, aspect_ratio: "16:9" });
      return new Response(JSON.stringify({ code: 200, data: [{ status: "submitted", task_id: "video-task-1" }] }), { status: 200 });
    });
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: fetchImpl as unknown as typeof fetch });
    const request = provider.buildRequest(input({ modelId: "sora-2", mode: "text_to_video", parameters: { duration: 4, aspect_ratio: "16:9" } }));
    // Runtime Adapter passes a structuredClone of the prepared request.  A
    // deep clone must still select the video endpoint from the local hash map.
    await expect(provider.submit(structuredClone(request), "stable-key")).resolves.toMatchObject({ providerTaskId: "video-task-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of forwarding an unknown semantic video parameter", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({ modelId: "sora-2", mode: "text-to-video", parameters: { duration: 4, mysteryKnob: true } })))
      .toThrow("APIMart generation parameter is unsupported: mysteryKnob");
  });

  it("fails closed for direct submit calls that bypass catalog preparation", async () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    await expect(provider.submit({ model: "video-model-v1", prompt: "a cat", duration: 3 }, "stable-key"))
      .rejects.toThrow("APIMart sealed catalog identity is missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects certification-owned rows before a contextual submit can force an APIMart endpoint", () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      catalogReader: dualModeCatalogFixture,
      fetchImpl,
    });
    expect(() => provider.buildRequest(input({ modelId: "shared-model", mode: "text-to-image", parameters: {} })))
      .toThrow("APIMart certification-owned connection requires its certified transport");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an unknown semantic mode instead of defaulting to image submission", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({ mode: "mystery-output", parameters: {} })))
      .toThrow("APIMart generation mode is unsupported: mystery-output");
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
      modelId: "sora-2",
      mode: "image_to_video",
      references: [{ assetId: "asset-character", contentHash: "c".repeat(64), version: 1, kind: "image", role: "character" }],
      parameters: { duration: 4, imageUrls: ["https://cdn.example/character.png"] },
    }));
    const contextual = (provider as typeof provider & {
      submitWithContext: (request: unknown, idempotencyKey: string, semanticInput: ReturnType<typeof input>) => Promise<unknown>;
    }).submitWithContext;
    await expect(contextual(structuredClone(request), "stable-key", input({
      modelId: "sora-2",
      mode: "image_to_video",
      references: [{ assetId: "asset-character", contentHash: "c".repeat(64), version: 1, kind: "image", role: "character" }],
      parameters: { duration: 4, imageUrls: ["https://cdn.example/character.png"] },
    }))).resolves.toMatchObject({ providerTaskId: "i2v-task-1" });
  });

  it("projects references through the explicit resolver contract before building the body", () => {
    const resolveReferenceUrls = vi.fn<ApimartReferenceUrlResolver>((request) => ({
      referenceImageUrls: request.references.map((reference) => `https://cdn.example/${reference.assetId}.png`),
    }));
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      resolveReferenceUrls,
      fetchImpl: vi.fn(),
    });
    const references = [{ assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" as const, role: "reference" as const }];
    expect(provider.buildRequest(input({ modelId: "sora-2", mode: "image_to_video", references, parameters: { duration: 3 } }))).toMatchObject({
      image_urls: ["https://cdn.example/asset-1.png"],
      duration: 3,
    });
    expect(resolveReferenceUrls).toHaveBeenCalledWith(expect.objectContaining({ references, mode: "image_to_video" }));
  });

  it("does not serialize empty resolver channels as optional APIMart fields", () => {
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      resolveReferenceUrls: () => ({ imageUrls: ["https://cdn.example/character.png"], videoUrls: [], audioUrls: [] }),
      fetchImpl: vi.fn(),
    });
    const body = provider.buildRequest(input({
      modelId: "doubao-seedance-2.0",
      mode: "image_to_video",
      references: [{ assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" }],
      parameters: { duration: 3 },
    }));
    expect(body).toMatchObject({ image_urls: ["https://cdn.example/character.png"] });
    expect(body).not.toHaveProperty("video_urls");
    expect(body).not.toHaveProperty("audio_urls");
  });

  it("fails closed when references have no resolved provider URL", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({
      modelId: "sora-2",
      mode: "image_to_video",
      references: [{ assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" }],
      parameters: { duration: 3 },
    }))).toThrow("APIMart references must be resolved to provider URLs before submission");
  });

  it("fails closed when fewer resolved URLs than references survive canonical projection", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({
      modelId: "sora-2",
      mode: "image_to_video",
      // One typed image plus one legacy reference without a kind: both must
      // resolve independently; sharing one URL must not pass the final gate.
      references: [
        { assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" },
        { assetId: "asset-2", contentHash: "b".repeat(64), version: 1 },
      ],
      parameters: { duration: 3, imageUrls: ["https://cdn.example/only-one.png"] },
    }))).toThrow("APIMart references must be resolved to provider URLs before submission");
  });

  it("rejects local-only reference URLs instead of sending an unreachable paid request", () => {
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
    expect(() => provider.buildRequest(input({
      modelId: "sora-2",
      mode: "image_to_video",
      references: [{ assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" }],
      parameters: { duration: 3, imageUrls: ["nomi-local://project/assets/asset-1.png"] },
    }))).toThrow("APIMart references must be resolved to provider URLs before submission");
  });

  it("rejects a resolver projection that conflicts with an explicit canonical URL", () => {
    const provider = createApimartGenerationProvider({
      resolveConnection: () => ({ apiKey: "test-key" }),
      resolveReferenceUrls: () => ({ imageUrls: ["https://cdn.example/from-resolver.png"] }),
      fetchImpl: vi.fn(),
    });
    expect(() => provider.buildRequest(input({
      modelId: "sora-2",
      mode: "image_to_video",
      references: [{ assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" }],
      parameters: { duration: 3, imageUrls: ["https://cdn.example/explicit.png"] },
    }))).toThrow("APIMart reference URL projection conflicts with canonical parameters");
  });

  it("blocks direct submission when a caller bypasses buildRequest with a local-only URL", async () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    await expect(provider.submit({
      model: "sora-2",
      prompt: "a cat",
      image_urls: ["file:///Users/me/character.png"],
    }, "stable-key")).rejects.toThrow("APIMart sealed catalog identity is missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on an unsupported direct-submit body field", async () => {
    const fetchImpl = vi.fn();
    const provider = createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl });
    await expect(provider.submit({ model: "sora-2", prompt: "a cat", duration: 3, mysteryKnob: true }, "stable-key"))
      .rejects.toThrow("APIMart sealed catalog identity is missing");
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
