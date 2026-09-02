import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGenerationProviderBootstrap } from "./generationProviderBootstrap";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import type { GenerationProviderRequestInputV1 } from "./generationRuntimeAdapter";
import { APIMART_IMAGE_MODELS } from "../catalog/apimartImages";
import type { CatalogState } from "../catalog/types";
import type { ProductionExecutionBinding } from "../productionRun/productionExecutionBinding";

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
      query: {
        method: "GET",
        path: "/v1/tasks/{{providerMeta.task_id}}",
        headers: { Authorization: "Bearer {{user_api_key}}" },
        response_mapping: { task_id: "data.id", status: "data.status", image_url: "data.result.images.0.url.0", error_message: "data.error.message" },
      },
      statusMapping: { queued: ["submitted", "pending", "queued"], running: ["processing", "running"], succeeded: ["completed", "succeeded", "success"], failed: ["failed", "cancelled", "error"] },
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

  it("passes the project-scoped reference URL resolver into the semantic adapter", () => {
    const fixture = state("test-key");
    const resolveReferenceUrls = vi.fn(() => ({ imageUrls: ["https://cdn.example/asset-1.png"] }));
    const boot = createGenerationProviderBootstrap(fixture, {
      connectionResolver: () => ({ apiKey: "test-key" }),
      catalogReader: () => fixture,
      resolveReferenceUrls,
    });
    const provider = boot.providers[0];
    const body = provider?.buildRequest(generationInput({
      mode: "image-to-image",
      prompt: "edit",
      references: [{ assetId: "asset-1", contentHash: "a".repeat(64), version: 1, kind: "image" }],
    }));
    expect(body).toMatchObject({ image_urls: ["https://cdn.example/asset-1.png"] });
    expect(resolveReferenceUrls).toHaveBeenCalledTimes(1);
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
    vi.stubEnv("NOMI_E2E_PRODUCTION_FIXTURE", "1");
    try {
      const fixture = encryptedState();
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
      .rejects.toMatchObject({ code: "apimart_provider_error", message: "APIMart catalog direct-key contract is unavailable; restore the built-in Settings connection" });
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
      .rejects.toMatchObject({ code: "apimart_provider_error", message: "APIMart connection is disabled, missing, or locked" });
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
      .rejects.toMatchObject({ code: "apimart_provider_error", message: "APIMart catalog vendor is unavailable" });
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
        .rejects.toMatchObject({ code: "apimart_provider_error", message: "APIMart connection is disabled, missing, or locked" });
      expect(catalogReader).toHaveBeenCalledTimes(3);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});
