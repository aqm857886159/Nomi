import { apiKeyDecryptStatus, decryptApiKeyRecord } from "../catalog/secrets";
import { readCatalog } from "../catalog/catalogStore";
import type { CatalogState } from "../catalog/types";
import { builtinVendorScopeMatches, isBuiltinDirectKeyVendor } from "../catalog/builtinVendorSeeds";
import { hasBuiltinCuratedExecution } from "../catalog/seedBuiltins";
import type { GenerationProvider } from "./generationRuntimeAdapter";
import {
  createApimartGenerationProvider,
  type ApimartGenerationProviderOptions,
  type ApimartReferenceUrlResolver,
} from "./apimartGenerationProvider";
import type { GenerationProviderReadiness, GenerationProviderReadinessMap } from "./moduleCatalogBootstrap";
import { modelHasPublishedExecution } from "../shared/modelPublication";

export type GenerationProviderBootstrapOptions = {
  connectionResolver?: (vendorKey: string) => ReturnType<ApimartGenerationProviderOptions["resolveConnection"]>;
  catalogReader?: () => CatalogState;
  fetchImpl?: typeof fetch;
  /** Optional project-scoped resolver; URLs must be localized before buildRequest/approval. */
  resolveReferenceUrls?: ApimartReferenceUrlResolver;
  /**
   * Zero-cost Electron journey seam: keep the catalog's built-in APIMart
   * scope and curated mapping intact while routing the decrypted Settings key
   * to a loopback fixture. It is accepted only under the explicit production
   * fixture flag and only for a loopback URL; normal users cannot retarget the
   * direct-key provider through this option.
   */
  fixtureBaseUrlOverride?: string;
};

export type GenerationProviderBootstrap = {
  providers: readonly GenerationProvider[];
  readinessByProvider: GenerationProviderReadinessMap;
};

const noRecovery = { submitIdempotency: false, query: false, reconcile: false, cancel: false } as const;

function readiness(providerReady: boolean, capabilities: GenerationProviderReadiness["capabilities"], missingForSubmit?: string[]): GenerationProviderReadiness {
  return { providerReady, capabilities, ...(missingForSubmit?.length ? { missingForSubmit } : {}) };
}

function hasAdapter(meta: unknown): boolean {
  return Boolean(meta && typeof meta === "object" && !Array.isArray(meta)
    && Object.prototype.hasOwnProperty.call(meta, "adapter"));
}

function hasCertificationOwnedConnection(state: CatalogState, vendorKey: string): boolean {
  return state.vendors.some((vendor) => vendor.key === vendorKey && hasAdapter(vendor.meta))
    || state.models.some((model) => model.vendorKey === vendorKey && hasAdapter(model.meta));
}

function hasPublishedExecutionForProvider(state: CatalogState, vendorKey: string): boolean {
  // The APIMart provider below is a direct-key, code-owned transport. A
  // certification-owned APIMart row must be served by the certification
  // adapter instead; treating its published metadata as APIMart execution
  // would silently force Bearer auth and canonical APIMart paths.
  if (isBuiltinDirectKeyVendor(vendorKey)) return hasBuiltinCuratedExecution(state, vendorKey);
  return state.models.some((model) => model.vendorKey === vendorKey
    && modelHasPublishedExecution(model, { mappings: state.mappings }));
}

function hasSafeDirectKeyScope(state: CatalogState, vendorKey: string): boolean {
  if (!isBuiltinDirectKeyVendor(vendorKey)) return true;
  const vendor = state.vendors.find((candidate) => candidate.key === vendorKey);
  if (!vendor) return false;
  return !hasCertificationOwnedConnection(state, vendorKey) && builtinVendorScopeMatches(vendor);
}

function safeFixtureBaseUrl(value: unknown): string | undefined {
  if (process.env.NOMI_E2E_PRODUCTION_FIXTURE !== "1" || typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/**
 * The only main-process boundary that turns a saved credential into a
 * semantic generation provider. Bootstrap checks the persisted encrypted
 * credential and code-owned contract, while OS-backed resolution still happens
 * inside the provider's first real request, where a locked value becomes a
 * structured provider error.
 */
export function createGenerationProviderBootstrap(
  state: CatalogState = readCatalog(),
  options: GenerationProviderBootstrapOptions = {},
): GenerationProviderBootstrap {
  const readinessByProvider: Record<string, GenerationProviderReadiness> = {};
  for (const vendor of state.vendors) readinessByProvider[vendor.key] = readiness(false, noRecovery, ["configured_provider"]);
  const providers: GenerationProvider[] = [];
  const apimart = state.vendors.find((vendor) => vendor.key === "apimart" && vendor.enabled);
  const hasPublishedModel = hasPublishedExecutionForProvider(state, "apimart");
  const apimartCredential = state.apiKeysByVendor.apimart;
  const hasEnabledCredential = Boolean(
    typeof apimartCredential?.apiKey === "string"
      && apimartCredential.apiKey.trim()
      && apimartCredential.enabled === true
      && apiKeyDecryptStatus(apimartCredential) === "ok",
  );
  if (apimart && hasEnabledCredential && hasPublishedModel && hasSafeDirectKeyScope(state, "apimart")) {
    const connectionResolver = options.connectionResolver;
    const catalogReader = options.catalogReader ?? readCatalog;
    const fixtureBaseUrl = safeFixtureBaseUrl(options.fixtureBaseUrlOverride);
    const resolveConnection = connectionResolver
      ? () => connectionResolver("apimart")
      : () => {
        const current = catalogReader();
        const vendor = current.vendors.find((candidate) => candidate.key === "apimart" && candidate.enabled);
        const credential = current.apiKeysByVendor.apimart;
        if (!vendor || typeof credential?.apiKey !== "string" || !credential.apiKey.trim()
          || credential.enabled !== true || apiKeyDecryptStatus(credential) !== "ok") {
          return null;
        }
        if (hasCertificationOwnedConnection(current, "apimart")
          || !builtinVendorScopeMatches(vendor)
          || !hasBuiltinCuratedExecution(current, "apimart")) {
          return null;
        }
        const apiKey = decryptApiKeyRecord(credential).trim();
        return apiKey ? { apiKey, baseUrl: (fixtureBaseUrl ?? vendor.baseUrlHint) || undefined } : null;
      };
    const provider = createApimartGenerationProvider({
      resolveConnection,
      fixtureBaseUrlOverride: fixtureBaseUrl,
      // Keep provider capability/mode resolution on the same live catalog
      // snapshot used for the credential. This prevents a submit from
      // silently falling back to a stale bundled catalog after settings are
      // changed in the desktop app.
      catalogReader,
      fetchImpl: options.fetchImpl,
      resolveReferenceUrls: options.resolveReferenceUrls,
    });
    providers.push(provider);
    readinessByProvider.apimart = readiness(true, provider.capabilities);
  }
  return { providers, readinessByProvider };
}
