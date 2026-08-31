import { decryptApiKeyRecord } from "../catalog/secrets";
import { readCatalog } from "../catalog/catalogStore";
import type { CatalogState } from "../catalog/types";
import type { GenerationProvider } from "./generationRuntimeAdapter";
import { createApimartGenerationProvider } from "./apimartGenerationProvider";
import type { GenerationProviderReadiness, GenerationProviderReadinessMap } from "./moduleCatalogBootstrap";

export type GenerationProviderBootstrapOptions = {
  apiKeyResolver?: (vendorKey: string) => string;
  fetchImpl?: typeof fetch;
};

export type GenerationProviderBootstrap = {
  providers: readonly GenerationProvider[];
  readinessByProvider: GenerationProviderReadinessMap;
};

const noRecovery = { submitIdempotency: false, query: false, reconcile: false, cancel: false } as const;

function readiness(providerReady: boolean, capabilities: GenerationProviderReadiness["capabilities"], missingForSubmit?: string[]): GenerationProviderReadiness {
  return { providerReady, capabilities, ...(missingForSubmit?.length ? { missingForSubmit } : {}) };
}

/**
 * The only main-process boundary that turns a saved credential into a
 * semantic generation provider. Catalog entries remain visible even when the
 * key is missing or locked; they simply have no executable submit readiness.
 */
export function createGenerationProviderBootstrap(
  state: CatalogState = readCatalog(),
  options: GenerationProviderBootstrapOptions = {},
): GenerationProviderBootstrap {
  const readinessByProvider: Record<string, GenerationProviderReadiness> = {};
  for (const vendor of state.vendors) readinessByProvider[vendor.key] = readiness(false, noRecovery, ["configured_provider"]);
  const providers: GenerationProvider[] = [];
  const apimart = state.vendors.find((vendor) => vendor.key === "apimart" && vendor.enabled);
  const apiKey = options.apiKeyResolver?.("apimart") ?? decryptApiKeyRecord(state.apiKeysByVendor.apimart);
  if (apimart && apiKey.trim()) {
    const provider = createApimartGenerationProvider({ apiKey, baseUrl: apimart.baseUrlHint || undefined, fetchImpl: options.fetchImpl });
    providers.push(provider);
    readinessByProvider.apimart = readiness(true, provider.capabilities);
  }
  return { providers, readinessByProvider };
}
