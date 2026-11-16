import { AsyncLocalStorage } from "node:async_hooks";
import { createGenerationProviderBootstrap, type GenerationProviderBootstrap } from "./generationProviderBootstrap";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import type { ModuleRegistry } from "./moduleRegistry";
import { catalogRevisionToken, readCatalog } from "../catalog/catalogStore";
import type { CatalogState } from "../catalog/types";

export type LiveGenerationRegistry = Pick<ModuleRegistry, "resolve"> & Partial<Pick<ModuleRegistry, "snapshot">>;

/**
 * 生成工具读的那一份目录（2026-11-16 起它是工具唯一的目录来源）。
 *
 * `pinForCall` 有就用：一次工具调用（起草 / 预览 / 过门……）在入口取一版目录，调用里所有的
 * resolve / snapshot / 宿主读就绪（`readBootstrap`）都读这一版；调用结束就放开，之后的问读现在的目录。
 * 测试里的静态表没有它——静态表本来就只有一版。
 */
export type GenerationCatalogRegistry = LiveGenerationRegistry & {
  pinForCall?: <T>(run: () => Promise<T>) => Promise<T>;
};

/** 目录某一版算出来的就绪判定和模型表（两者同一版，一起换）。 */
type CatalogScope = Readonly<{
  readBootstrap: () => GenerationProviderBootstrap;
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
  /** 宿主读就绪：一次工具调用之内读钉住的那一版，之外读现在的目录。 */
  readBootstrap: () => GenerationProviderBootstrap;
  /**
   * 生成工具读的那一份模型表：调用之外每次问都按**现在的**目录答；一次工具调用之内由 `pinForCall` 钉住一版。
   *
   * 2026-11-16：两个宿主（应用内、stdio）以前在启动时各拍一份模型表交给门，
   * Agent 交卡登记的新模型建得了草稿（建草稿现拍），到预览 / 过门却被说「Unknown model」，重启才认。
   * 宿主只许把这一个交给生成工具，不再自己拍快照；生成工具也不再另收一个「起草用的」来源。
   */
  registry: Required<GenerationCatalogRegistry>;
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

  const buildScope = (): CatalogScope => {
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
  let cached: { token: object; scope: CatalogScope } | null = null;
  const current = (): CatalogScope => {
    const token = revision?.();
    if (token && cached?.token === token) return cached.scope;
    const next = buildScope();
    cached = token ? { token, scope: next } : null;
    return next;
  };
  // 一次工具调用钉住的那一版。调用结束把 `open` 关掉：调用里顺手起的后台活（调度、落地）之后再问，
  // 读的是那时的目录，不会一直拿着这次调用的旧版本。
  const callCatalog = new AsyncLocalStorage<{ scope: CatalogScope; open: boolean }>();
  const pinned = (): CatalogScope | undefined => {
    const frame = callCatalog.getStore();
    return frame?.open ? frame.scope : undefined;
  };
  const readBootstrap = (): GenerationProviderBootstrap => pinned()?.readBootstrap() ?? bootstrap(catalogReader(), { catalogReader });
  const view = (): LiveGenerationRegistry => (pinned() ?? current()).registry;
  const registry = {
    resolve: (input: Parameters<LiveGenerationRegistry["resolve"]>[0]) => view().resolve(input),
    snapshot: () => view().snapshot?.() ?? [],
    pinForCall: async <T>(run: () => Promise<T>): Promise<T> => {
      if (pinned()) return run(); // 调用里再进一次工具：沿用外层那一版
      const frame = { scope: current(), open: true };
      try {
        return await callCatalog.run(frame, run);
      } finally {
        frame.open = false;
      }
    },
  };
  return { readBootstrap, registry };
}
