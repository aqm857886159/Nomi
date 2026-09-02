import { createGenerationProviderBootstrap, type GenerationProviderBootstrap } from "./generationProviderBootstrap";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import type { ModuleRegistry, ModuleResolveInput, ResolvedModule } from "./moduleRegistry";
import { readCatalog } from "../catalog/catalogStore";
import type { CatalogState } from "../catalog/types";

/**
 * Runtime view of the generation catalog.
 *
 * Settings writes are allowed while the desktop process is alive.  A provider
 * list captured during app startup therefore becomes stale exactly when a user
 * enters a new APIMart key.  This seam re-reads the catalog at operation
 * boundaries; it does not mutate a running request or churn the tool schema in
 * the middle of a model turn.
 */
export type LiveGenerationRuntime = {
  readBootstrap: () => GenerationProviderBootstrap;
  registry: Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;
};

export type LiveGenerationRuntimeFactories = {
  catalogReader?: () => CatalogState;
  bootstrap?: (state: CatalogState, options: { catalogReader: () => CatalogState }) => GenerationProviderBootstrap;
  registry?: (state: CatalogState, readiness: GenerationProviderBootstrap["readinessByProvider"]) => Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;
};

export function createLiveGenerationRuntime(factories: LiveGenerationRuntimeFactories = {}): LiveGenerationRuntime {
  const catalogReader = factories.catalogReader ?? readCatalog;
  const bootstrap = factories.bootstrap ?? ((state, options) => createGenerationProviderBootstrap(state, options));
  const registryFactory = factories.registry ?? ((state, readiness) => createCatalogModuleRegistry(state, { readinessByProvider: readiness }));

  const readBootstrap = (): GenerationProviderBootstrap => bootstrap(catalogReader(), { catalogReader });
  const readRegistry = () => {
    const state = catalogReader();
    return registryFactory(state, readBootstrap().readinessByProvider);
  };

  // Keep a stable object identity for the planning handler while resolving
  // against a fresh catalog/readiness snapshot for each planning operation.
  const registry: LiveGenerationRuntime["registry"] = {
    resolve: (request: ModuleResolveInput): ResolvedModule => readRegistry().resolve(request),
    snapshot: () => readRegistry().snapshot?.() ?? [],
  };
  return { readBootstrap, registry };
}
