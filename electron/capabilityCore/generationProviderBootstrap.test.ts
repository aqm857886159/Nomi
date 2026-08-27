import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGenerationProviderBootstrap } from "./generationProviderBootstrap";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import type { CatalogState } from "../catalog/types";

const secretMocks = vi.hoisted(() => ({
  decryptApiKeyRecord: vi.fn((record?: { apiKey?: string }) => record?.apiKey ?? ""),
}));
vi.mock("../catalog/secrets", () => ({ decryptApiKeyRecord: secretMocks.decryptApiKeyRecord }));

function state(apiKey = ""): CatalogState {
  return {
    version: 9,
    vendors: [{ key: "apimart", name: "APIMart", enabled: true, baseUrlHint: "https://api.apimart.ai", authType: "bearer", createdAt: "now", updatedAt: "now" }],
    models: [{ modelKey: "gpt-image-2", vendorKey: "apimart", labelZh: "GPT Image 2", kind: "image", enabled: true, onboarding: { addedVia: "manual", addedAt: "now", fields: [{ key: "aspectRatio", displayName: "比例", type: "select", options: [{ value: "1:1", label: "1:1" }], evidence: { field: "aspectRatio", evidence: "test fixture", evidence_location: "fixture", confidence: "high" } }] }, createdAt: "now", updatedAt: "now" }],
    mappings: [{ id: "mapping", vendorKey: "apimart", modelKey: "gpt-image-2", taskKind: "text_to_image", name: "image", enabled: true, create: { method: "POST", path: "/v1/images/generations", body: {} }, createdAt: "now", updatedAt: "now" }],
    apiKeysByVendor: apiKey ? { apimart: { vendorKey: "apimart", apiKey, enc: "plain", enabled: true, createdAt: "now", updatedAt: "now" } } : {},
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

describe("generation provider bootstrap", () => {
  beforeEach(() => {
    secretMocks.decryptApiKeyRecord.mockReset().mockImplementation((record?: { apiKey?: string }) => record?.apiKey ?? "");
  });

  it("keeps a visible catalog provider but no executable adapter when the key is missing", () => {
    const boot = createGenerationProviderBootstrap(state());
    expect(boot.providers).toHaveLength(0);
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: false, missingForSubmit: ["configured_provider"] });
    expect(createCatalogModuleRegistry(state(), { readinessByProvider: boot.readinessByProvider }).resolve({ moduleId: "generation.single-shot", providerId: "apimart", modelId: "gpt-image-2", mode: "text_to_image" })).toMatchObject({ providerId: "apimart", modelId: "gpt-image-2" });
  });

  it("proves only the capabilities implemented by the APIMart adapter", () => {
    const boot = createGenerationProviderBootstrap(state("test-key"), { connectionResolver: () => ({ apiKey: "test-key" }) });
    expect(boot.providers).toHaveLength(1);
    expect(boot.providers[0]?.capabilities).toEqual({ submitIdempotency: false, query: true, reconcile: true, cancel: false, materialize: true });
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: true, capabilities: { query: true, reconcile: true, cancel: false } });
  });

  it("registers an enabled encrypted credential without resolving it until the first network request", async () => {
    const connectionResolver = vi.fn(() => ({ apiKey: "decrypted-at-request-time" }));
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      code: 200,
      data: [{ status: "submitted", task_id: "task-lazy" }],
    }), { status: 200 }));

    const boot = createGenerationProviderBootstrap(encryptedState(), { connectionResolver, fetchImpl });
    const provider = boot.providers[0];

    expect(provider).toBeDefined();
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: true });
    expect(connectionResolver).not.toHaveBeenCalled();
    provider?.buildRequest({
      moduleId: "generation.single-shot",
      providerId: "apimart",
      modelId: "gpt-image-2",
      mode: "text-to-image",
      prompt: "paper crane",
      parameters: {},
      references: [],
      contractHash: "a".repeat(64),
      idempotencyKey: "stable-key",
      requestFingerprint: "b".repeat(64),
      executionBinding: {
        immutableProjectUuid: "project-1",
        projectGeneration: 1,
        runId: "run-1",
        shotId: "shot-1",
        contractHash: "a".repeat(64),
        runtimeTaskId: "runtime-1",
        providerNamespace: "apimart",
        providerIdempotencyKey: "stable-key",
        requestFingerprint: "b".repeat(64),
        runtimeEnvelopeRef: ".nomi/runs/run-1/runtime.json",
        fencingEpoch: 1,
      },
    });
    await provider?.materialize?.({ providerTaskId: "task-lazy", raw: { data: { result: { images: [] } } } });
    expect(connectionResolver).not.toHaveBeenCalled();

    await expect(provider?.submit({ model: "gpt-image-2", prompt: "paper crane" }, "stable-key"))
      .resolves.toMatchObject({ providerTaskId: "task-lazy" });
    expect(connectionResolver).toHaveBeenCalledTimes(1);
    expect(connectionResolver).toHaveBeenCalledWith("apimart");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer decrypted-at-request-time" });
  });

  it("keeps the production default resolver lazy and resolves URL plus auth from one request-time snapshot", async () => {
    const live = encryptedState();
    live.vendors[0] = { ...live.vendors[0], baseUrlHint: "https://live.apimart.example" };
    const catalogReader = vi.fn(() => live);
    secretMocks.decryptApiKeyRecord.mockReturnValue("decrypted-production-key");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      code: 200,
      data: [{ status: "submitted", task_id: "task-production-default" }],
    }), { status: 200 }));

    const boot = createGenerationProviderBootstrap(encryptedState(), { catalogReader, fetchImpl });
    const provider = boot.providers[0];

    expect(provider).toBeDefined();
    expect(catalogReader).not.toHaveBeenCalled();
    expect(secretMocks.decryptApiKeyRecord).not.toHaveBeenCalled();

    await expect(provider?.submit({ model: "gpt-image-2", prompt: "paper crane" }, "stable-key"))
      .resolves.toMatchObject({ providerTaskId: "task-production-default" });
    expect(catalogReader).toHaveBeenCalledTimes(1);
    expect(secretMocks.decryptApiKeyRecord).toHaveBeenCalledTimes(1);
    expect(secretMocks.decryptApiKeyRecord).toHaveBeenCalledWith(live.apiKeysByVendor.apimart);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://live.apimart.example/v1/images/generations",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer decrypted-production-key" }) }),
    );
  });

  it("surfaces a locked encrypted credential as a provider error on the first request", async () => {
    const connectionResolver = vi.fn(() => null);
    const fetchImpl = vi.fn();
    const boot = createGenerationProviderBootstrap(encryptedState(), { connectionResolver, fetchImpl });
    const provider = boot.providers[0];

    expect(provider).toBeDefined();
    expect(connectionResolver).not.toHaveBeenCalled();
    await expect(provider?.submit({ model: "gpt-image-2", prompt: "paper crane" }, "stable-key"))
      .rejects.toMatchObject({ code: "apimart_provider_error", message: "APIMart connection is disabled, missing, or locked" });
    expect(connectionResolver).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the endpoint and credential from one live catalog snapshot on each real request", async () => {
    const current = encryptedState();
    current.vendors[0] = { ...current.vendors[0], baseUrlHint: "https://new-endpoint.example" };
    current.apiKeysByVendor.apimart = {
      ...current.apiKeysByVendor.apimart,
      apiKey: "new-endpoint-key",
      enc: "plain",
    };
    const catalogReader = vi.fn(() => current);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      code: 200,
      data: [{ status: "submitted", task_id: "task-current-snapshot" }],
    }), { status: 200 }));
    const boot = createGenerationProviderBootstrap(encryptedState(), { catalogReader, fetchImpl });
    const provider = boot.providers[0];

    expect(catalogReader).not.toHaveBeenCalled();
    await expect(provider?.submit({ model: "gpt-image-2", prompt: "paper crane" }, "stable-key"))
      .resolves.toMatchObject({ providerTaskId: "task-current-snapshot" });
    expect(catalogReader).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://new-endpoint.example/v1/images/generations",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer new-endpoint-key" }) }),
    );
  });

  it("fails closed before fetch when the live catalog snapshot disables the vendor", async () => {
    const current = encryptedState();
    current.vendors[0] = { ...current.vendors[0], enabled: false };
    const catalogReader = vi.fn(() => current);
    const fetchImpl = vi.fn();
    const boot = createGenerationProviderBootstrap(encryptedState(), { catalogReader, fetchImpl });
    const provider = boot.providers[0];

    expect(provider).toBeDefined();
    await expect(provider?.submit({ model: "gpt-image-2", prompt: "paper crane" }, "stable-key"))
      .rejects.toMatchObject({ code: "apimart_provider_error", message: "APIMart connection is disabled, missing, or locked" });
    expect(catalogReader).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["disabled", "missing"] as const)(
    "fails closed before fetch when the live credential is %s",
    async (credentialState) => {
      const current = encryptedState();
      if (credentialState === "disabled") {
        current.apiKeysByVendor.apimart = { ...current.apiKeysByVendor.apimart!, enabled: false };
      } else {
        delete current.apiKeysByVendor.apimart;
      }
      const catalogReader = vi.fn(() => current);
      const fetchImpl = vi.fn();
      const boot = createGenerationProviderBootstrap(encryptedState(), { catalogReader, fetchImpl });
      const provider = boot.providers[0];

      await expect(provider?.submit({ model: "gpt-image-2", prompt: "paper crane" }, "stable-key"))
        .rejects.toMatchObject({ code: "apimart_provider_error", message: "APIMart connection is disabled, missing, or locked" });
      expect(catalogReader).toHaveBeenCalledTimes(1);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});
