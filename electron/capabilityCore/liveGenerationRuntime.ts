import { createGenerationProviderBootstrap, type GenerationProviderBootstrap } from "./generationProviderBootstrap";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import type { ModuleRegistry } from "./moduleRegistry";
import type { ExecutionContractV1 } from "./executionContract";
import { createGenerationDefaultModelResolver, type GenerationStoryboardDefault } from "./generationDefaultModelResolver";
import { deriveUsableVideoModelCandidates } from "./usableVideoModelCandidates";
import { catalogRevisionToken, readCatalog } from "../catalog/catalogStore";
import type { CatalogState } from "../catalog/types";
import { createCatalogModelPricingResolver, createCatalogShotPriceResolver } from "../productionRun/catalogPricingResolver";
import type { ModelPricing, ShotPrice } from "../productionRun/shotPricing";
import { readGenerationModelDefaults } from "../settings/generationModelDefaultsSettings";
import type { GenerationDefaultTaskKind } from "../settings/generationModelDefaultsContract";

export type LiveGenerationRegistry = Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;

/**
 * 一次生成调用用的那一版目录——生成规划从目录里要读的东西全在这里，而且是同一版：
 * 模型表、供应商就绪、价格、可用视频候选、默认模型。
 *
 * 规划逻辑不再自己问「现在的目录」：每次调用在入口由 `GenerationCatalogSource.openCall()` 取一版，
 * 之后调用里所有的读都从这个值上读，宿主在调用里做的事（准备授权、开拍、核对）也收到同一个值。
 * 以前这一版靠异步上下文隐式传递，上下文一丢就不出声地改读盘上现在的目录；价格、候选、默认模型
 * 更是两个宿主各自直接读盘——同一次调用里，模型表是入口那一版，价格是后来那一版（2026-11-21 复现）。
 */
export type GenerationCallCatalog = Readonly<{
  registry: LiveGenerationRegistry;
  providerReadiness?: (input: { providerId: string; modelId: string; moduleId: string; mode?: string }) => GenerationProviderBootstrap["readinessByProvider"][string];
  resolveModelPricing?: (providerId: string, modelId: string) => ModelPricing | undefined;
  videoModelCandidates?: ReturnType<typeof deriveUsableVideoModelCandidates>;
  defaultModelForTaskKind?: (taskKind: GenerationDefaultTaskKind) => GenerationStoryboardDefault | undefined;
}>;

/** 真目录某一版：在规划要读的那些之外，再带上宿主在调用里要用的执行器和按合同算价。 */
export type LiveGenerationCallCatalog = Required<GenerationCallCatalog> & Readonly<{
  registry: Required<LiveGenerationRegistry>;
  bootstrap: GenerationProviderBootstrap;
  resolveShotPrice: (contract: ExecutionContractV1) => ShotPrice;
}>;

/** 生成规划拿目录的唯一方式：每次调用开一版。 */
export type GenerationCatalogSource<Call extends GenerationCallCatalog = GenerationCallCatalog> = Readonly<{
  openCall: () => Call;
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
export type LiveGenerationRuntime = GenerationCatalogSource<LiveGenerationCallCatalog> & Readonly<{
  /**
   * 调用之外读「现在的目录」：后台活（调度、落地、打开项目恢复）和调用结束之后才问的地方用它。
   * 调用之内不许用——用调用入口收到的那一版。
   *
   * 2026-11-16：两个宿主以前在启动时各拍一份模型表交给门，Agent 交卡登记的新模型建得了草稿，
   * 到预览 / 过门却被说「Unknown model」，重启才认。所以这里每次问都按现在的目录答（按目录版本缓存）。
   */
  current: () => LiveGenerationCallCatalog;
}>;

export type LiveGenerationRuntimeFactories = {
  catalogReader?: () => CatalogState;
  bootstrap?: (state: CatalogState, options: { catalogReader: () => CatalogState }) => GenerationProviderBootstrap;
  registry?: (state: CatalogState, readiness: GenerationProviderBootstrap["readinessByProvider"]) => Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;
  /** 目录这一版的身份（同一版 = 同一个对象）。缺省：用默认目录读口时取 `catalogRevisionToken`，自带读口时不缓存。 */
  catalogRevision?: () => object;
};

const NOT_CONFIGURED = { providerReady: false, missingForSubmit: ["configured_provider"] } as const;

export function createLiveGenerationRuntime(factories: LiveGenerationRuntimeFactories = {}): LiveGenerationRuntime {
  const catalogReader = factories.catalogReader ?? readCatalog;
  const bootstrap = factories.bootstrap ?? ((state, options) => createGenerationProviderBootstrap(state, options));
  const registryFactory = factories.registry ?? ((state, readiness) => createCatalogModuleRegistry(state, { readinessByProvider: readiness }));

  const buildCall = (): LiveGenerationCallCatalog => {
    const state = catalogReader();
    const capturedBootstrap = bootstrap(state, { catalogReader });
    const capturedRegistry = registryFactory(state, capturedBootstrap.readinessByProvider);
    // 候选和默认模型不是每次调用都用得上，算一次要扫全目录：用到才算，算过就留在这一版上。
    let candidates: ReturnType<typeof deriveUsableVideoModelCandidates> | undefined;
    let defaults: ((taskKind: GenerationDefaultTaskKind) => GenerationStoryboardDefault | undefined) | undefined;
    const resolveModelPricing = createCatalogModelPricingResolver(state.models);
    return {
      registry: {
        resolve: (input) => capturedRegistry.resolve(input),
        snapshot: () => capturedRegistry.snapshot?.() ?? [],
      },
      bootstrap: capturedBootstrap,
      providerReadiness: ({ providerId }) => capturedBootstrap.readinessByProvider[providerId] ?? NOT_CONFIGURED,
      resolveModelPricing,
      resolveShotPrice: createCatalogShotPriceResolver(state.models),
      get videoModelCandidates() { return candidates ??= deriveUsableVideoModelCandidates(state); },
      defaultModelForTaskKind: (taskKind) => (defaults ??= createGenerationDefaultModelResolver(state, readGenerationModelDefaults()))(taskKind),
    };
  };
  // 一次现算要几十到上百毫秒（全目录的就绪判定 + 模型表），一个 40 镜的 Run 每镜预览、过门都要问好几次：
  // 按目录这一版缓存，目录一变（交卡、存密钥、设置页改动）下一次问就重算。
  const revision = factories.catalogRevision ?? (factories.catalogReader ? undefined : catalogRevisionToken);
  let cached: { token: object; call: LiveGenerationCallCatalog } | null = null;
  const current = (): LiveGenerationCallCatalog => {
    const token = revision?.();
    if (token && cached?.token === token) return cached.call;
    const next = buildCall();
    cached = token ? { token, call: next } : null;
    return next;
  };
  return { openCall: current, current };
}
