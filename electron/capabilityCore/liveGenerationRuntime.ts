import { createGenerationProviderBootstrap, type GenerationProviderBootstrap } from "./generationProviderBootstrap";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import type { ModuleRegistry } from "./moduleRegistry";
import { catalogRevisionToken, readCatalog } from "../catalog/catalogStore";
import type { CatalogState } from "../catalog/types";

export type LiveGenerationRegistry = Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;

export type LiveGenerationRuntimeScope = Readonly<{
  /** The immutable provider/readiness view captured for this planning call. */
  readBootstrap: () => GenerationProviderBootstrap;
  /** The immutable catalog-derived module registry captured for this planning call. */
  registry: LiveGenerationRegistry;
}>;

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
  /**
   * Capture one catalog/bootstrap/registry snapshot for one draft lifecycle.
   *
   * This deliberately is a factory rather than a runtime-wide cache: a later
   * planning call starts a new scope and therefore observes catalog changes.
   */
  createDraftScope: () => LiveGenerationRuntimeScope;
  /**
   * 生成工具的门、预览、建草稿读的那一份模型表：每次问都按**现在的**目录答。
   *
   * 2026-11-16：两个宿主（应用内、stdio）以前在启动时各拍一份 `createDraftScope().registry` 交给门，
   * Agent 交卡登记的新模型建得了草稿（建草稿现拍），到预览 / 过门却被说「Unknown model」，重启才认。
   * 宿主只许把这一个交给生成工具，不再自己拍快照。
   */
  registry: LiveGenerationRegistry;
};

export type LiveGenerationRuntimeFactories = {
  catalogReader?: () => CatalogState;
  bootstrap?: (state: CatalogState, options: { catalogReader: () => CatalogState }) => GenerationProviderBootstrap;
  registry?: (state: CatalogState, readiness: GenerationProviderBootstrap["readinessByProvider"]) => Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;
  /** 目录这一版的身份（同一版 = 同一个对象）。缺省：用默认目录读口时取 `catalogRevisionToken`，自带读口时不缓存。 */
  catalogRevision?: () => object;
};

export function createLiveGenerationRuntime(factories: LiveGenerationRuntimeFactories = {}): LiveGenerationRuntime {
  const catalogReader = factories.catalogReader ?? readCatalog;
  const bootstrap = factories.bootstrap ?? ((state, options) => createGenerationProviderBootstrap(state, options));
  const registryFactory = factories.registry ?? ((state, readiness) => createCatalogModuleRegistry(state, { readinessByProvider: readiness }));

  const readBootstrap = (): GenerationProviderBootstrap => bootstrap(catalogReader(), { catalogReader });
  const createDraftScope = (): LiveGenerationRuntimeScope => {
    const state = catalogReader();
    const capturedBootstrap = bootstrap(state, { catalogReader });
    const capturedRegistry = registryFactory(state, capturedBootstrap.readinessByProvider);
    return {
      readBootstrap: () => capturedBootstrap,
      registry: capturedRegistry,
    };
  };
  // 一次现算要几十到上百毫秒（全目录的就绪判定 + 模型表），一个 40 镜的 Run 每镜预览、过门都要问好几次：
  // 按目录这一版缓存，目录一变（交卡、存密钥、设置页改动）下一次问就重算。
  const revision = factories.catalogRevision ?? (factories.catalogReader ? undefined : catalogRevisionToken);
  let cached: { token: object; registry: LiveGenerationRegistry } | null = null;
  const current = (): LiveGenerationRegistry => {
    const token = revision?.();
    if (token && cached?.token === token) return cached.registry;
    const next = createDraftScope().registry;
    cached = token ? { token, registry: next } : null;
    return next;
  };
  const registry: LiveGenerationRegistry = {
    resolve: (input) => current().resolve(input),
    snapshot: () => current().snapshot?.() ?? [],
  };
  return { readBootstrap, createDraftScope, registry };
}
