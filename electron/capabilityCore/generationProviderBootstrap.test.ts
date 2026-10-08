import { projectReferenceUrls } from "./apimartGenerationProjection";
import { prepareProductionGenerationAuthorizationWithReferences } from "../productionRun/prepareProductionGenerationAuthorization";
import { createGenerationRuntimeAdapter } from "./generationRuntimeAdapter";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGenerationProviderBootstrap } from "./generationProviderBootstrap";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import type { GenerationProviderRequestInputV1 } from "./generationRuntimeAdapter";
import { APIMART_IMAGE_MODELS, APIMART_IMAGE_QUERY, APIMART_IMAGE_STATUS } from "../catalog/apimartImages";
import type { CatalogState } from "../catalog/types";
import type { ProductionExecutionBinding } from "../productionRun/productionExecutionBinding";
import type { ProductionRun } from "../productionRun/productionRunTypes";

/** 授权必须站在真实 Run 上（`run` 现在是必填）。这份草稿快照只带 prepare 真正读的那几项。 */
function draftRunFor(operationId: string, projectId: string): ProductionRun {
  return {
    runId: operationId, projectId, planVersion: 1, revision: 0, jobs: [], gates: [], artifacts: [],
    policy: { maxAttemptsPerJob: 2 },
    budget: { currency: "CNY", reserved: 0, actual: 0, unsettled: 0, authorized: 0 },
  } as unknown as ProductionRun;
}

const referencePorts = vi.hoisted(() => ({
  catalog: vi.fn(), settings: vi.fn(), list: vi.fn(), identity: vi.fn(), read: vi.fn(),
  post: vi.fn(), multipart: vi.fn(), put: vi.fn(),
}));
vi.mock('../catalog/catalogStore', async importOriginal => ({ ...(await importOriginal<typeof import('../catalog/catalogStore')>()), readCatalog: referencePorts.catalog }));
vi.mock('../settings/automationPolicySettings', async importOriginal => ({ ...(await importOriginal<typeof import('../settings/automationPolicySettings')>()), readAutomationPolicySettings: referencePorts.settings }));
vi.mock('./pendingSpendReferences', async importOriginal => ({ ...(await importOriginal<typeof import('./pendingSpendReferences')>()),
  projectSpendReferenceAssets: { list: referencePorts.list, identity: referencePorts.identity, import: vi.fn() },
}));
vi.mock('../assets/localAssetFile', async importOriginal => ({ ...(await importOriginal<typeof import('../assets/localAssetFile')>()),
  readNomiLocalAsset: referencePorts.read, postJsonForAssetUpload: referencePorts.post,
  postMultipartForAssetUpload: referencePorts.multipart, putBinaryForAssetUpload: referencePorts.put,
}));

const CONTRACT_HASH = "a".repeat(64);
const REQUEST_FINGERPRINT = "b".repeat(64);

const secretMocks = vi.hoisted(() => ({
  decryptApiKeyRecord: vi.fn((record?: { apiKey?: string }) => record?.apiKey ?? ""),
  apiKeyDecryptStatus: vi.fn((record?: { apiKey?: string; enc?: string }) =>
    record?.enc === "safeStorage" && record.apiKey ? "ok" : record?.apiKey ? "needs_resave" : "missing"),
}));
vi.mock("../catalog/secrets", () => ({
  decryptApiKeyRecord: secretMocks.decryptApiKeyRecord,
  apiKeyDecryptStatus: secretMocks.apiKeyDecryptStatus,
  credentialRecordCounts: (record?: { apiKey?: string; enabled?: boolean }) =>
    Boolean(record?.apiKey) && record?.enabled !== false,
}));

function state(apiKey = ""): CatalogState {
  const curated = APIMART_IMAGE_MODELS.find((model) => model.modelKey === "gpt-image-2");
  if (!curated) throw new Error("test fixture lost the shipped APIMart GPT Image 2 contract");
  return {
    version: 9,
    vendors: [{ key: "apimart", name: "APIMart", enabled: true, baseUrlHint: "https://api.apimart.ai", authType: "bearer", authHeader: "Authorization", createdAt: "now", updatedAt: "now" }],
    models: [{ modelKey: curated.modelKey, vendorKey: "apimart", labelZh: curated.labelZh, kind: "image", enabled: true, meta: { archetypeId: curated.archetypeId, canonicalModelId: "gpt image 2" }, onboarding: { addedVia: "manual", addedAt: "now", fields: [{ key: "aspectRatio", displayName: "比例", type: "select", options: [{ value: "1:1", label: "1:1" }], evidence: { field: "aspectRatio", evidence: "test fixture", evidence_location: "fixture", confidence: "high" } }] }, createdAt: "now", updatedAt: "now" }],
    mappings: curated.mappings.map((mapping) => ({
      id: mapping.id,
      vendorKey: "apimart",
      modelKey: curated.modelKey,
      taskKind: mapping.taskKind,
      name: mapping.name,
      enabled: true,
      create: mapping.create,
      // 轮询与状态取正式契约同一份常量（seedBuiltins 的 curated 契约就用它们）；抄一份字面量会在契约演进时静默漂移。
      query: APIMART_IMAGE_QUERY,
      statusMapping: APIMART_IMAGE_STATUS,
      createdAt: "now",
      updatedAt: "now",
    })),
    apiKeysByVendor: apiKey ? { apimart: { vendorKey: "apimart", apiKey, enc: "safeStorage", enabled: true, createdAt: "now", updatedAt: "now" } } : {},
  };
}

function encryptedState(): CatalogState {
  const next = state();
  next.apiKeysByVendor.apimart = {
    vendorKey: "apimart",
    apiKey: "encrypted-keychain-payload",
    enc: "safeStorage",
    enabled: true,
    createdAt: "now",
    updatedAt: "now",
  };
  return next;
}

type BootstrapGenerationInput = GenerationProviderRequestInputV1 & {
  /** Keep the test request shaped like the sealed runtime envelope. */
  requestFingerprint: string;
  executionBinding: ProductionExecutionBinding;
};

function generationInput(overrides: Partial<BootstrapGenerationInput> = {}): BootstrapGenerationInput {
  return {
    moduleId: "generation.single-shot",
    providerId: "apimart",
    modelId: "gpt-image-2",
    mode: "text-to-image",
    prompt: "paper crane",
    parameters: {},
    references: [],
    contractHash: CONTRACT_HASH,
    idempotencyKey: "stable-key",
    requestFingerprint: REQUEST_FINGERPRINT,
    executionBinding: {
      immutableProjectUuid: "project-1",
      projectGeneration: 1,
      runId: "run-1",
      shotId: "shot-1",
      contractHash: CONTRACT_HASH,
      runtimeTaskId: "runtime-1",
      providerNamespace: "apimart",
      providerIdempotencyKey: "stable-key",
      requestFingerprint: REQUEST_FINGERPRINT,
      runtimeEnvelopeRef: ".nomi/runs/run-1/runtime.json",
      fencingEpoch: 1,
    },
    ...overrides,
  };
}

describe("generation provider bootstrap", () => {
  beforeEach(() => {
    secretMocks.decryptApiKeyRecord.mockReset().mockImplementation((record?: { apiKey?: string }) => record?.apiKey ?? "");
    secretMocks.apiKeyDecryptStatus.mockReset().mockImplementation((record?: { apiKey?: string; enc?: string }) =>
      record?.enc === "safeStorage" && record.apiKey ? "ok" : record?.apiKey ? "needs_resave" : "missing");
  });

  it("keeps a visible catalog provider but no executable adapter when the key is missing", () => {
    const boot = createGenerationProviderBootstrap(state());
    expect(boot.providers).toHaveLength(0);
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: false, missingForSubmit: ["configured_provider"] });
    expect(createCatalogModuleRegistry(state(), { readinessByProvider: boot.readinessByProvider }).resolve({ moduleId: "generation.single-shot", providerId: "apimart", modelId: "gpt-image-2", mode: "text_to_image" })).toMatchObject({ providerId: "apimart", modelId: "gpt-image-2" });
  });

  it("does not bootstrap a provider from an unverified enabled adapter row with key and raw mapping", () => {
    const unverified = state("test-key");
    unverified.models[0] = {
      ...unverified.models[0],
      meta: { adapter: { state: "unverified", modes: [], updatedAt: "now" } },
    };
    const boot = createGenerationProviderBootstrap(unverified, { connectionResolver: () => ({ apiKey: "test-key" }) });
    expect(boot.providers).toEqual([]);
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: false });
  });

  it("does not bootstrap APIMart's hardcoded provider for a certification-owned non-bearer connection", () => {
    const certified = state("test-key");
    certified.vendors[0] = {
      ...certified.vendors[0]!,
      baseUrlHint: "https://certified.example/api",
      authType: "x-api-key",
      authHeader: "X-API-Key",
      meta: { adapter: { state: "verified", activeRevision: "certified-revision" } },
    };

    const boot = createGenerationProviderBootstrap(certified, {
      connectionResolver: () => ({ apiKey: "test-key" }),
    });

    expect(boot.providers).toEqual([]);
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: false });
  });

  it("proves only the capabilities implemented by the APIMart adapter", () => {
    const boot = createGenerationProviderBootstrap(state("test-key"), { connectionResolver: () => ({ apiKey: "test-key" }) });
    expect(boot.providers).toHaveLength(1);
    expect(boot.providers[0]?.capabilities).toEqual({ submitIdempotency: false, query: true, reconcile: true, cancel: false, materialize: true });
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: true, capabilities: { query: true, reconcile: true, cancel: false } });
  });

  // 「注入一个 resolver 现算 URL」那条路已经删干净（P1）：现在只有一份授权时封存的快照，
  // 下面这条就是它的全部覆盖。
  it("uses the durable approved reference snapshot after restart", () => {
    const fixture = state("test-key");
    const reference = { assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" as const };
    const input = { ...generationInput({ mode: "image-to-image", references: [reference] }),
      referenceUrls: { [spendReferenceKey(reference)]: "https://cdn.example/approved.png" } };
    const boot = () => createGenerationProviderBootstrap(fixture, {
      connectionResolver: () => ({ apiKey: "test-key" }), catalogReader: () => fixture,
    });
    const first = boot().providers[0]!.buildRequest(input);
    expect(first).toMatchObject({ image_urls: ["https://cdn.example/approved.png"] });
    expect(boot().providers[0]!.buildRequest(JSON.parse(JSON.stringify(input)))).toEqual(first);
  });

  it("localizes only included shots and seals the same snapshot used after restart", async () => {
    const fixture = state("test-key");
    const reference = { assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" as const };
    const candidate = { candidateId: "candidate", revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "gpt-image-2", mode: "image-to-image", prompt: "edit", parameters: {}, references: [reference] };
    const contract = { ...candidate, schemaVersion: 1 as const, candidateRevision: 1, moduleVersion: "1", contractHash: CONTRACT_HASH, warnings: [], droppedFields: [] };
    const boot = () => createGenerationProviderBootstrap(fixture, { connectionResolver: () => ({ apiKey: "test-key" }), catalogReader: () => fixture });
    const resolve = vi.fn(async (_input: Parameters<typeof import("./productionReferenceUrls").resolveProductionReferenceUrls>[0]) => ({ [spendReferenceKey(reference)]: "https://cdn.example/approved.png" }));
    const prepared = await prepareProductionGenerationAuthorizationWithReferences({
      lease: { projectId: "p", immutableProjectUuid: "uuid", projectGeneration: 1, revocationEpoch: 0 },
      projectRevision: 1, operation: { operationId: "run", projectId: "p", candidate, planVersion: 1 }, contract,
      run: draftRunFor("run", "p"),
      multiShot: { planHash: "plan", scope: ["included"], shots: [{ shotId: "included", candidate, contract }, { shotId: "excluded", candidate: { ...candidate, references: [{ ...reference, assetId: "outside-scope" }] }, included: false }] },
      providers: boot().providers, resolveShotPrice: () => ({ known: true, amount: 1 }), now: "2026-09-20T00:00:00Z", assertCurrent() {},
    }, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({ projectId: "p", references: [reference] });
    const job = JSON.parse(JSON.stringify(prepared.envelope)).jobs[0];
    expect(job.referenceUrls).toEqual({ [spendReferenceKey(reference)]: "https://cdn.example/approved.png" });
    const restarted = createGenerationRuntimeAdapter({ providers: boot().providers }).prepareAuthorization({ contract, providerIdempotencyKey: job.providerIdempotencyKey, referenceUrls: job.referenceUrls });
    expect(restarted.providerRequestHash).toBe(job.providerWirePayloadHash);
  });

  it("preserves first/last frame and mixed-media channels from the approved snapshot", () => {
    const references = [
      { assetId: "first", kind: "image" as const, role: "first_frame" as const },
      { assetId: "last", kind: "image" as const, role: "last_frame" as const },
      { assetId: "video", kind: "video" as const },
      { assetId: "audio", kind: "audio" as const },
    ].map(reference => ({ ...reference, contentHash: CONTRACT_HASH, version: 1 }));
    const referenceUrls = Object.fromEntries(references.map(reference => [spendReferenceKey(reference), `https://cdn.example/${reference.assetId}`]));
    const mapping = state().mappings[0]!;
    const projected = projectReferenceUrls({ ...generationInput({ references }), referenceUrls }, {
      ...mapping, create: { ...mapping.create, body: { first_frame_image: "{{request.params.first_frame_image}}", last_frame_image: "{{request.params.last_frame_image}}", video_urls: "{{request.params.video_urls}}", audio_urls: "{{request.params.audio_urls}}" } },
    });
    expect(projected.parameters).toEqual({ first_frame_image: "https://cdn.example/first", last_frame_image: "https://cdn.example/last", video_urls: ["https://cdn.example/video"], audio_urls: ["https://cdn.example/audio"] });
  });

  it("registers an enabled encrypted credential without resolving it until the first network request", async () => {
    const fixture = encryptedState();
    const connectionResolver = vi.fn(() => ({ apiKey: "decrypted-at-request-time" }));
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      code: 200,
      data: [{ status: "submitted", task_id: "task-lazy" }],
    }), { status: 200 }));

    const boot = createGenerationProviderBootstrap(fixture, {
      connectionResolver,
      catalogReader: () => fixture,
      fetchImpl,
    });
    const provider = boot.providers[0];

    expect(provider).toBeDefined();
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: true });
    expect(connectionResolver).not.toHaveBeenCalled();
    const request = generationInput();
    const providerRequest = provider?.buildRequest(request);
    await provider?.materialize?.({ providerTaskId: "task-lazy", raw: { data: { result: { images: [] } } } });
    expect(connectionResolver).not.toHaveBeenCalled();

    await expect(provider?.submit(providerRequest, request.idempotencyKey))
      .resolves.toMatchObject({ providerTaskId: "task-lazy" });
    expect(connectionResolver).toHaveBeenCalledTimes(1);
    expect(connectionResolver).toHaveBeenCalledWith("apimart");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer decrypted-at-request-time" });
  });

  it("routes an explicitly enabled production fixture through loopback while keeping the canonical APIMart scope", async () => {
    vi.stubEnv("NOMI_E2E", "1");
    vi.stubEnv("NOMI_E2E_PRODUCTION_FIXTURE", "1");
    try {
      const fixture = encryptedState();
      fixture.vendors[0] = {
        ...fixture.vendors[0],
        credentialBinding: {
          origin: "https://api.apimart.ai",
          authType: "bearer",
          authHeader: "Authorization",
          confirmedAt: "now",
        },
      };
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        code: 200,
        data: [{ status: "submitted", task_id: "task-loopback" }],
      }), { status: 200 }));
      const boot = createGenerationProviderBootstrap(fixture, {
        catalogReader: () => fixture,
        fixtureBaseUrlOverride: "http://127.0.0.1:4567",
        fetchImpl,
      });
      const provider = boot.providers[0];
      const request = generationInput();
      const providerRequest = provider?.buildRequest(request);

      await expect(provider?.submit(providerRequest, request.idempotencyKey))
        .resolves.toMatchObject({ providerTaskId: "task-loopback" });
      expect(fetchImpl).toHaveBeenCalledWith(
        "http://127.0.0.1:4567/v1/images/generations",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer encrypted-keychain-payload" }) }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the saved credential origin and destination when fixture mode is off", async () => {
    vi.stubEnv("NOMI_E2E", "0");
    vi.stubEnv("NOMI_E2E_PRODUCTION_FIXTURE", "0");
    try {
      const fixture = encryptedState();
      fixture.vendors[0] = {
        ...fixture.vendors[0],
        credentialBinding: {
          origin: "https://api.apimart.ai",
          authType: "bearer",
          authHeader: "Authorization",
          confirmedAt: "now",
        },
      };
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        code: 200,
        data: [{ status: "submitted", task_id: "task-production" }],
      }), { status: 200 }));
      const boot = createGenerationProviderBootstrap(fixture, {
        catalogReader: () => fixture,
        fixtureBaseUrlOverride: "http://127.0.0.1:4567",
        fetchImpl,
      });
      const provider = boot.providers[0];
      const request = generationInput();
      await expect(provider?.submit(provider?.buildRequest(request), request.idempotencyKey))
        .resolves.toMatchObject({ providerTaskId: "task-production" });
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://api.apimart.ai/v1/images/generations",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer encrypted-keychain-payload" }) }),
      );
      expect(fixture.vendors[0]?.credentialBinding?.origin).toBe("https://api.apimart.ai");
      expect(JSON.stringify(fetchImpl.mock.calls[0])).not.toContain("127.0.0.1:4567");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // 2026-09-29：主域被墙的用户在设置里改到官方国内线路后，Agent 付款卡 / 外部 MCP / 全自动 Run
  // 这条路也得认它——那是代码里登记的同一条内置连接（凭据守卫认的那张名单），不是「漂移」。
  it("keeps the direct-key APIMart provider on its officially registered domestic line and sends there", async () => {
    const fixture = encryptedState();
    fixture.vendors[0] = { ...fixture.vendors[0], baseUrlHint: "https://api.apib.ai" };
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      code: 200,
      data: [{ status: "submitted", task_id: "task-domestic" }],
    }), { status: 200 }));

    const boot = createGenerationProviderBootstrap(fixture, { catalogReader: () => fixture, fetchImpl });
    const provider = boot.providers[0];
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: true });

    const request = generationInput();
    await expect(provider?.submit(provider?.buildRequest(request), request.idempotencyKey))
      .resolves.toMatchObject({ providerTaskId: "task-domestic" });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.apib.ai/v1/images/generations", expect.anything());
  });

  // 2026-09-29（A10b）：报错用户点过「继续验证 → 自检」——在内置 APIMart 上手加了一个模型去自检，
  // 那一行带着 meta.adapter。旧判据把「这家名下任何一行带标记」当成整家归认证管：装配、取连接、
  // 出请求三处各抄一份，Agent 那条路对整家 APIMart 关门（画布那条路不查，照样出图）。
  // 判据收成一份（catalog/certificationOwnership）之后，用户自己加的那一行只管它自己。
  it("keeps the Agent path on built-in APIMart when the user added and self-checked a model of their own (A10b)", async () => {
    const fixture = encryptedState();
    fixture.models.push({
      modelKey: "gpt-image-1", vendorKey: "apimart", labelZh: "gpt-image-1", kind: "image", enabled: false,
      meta: { adapter: { state: "unverified", modes: [], updatedAt: "now" } }, createdAt: "now", updatedAt: "now",
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      code: 200,
      data: [{ status: "submitted", task_id: "task-a10b" }],
    }), { status: 200 }));

    const boot = createGenerationProviderBootstrap(fixture, { catalogReader: () => fixture, fetchImpl });
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: true });
    const provider = boot.providers.find((candidate) => candidate.providerId === "apimart");
    const request = generationInput();
    await expect(provider?.submit(provider.buildRequest(request), request.idempotencyKey))
      .resolves.toMatchObject({ providerTaskId: "task-a10b" });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.apimart.ai/v1/images/generations", expect.anything());
  });

  it("fails closed when a direct-key APIMart endpoint drifts in the live catalog", async () => {
    const initial = encryptedState();
    const live = encryptedState();
    live.vendors[0] = { ...live.vendors[0], baseUrlHint: "https://live.apimart.example" };
    let reads = 0;
    const catalogReader = vi.fn(() => {
      reads += 1;
      return reads === 1 ? initial : live;
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      code: 200,
      data: [{ status: "submitted", task_id: "task-production-default" }],
    }), { status: 200 }));

    const boot = createGenerationProviderBootstrap(initial, { catalogReader, fetchImpl });
    const provider = boot.providers[0];

    expect(provider).toBeDefined();
    expect(catalogReader).not.toHaveBeenCalled();
    expect(secretMocks.decryptApiKeyRecord).not.toHaveBeenCalled();

    const request = generationInput();
    const providerRequest = provider?.buildRequest(request);
    await expect(provider?.submit(providerRequest, request.idempotencyKey))
      .rejects.toMatchObject({ code: "apimart_provider_error", message: "apimart catalog direct-key contract is unavailable; restore the built-in Settings connection" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces a locked encrypted credential as a provider error on the first request", async () => {
    const fixture = encryptedState();
    const connectionResolver = vi.fn(() => null);
    const fetchImpl = vi.fn();
    const boot = createGenerationProviderBootstrap(fixture, {
      connectionResolver,
      catalogReader: () => fixture,
      fetchImpl,
    });
    const provider = boot.providers[0];

    expect(provider).toBeDefined();
    expect(connectionResolver).not.toHaveBeenCalled();
    const request = generationInput();
    const providerRequest = provider?.buildRequest(request);
    await expect(provider?.submit(providerRequest, request.idempotencyKey))
      .rejects.toMatchObject({ code: "apimart_provider_error", message: "apimart connection is disabled, missing, or locked" });
    expect(connectionResolver).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the current encrypted credential from one live catalog snapshot without retargeting the endpoint", async () => {
    const initial = encryptedState();
    const current = encryptedState();
    current.apiKeysByVendor.apimart = {
      ...current.apiKeysByVendor.apimart,
      apiKey: "new-endpoint-key",
    };
    const catalogReader = vi.fn(() => current);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      code: 200,
      data: [{ status: "submitted", task_id: "task-current-snapshot" }],
    }), { status: 200 }));
    const boot = createGenerationProviderBootstrap(initial, { catalogReader, fetchImpl });
    const provider = boot.providers[0];

    expect(catalogReader).not.toHaveBeenCalled();
    secretMocks.decryptApiKeyRecord.mockReturnValue("new-endpoint-key");
    const request = generationInput();
    const providerRequest = provider?.buildRequest(request);
    await expect(provider?.submit(providerRequest, request.idempotencyKey))
      .resolves.toMatchObject({ providerTaskId: "task-current-snapshot" });
    expect(catalogReader).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.apimart.ai/v1/images/generations",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer new-endpoint-key" }) }),
    );
  });

  it("does not report a provider ready for a legacy plaintext key", () => {
    const plain = state("legacy-plain-key");
    plain.apiKeysByVendor.apimart = { ...plain.apiKeysByVendor.apimart!, enc: "plain" };
    const boot = createGenerationProviderBootstrap(plain, { connectionResolver: () => ({ apiKey: "legacy-plain-key" }) });
    expect(boot.providers).toEqual([]);
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: false });
  });

  it("fails closed before fetch when the live catalog snapshot disables the vendor", async () => {
    const current = encryptedState();
    const catalogReader = vi.fn(() => current);
    const fetchImpl = vi.fn();
    const boot = createGenerationProviderBootstrap(current, { catalogReader, fetchImpl });
    const provider = boot.providers[0];

    expect(provider).toBeDefined();
    const request = generationInput();
    const providerRequest = provider?.buildRequest(request);
    current.vendors[0] = { ...current.vendors[0], enabled: false };
    await expect(provider?.submit(providerRequest, request.idempotencyKey))
      .rejects.toMatchObject({ code: "apimart_provider_error", message: "apimart catalog vendor is unavailable" });
    expect(catalogReader).toHaveBeenCalledTimes(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["disabled", "missing"] as const)(
    "fails closed before fetch when the live credential is %s",
    async (credentialState) => {
      const current = encryptedState();
      const catalogReader = vi.fn(() => current);
      const fetchImpl = vi.fn();
      const boot = createGenerationProviderBootstrap(current, { catalogReader, fetchImpl });
      const provider = boot.providers[0];

      const request = generationInput();
      const providerRequest = provider?.buildRequest(request);
      if (credentialState === "disabled") {
        current.apiKeysByVendor.apimart = { ...current.apiKeysByVendor.apimart!, enabled: false };
      } else {
        delete current.apiKeysByVendor.apimart;
      }
      await expect(provider?.submit(providerRequest, request.idempotencyKey))
        .rejects.toMatchObject({ code: "apimart_provider_error", message: "apimart connection is disabled, missing, or locked" });
      expect(catalogReader).toHaveBeenCalledTimes(3);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});


it.each(['first_frame', 'last_frame'] as const)('rejects unsupported %s rather than changing it into an ordinary image reference', (role) => {
  const reference = { assetId: 'frame', contentHash: CONTRACT_HASH, version: 1, kind: 'image' as const, role: 'first_frame' as const };
  {
    const ref = { ...reference, role };
    expect(() => projectReferenceUrls({ ...generationInput({ references: [ref] }), referenceUrls: { [spendReferenceKey(ref)]: 'https://cdn.example/frame.png' } },
      { ...state().mappings[0]!, create: { ...state().mappings[0]!.create, body: { image_urls: '{{request.params.image_urls}}' } } })).toThrow(/unsupported.*role/);
  }
});


it.each(['ask', 'deny', 'allow'] as const)('real authorization wrapper preserves %s upload consent before any paid provider call', async consent => {
  secretMocks.decryptApiKeyRecord.mockReset().mockImplementation(record => record?.apiKey ?? '');
  secretMocks.apiKeyDecryptStatus.mockReset().mockReturnValue('ok');
  const fixture = state('test-key');
  const uploadCatalog = structuredClone(fixture);
  uploadCatalog.vendors[0]!.assetIngestion = { strategy: 'upload-multipart', endpoint: 'https://upload.fixture.test/reference', fileField: 'file', urlPath: 'url', visibility: 'public-anonymous', accepts: ['image'], ttlSeconds: 3600 };
  referencePorts.catalog.mockReturnValue(uploadCatalog);
  referencePorts.settings.mockReturnValue({ anonymousAssetHosting: consent, minimizeUploads: true });
  const reference = { assetId: 'asset-1', contentHash: CONTRACT_HASH, version: 1, kind: 'image' as const };
  referencePorts.list.mockReturnValue([{ id: reference.assetId, data: { url: 'nomi-local://asset/p/reference.png', contentType: 'image/png' } }]);
  referencePorts.identity.mockReturnValue({ contentHash: CONTRACT_HASH, version: 1 });
  referencePorts.read.mockReturnValue({ bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'), contentType: 'image/png', fileName: 'reference.png' });
  referencePorts.post.mockReset().mockResolvedValue({ url: 'https://cdn.fixture.test/reference.png' });
  referencePorts.multipart.mockReset().mockResolvedValue({ url: 'https://cdn.fixture.test/reference.png' }); referencePorts.put.mockReset();
  const paidFetch = vi.fn().mockRejectedValue(new Error('Unapproved paid submission is forbidden'));
  const bootstrap = createGenerationProviderBootstrap(fixture, { connectionResolver: () => ({ apiKey: 'test-key' }), catalogReader: () => fixture, fetchImpl: paidFetch });
  expect(bootstrap.providers).toHaveLength(1);
  const candidate = { candidateId: 'candidate', revision: 1, moduleId: 'generation.single-shot', providerId: 'apimart', modelId: 'gpt-image-2', mode: 'image-to-image', prompt: 'edit', parameters: {}, references: [reference] };
  const contract = { ...candidate, schemaVersion: 1 as const, candidateRevision: 1, moduleVersion: '1', contractHash: CONTRACT_HASH, warnings: [], droppedFields: [] };
  // No resolver seam: actual wrapper -> indexed asset identity -> localization -> catalog provider -> durable envelope.
  const preparing = prepareProductionGenerationAuthorizationWithReferences({
    lease: { projectId: 'p', immutableProjectUuid: 'uuid', projectGeneration: 1, revocationEpoch: 0 }, projectRevision: 1,
    operation: { operationId: 'run', projectId: 'p', candidate, planVersion: 1 }, contract,
    run: draftRunFor('run', 'p'),
    providers: bootstrap.providers, resolveShotPrice: () => ({ known: true, amount: 1 }), now: '2026-09-20T00:00:00Z', assertCurrent() {},
  });
  const prepared = await preparing;
  if (consent === 'allow') {
    expect(referencePorts.post).not.toHaveBeenCalled();
    expect(referencePorts.multipart).toHaveBeenCalledTimes(1);
    expect(referencePorts.multipart.mock.calls[0]?.[0]).toBe('https://upload.fixture.test/reference');
  } else {
    // Existing public-provider relay remains available; ask/deny blocks anonymous hosting only.
    expect(referencePorts.post).not.toHaveBeenCalled();
    expect(referencePorts.multipart).toHaveBeenCalledTimes(1);
    expect(referencePorts.multipart.mock.calls[0]?.[0]).toContain('/v1/assets');
  }
  const job = JSON.parse(JSON.stringify(prepared.envelope)).jobs[0];
  expect(job.referenceUrls).toEqual({ [spendReferenceKey(reference)]: 'https://cdn.fixture.test/reference.png' });
  const restarted = createGenerationRuntimeAdapter({ providers: bootstrap.providers }).prepareAuthorization({ contract, providerIdempotencyKey: job.providerIdempotencyKey, referenceUrls: job.referenceUrls });
  expect(restarted.providerRequestHash).toBe(job.providerWirePayloadHash);
  expect(referencePorts.put).not.toHaveBeenCalled();
  expect(paidFetch).not.toHaveBeenCalled();
});
