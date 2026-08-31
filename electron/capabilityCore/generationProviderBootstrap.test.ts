import { describe, expect, it } from "vitest";

import { createGenerationProviderBootstrap } from "./generationProviderBootstrap";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import type { CatalogState } from "../catalog/types";

function state(apiKey = ""): CatalogState {
  return {
    version: 9,
    vendors: [{ key: "apimart", name: "APIMart", enabled: true, baseUrlHint: "https://api.apimart.ai", authType: "bearer" }],
    models: [{ modelKey: "gpt-image-2", vendorKey: "apimart", labelZh: "GPT Image 2", kind: "image", enabled: true, onboarding: { addedVia: "manual", addedAt: "now", fields: [{ key: "aspectRatio", displayName: "比例", type: "select", options: [{ value: "1:1", label: "1:1" }] }] }, createdAt: "now", updatedAt: "now" }],
    mappings: [{ id: "mapping", vendorKey: "apimart", modelKey: "gpt-image-2", taskKind: "text-to-image", name: "image", enabled: true, create: { method: "POST", path: "/v1/images/generations", body: {} }, createdAt: "now", updatedAt: "now" }],
    apiKeysByVendor: apiKey ? { apimart: { vendorKey: "apimart", apiKey, enc: "plain", enabled: true, createdAt: "now", updatedAt: "now" } } : {},
  };
}

describe("generation provider bootstrap", () => {
  it("keeps a visible catalog provider but no executable adapter when the key is missing", () => {
    const boot = createGenerationProviderBootstrap(state());
    expect(boot.providers).toHaveLength(0);
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: false, missingForSubmit: ["configured_provider"] });
    expect(createCatalogModuleRegistry(state(), { readinessByProvider: boot.readinessByProvider }).resolve({ moduleId: "generation.single-shot", providerId: "apimart", modelId: "gpt-image-2", mode: "text-to-image" })).toMatchObject({ providerId: "apimart", modelId: "gpt-image-2" });
  });

  it("proves only the capabilities implemented by the APIMart adapter", () => {
    const boot = createGenerationProviderBootstrap(state("test-key"), { apiKeyResolver: () => "test-key" });
    expect(boot.providers).toHaveLength(1);
    expect(boot.providers[0]?.capabilities).toEqual({ submitIdempotency: false, query: true, reconcile: true, cancel: false, materialize: true });
    expect(boot.readinessByProvider.apimart).toMatchObject({ providerReady: true, capabilities: { query: true, reconcile: true, cancel: false } });
  });
});
