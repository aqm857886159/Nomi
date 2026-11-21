/**
 * 测试用：拿一张静态模型表当「这次调用的那一版目录」。
 *
 * 静态表本来就只有一版，所以每次 `openCall()` 回同一个值。只给测规划逻辑本身的测试用——
 * 它造出来的规划交不进两个宿主用到规划的那几个位置（那里只认生成装配工厂发的，见 `generationDomain.ts`）。
 */
import type { GenerationCallCatalog, GenerationCatalogSource } from "./liveGenerationRuntime";
import type { GenerationPlanningCallDependencies, GenerationPlanningHandlerDependencies } from "./mcpGenerationTools";

type CatalogOwned = "registry" | "providerReadiness" | "videoModelCandidates" | "defaultModelForTaskKind" | "resolveModelPricing";
const CATALOG_OWNED: readonly string[] = ["registry", "providerReadiness", "videoModelCandidates", "defaultModelForTaskKind", "resolveModelPricing"] satisfies readonly CatalogOwned[];

/** 一张静态表 → 目录来源（可带上价格、候选、默认模型、就绪这几样，都算同一版）。 */
export function fixedCatalogCall(
  registry: GenerationCallCatalog["registry"],
  extras: Omit<GenerationCallCatalog, "registry"> = {},
): GenerationCatalogSource {
  const call = Object.defineProperties({ registry }, Object.getOwnPropertyDescriptors(extras)) as GenerationCallCatalog;
  return { openCall: () => call };
}

/** 旧写法的依赖（模型表等五样直接写在上面）→ 装配规划逻辑要的形状。访问器原样搬（不提前求值）。 */
export function withFixedCatalog(deps: GenerationPlanningCallDependencies): GenerationPlanningHandlerDependencies {
  const call = {};
  const rest = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(deps))) {
    Object.defineProperty(CATALOG_OWNED.includes(key) ? call : rest, key, descriptor);
  }
  return Object.defineProperty(rest, "catalog", { value: { openCall: () => call as GenerationCallCatalog }, enumerable: true }) as GenerationPlanningHandlerDependencies;
}
