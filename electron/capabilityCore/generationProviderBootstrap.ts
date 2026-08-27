import { decryptApiKeyRecord } from "../catalog/secrets";
import { readCatalog } from "../catalog/catalogStore";
import type { CatalogState } from "../catalog/types";
import type { GenerationProvider } from "./generationRuntimeAdapter";
import { createApimartGenerationProvider, type ApimartGenerationProviderOptions } from "./apimartGenerationProvider";
import type { GenerationProviderReadiness, GenerationProviderReadinessMap } from "./moduleCatalogBootstrap";

export type GenerationProviderBootstrapOptions = {
  connectionResolver?: (vendorKey: string) => ReturnType<ApimartGenerationProviderOptions["resolveConnection"]>;
  catalogReader?: () => CatalogState;
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
 * semantic generation provider. Bootstrap only checks that an enabled record
 * exists; OS-backed resolution happens inside the provider's first real
 * request, where a locked value becomes a structured provider error.
 */
export function createGenerationProviderBootstrap(
  state: CatalogState = readCatalog(),
  options: GenerationProviderBootstrapOptions = {},
): GenerationProviderBootstrap {
  const readinessByProvider: Record<string, GenerationProviderReadiness> = {};
  for (const vendor of state.vendors) readinessByProvider[vendor.key] = readiness(false, noRecovery, ["configured_provider"]);
  const providers: GenerationProvider[] = [];
  const apimart = state.vendors.find((vendor) => vendor.key === "apimart" && vendor.enabled);
  const apimartCredential = state.apiKeysByVendor.apimart;
  const hasEnabledCredential = Boolean(
    typeof apimartCredential?.apiKey === "string"
      && apimartCredential.apiKey.trim()
      && apimartCredential.enabled !== false,
  );
  if (apimart && hasEnabledCredential) {
    const connectionResolver = options.connectionResolver;
    const catalogReader = options.catalogReader ?? readCatalog;
    const resolveConnection = connectionResolver
      ? () => connectionResolver("apimart")
      : () => {
        const current = catalogReader();
        const vendor = current.vendors.find((candidate) => candidate.key === "apimart" && candidate.enabled);
        const credential = current.apiKeysByVendor.apimart;
        if (!vendor || typeof credential?.apiKey !== "string" || !credential.apiKey.trim() || credential.enabled === false) {
          return null;
        }
        const apiKey = decryptApiKeyRecord(credential).trim();
        return apiKey ? { apiKey, baseUrl: vendor.baseUrlHint || undefined } : null;
      };
    const provider = createApimartGenerationProvider({ resolveConnection, fetchImpl: options.fetchImpl });
    providers.push(provider);
    readinessByProvider.apimart = readiness(true, provider.capabilities);
  }
  return { providers, readinessByProvider };
}
