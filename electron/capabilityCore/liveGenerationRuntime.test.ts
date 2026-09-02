import { describe, expect, it } from "vitest";

import type { GenerationProviderBootstrap } from "./generationProviderBootstrap";
import type { CatalogState } from "../catalog/types";
import { createLiveGenerationRuntime } from "./liveGenerationRuntime";

function catalog(marker: string): CatalogState {
  return {
    version: 1,
    vendors: [],
    models: [],
    mappings: [],
    apiKeysByVendor: {},
    // The test-only marker lets the fake factories make the change visible
    // without ever constructing a credential or touching the OS keychain.
    ...(marker ? ({ meta: { marker } } as never) : {}),
  };
}

function fakeBootstrap(state: CatalogState): GenerationProviderBootstrap {
  const marker = (state as CatalogState & { meta?: { marker?: string } }).meta?.marker;
  return {
    providers: marker === "connected" ? [{ providerId: "apimart", capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false }, buildRequest: () => ({}), submit: async () => ({ providerTaskId: "fixture" }) }] : [],
    readinessByProvider: { apimart: { providerReady: marker === "connected", capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false }, ...(marker === "connected" ? {} : { missingForSubmit: ["configured_provider"] }) } },
  };
}

describe("live generation runtime", () => {
  it("re-reads readiness after a Settings credential write without replacing the planning object", () => {
    let current = catalog("empty");
    const runtime = createLiveGenerationRuntime({
      catalogReader: () => current,
      bootstrap: fakeBootstrap,
      registry: (_state, readiness) => ({
        resolve: () => ({
          moduleId: "generation.single-shot",
          version: "fixture",
          providerId: "apimart",
          modelId: "fixture-model",
          mode: "text-to-image",
          inputKinds: ["image"],
          outputKinds: ["image"],
          parameterSchema: {},
          assetInputSchema: { references: { kind: "asset" } },
          capabilities: readiness.apimart?.capabilities ?? { submitIdempotency: false, query: false, reconcile: false, cancel: false },
        }),
        snapshot: () => [],
      }),
    });

    const planningRegistry = runtime.registry;
    expect(runtime.readBootstrap().providers).toHaveLength(0);
    expect(runtime.readBootstrap().readinessByProvider.apimart?.providerReady).toBe(false);

    current = catalog("connected");
    expect(runtime.registry).toBe(planningRegistry);
    expect(runtime.readBootstrap().providers).toHaveLength(1);
    expect(runtime.readBootstrap().readinessByProvider.apimart?.providerReady).toBe(true);
    expect(planningRegistry.resolve({ moduleId: "generation.single-shot", providerId: "apimart", modelId: "fixture-model", mode: "text-to-image" }).capabilities.query).toBe(true);
  });
});
