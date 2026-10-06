import { createModuleRegistry } from "./moduleRegistry";
import type { ModuleManifest } from "./moduleManifest";
import type { GenerationProviderCapabilities } from "./generationRuntimeAdapter";
import { readCatalog } from "../catalog/catalogStore";
import { wireReferencedParamKeys, consumedCanonicalKeys } from "../catalog/paramTranslate";
import { ARCHETYPE_WIRE_DEFAULTS } from "../catalog/archetypeWireDefaults.generated";
import type { CatalogState, Mapping, Model, ProfileKind } from "../catalog/types";
import { createCatalogAvailability } from "../catalog/catalogModelAvailability";
import { isCredentialReason } from "../shared/modelAvailability";
import { derivePublishedExecution } from "../shared/modelPublication";
import { SINGLE_SHOT_GENERATION_MODULE_ID } from "../shared/generationModuleId";

/**
 * Built-ins are passed in by the application bootstrap. This keeps provider/model
 * discovery explicit and testable; this function never fetches or installs code.
 */
export function createBuiltinModuleRegistry(manifests: readonly ModuleManifest[] = []) {
  return createModuleRegistry(manifests);
}

const SINGLE_SHOT_MODULE_ID = SINGLE_SHOT_GENERATION_MODULE_ID;

export type GenerationProviderReadiness = {
  providerReady: boolean;
  capabilities: GenerationProviderCapabilities;
  missingForSubmit?: string[];
};

export type GenerationProviderReadinessMap = Readonly<Record<string, GenerationProviderReadiness>>;

function parameterType(field: NonNullable<Model["onboarding"]>["fields"][number]): "string" | "number" | "boolean" | "enum" {
  if (field.type === "number") return "number";
  if (field.type === "boolean") return "boolean";
  if (field.type === "select") return "enum";
  return "string";
}

/**
 * 一个模型在 Run 路径上的**合法参数表**。
 *
 * 2026-09-21 之前这张表只从 `model.onboarding.fields` + `mapping.create.defaultParams` 派生，而用户真实
 * 目录里 165 个模型只有 3 个有 `onboarding.fields`、270 条 mapping 只有 12 条有 `defaultParams`——也就是
 * 说**绝大多数模型的这张表是空的**，于是 `compileParameters` 把用户在付款卡上改的每一个参数都当成
 * 「这个模型不支持」丢掉（卡上选 2K → 供应商收到 1k → 节点还印着 2K，花的是真钱）。
 *
 * 权威来源本来就在手边，而且**和手动画布那条路读的是同一份声明**：
 *  ① `wireReferencedParamKeys(mapping.create)` —— 这条 create op 的 body 与进程型 transport 的 argv 里
 *     所有 `{{request.params.X}}` 引用的键。一个键要是这里没出现，它根本发不出去；出现了，它就是合法的。
 *     （`electron/runtime.ts` 的手动路把 extras 原样交给 `buildProfileHttpRequest` 渲染同一批令牌。）
 *  ② `consumedCanonicalKeys(paramMap)` + `paramMap.drops` —— 经参数映射改名/丢弃的那些键同样合法
 *     （与 `apimartGenerationProjection.normalizeParameters` 的判据逐条同源，否则会出现
 *     「合同放行、运输拒收」这种两道门各答一次的裂缝）。
 *  ③ 档案 wire 默认 `ARCHETYPE_WIRE_DEFAULTS[archetypeId][taskKind][vendorKey|"*"]` —— 档案声明过默认值的
 *     那些键（手动路的 `applyHeadlessParamDefaults` 兜底填的就是它们）。
 *  ④ 既有的 `onboarding.fields`（带类型与选项，**类型信息最强，优先**）与 `defaultParams`。
 *
 * 类型这一栏只在我们**真的知道**的时候才写死：`onboarding.fields` 声明了控件类型与选项 → 照抄；
 * `defaultParams` 有值 → 按值的类型；只由线缆模板得知的键 → `"any"`。写一个猜出来的类型等于凭空造出
 * 第二份真相源，会把手动路照发、Run 路拒收的裂缝换个地方再长一次。
 */
function wireDefaultKeysFor(model: Model, mapping: Mapping): readonly string[] {
  const archetypeId = model.meta && typeof model.meta === "object" && !Array.isArray(model.meta)
    ? (model.meta as Record<string, unknown>).archetypeId
    : undefined;
  if (typeof archetypeId !== "string" || !archetypeId) return [];
  const perKind = ARCHETYPE_WIRE_DEFAULTS[archetypeId]?.[mapping.taskKind];
  if (!perKind) return [];
  return Object.keys(perKind[mapping.vendorKey] ?? perKind["*"] ?? {});
}

function modelParameterSchema(model: Model, mappings: readonly Mapping[]) {
  const schema: Record<string, { type: "string" | "number" | "boolean" | "enum" | "any"; enum?: string[] }> = {};
  for (const field of model.onboarding?.fields ?? []) {
    schema[field.key] = {
      type: parameterType(field),
      ...(field.options?.length ? { enum: field.options.map((option) => option.value) } : {}),
    };
  }
  // Mapping defaults are already user/catalog-owned declarations. They fill the
  // schema only when onboarding has no richer field description for that key.
  for (const mapping of mappings) {
    for (const [key, value] of Object.entries(mapping.create.defaultParams ?? {})) {
      if (schema[key]) continue;
      const type = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
      schema[key] = { type };
    }
  }
  // 线缆模板与档案默认只能证明「这个键送得出去」，证明不了它的取值域——记成 `any`，取值由供应商裁决，
  // 我们不替它编一份枚举。
  for (const mapping of mappings) {
    for (const key of [
      ...wireReferencedParamKeys(mapping.create),
      ...consumedCanonicalKeys(mapping.create.paramMap),
      ...(mapping.create.paramMap?.drops ?? []),
      ...wireDefaultKeysFor(model, mapping),
    ]) {
      if (schema[key]) continue;
      schema[key] = { type: "any" };
    }
  }
  return schema;
}

function manifestFromCatalog(state: CatalogState, readinessByProvider: GenerationProviderReadinessMap = {}): ModuleManifest | null {
  // The semantic registry is the source used by natural-language fallback
  // selection.  Keep it in lock-step with the executable catalog: a model is
  // visible only when its vendor is enabled and at least one *specific mode*
  // is published.  The previous model-level boolean admitted disabled vendors
  // and disabled task mappings, so a short request could select a mode that
  // preview accepted but the provider could never execute.
  // One registry build represents one immutable catalog snapshot. Reuse the
  // publication verdict for that snapshot instead of rebuilding the model's
  // evidence set in every filter/map pass below. The cache is local to this
  // manifest build; it is never shared across draft lifecycles or catalog
  // changes.
  const publishedModesByModel = new WeakMap<object, ProfileKind[]>();
  const publishedModesFor = (model: Model): ProfileKind[] => {
    const cached = publishedModesByModel.get(model);
    if (cached) return cached;
    const publishedModes = derivePublishedExecution(model, { mappings: state.mappings }).publishedModes;
    publishedModesByModel.set(model, publishedModes);
    return publishedModes;
  };
  // 「能不能用」交给唯一那道闸，不再自己拼 `model.enabled && vendor.enabled`（那是 P0-10 那一族副本之一）。
  //
  // 唯一刻意放行的是**钥匙那几档**：这一层答的是「目录声明了什么能力」，不是「此刻跑不跑得动」。
  // 跑不跑得动由上一层 `generationProviderBootstrap` 的 readinessByProvider 答——它必须能区分
  // 「目录里有这个模型、只是还没填 key」和「根本没有这个模型」，前者要指路去填 key，
  // 后者才是「不存在」。放行哪几档用 owner 的封闭枚举点名（`isCredentialReason`），
  // 不在这里重写一遍「什么算没钥匙」。
  const availability = createCatalogAvailability(state);
  const declaredInCatalog = (model: Model): boolean => {
    const result = availability.of(model);
    return result.usable || isCredentialReason(result.reason);
  };
  const enabledModels = state.models.filter((model) =>
    declaredInCatalog(model) && publishedModesFor(model).length > 0,
  );
  if (!enabledModels.length) return null;
  const enabledModelKeys = new Set(enabledModels.map((model) => `${model.vendorKey}\u0000${model.modelKey}`));
  const mappingsFor = (model: Model) => state.mappings.filter((mapping) =>
    mapping.vendorKey === model.vendorKey
    && mapping.enabled
    && publishedModesFor(model).includes(mapping.taskKind)
    && enabledModelKeys.has(`${model.vendorKey}\u0000${model.modelKey}`)
    && (mapping.modelKey === undefined || mapping.modelKey === "" || mapping.modelKey === model.modelKey || mapping.modelKey === model.modelAlias),
  );
  const modes = [...new Set(enabledModels.flatMap((model) => publishedModesFor(model)))];
  const providers = [...new Map(enabledModels.map((model) => {
    const models = enabledModels.filter((candidate) => candidate.vendorKey === model.vendorKey).map((candidate) => {
      const mappings = mappingsFor(candidate);
      const declaredModes = publishedModesFor(candidate);
      return {
        modelId: candidate.modelKey,
        modes: declaredModes,
        parameterSchema: modelParameterSchema(candidate, mappings),
        // Catalog mappings describe wire shape, not proof of native recovery.
        // A bootstrap adapter may prove a subset; absent proof stays false while
        // the model remains visible and submit remains a separate readiness check.
        capabilities: readinessByProvider[model.vendorKey]?.capabilities ?? { submitIdempotency: false, query: false, reconcile: false, cancel: false },
      };
    });
    return [model.vendorKey, { providerId: model.vendorKey, models }];
  }))].map(([, provider]) => provider);
  return {
    moduleId: SINGLE_SHOT_MODULE_ID,
    version: `catalog-${state.version}`,
    inputKinds: [...new Set(enabledModels.map((model) => model.kind))],
    outputKinds: [...new Set(enabledModels.map((model) => model.kind))],
    modes,
    parameterSchema: {},
    assetInputSchema: { references: { kind: "asset" } },
    providers,
  };
}

/**
 * Build the semantic generation registry from the user's existing catalog.
 * This is a declaration bridge only: it never invents provider capabilities
 * and never reads API keys. A missing/empty catalog yields an empty registry,
 * so planning fails before any provider or spend path is touched.
 */
export function createCatalogModuleRegistry(state: CatalogState = readCatalog(), options: { readinessByProvider?: GenerationProviderReadinessMap } = {}) {
  const manifest = manifestFromCatalog(state, options.readinessByProvider);
  return createBuiltinModuleRegistry(manifest ? [manifest] : []);
}
