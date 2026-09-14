import { createModuleRegistry } from "./moduleRegistry";
import type { ModuleManifest } from "./moduleManifest";
import type { GenerationProviderCapabilities } from "./generationRuntimeAdapter";
import { readCatalog } from "../catalog/catalogStore";
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

function modelParameterSchema(model: Model, mappings: readonly Mapping[]) {
  const schema: Record<string, { type: "string" | "number" | "boolean" | "enum"; enum?: string[] }> = {};
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
      const type = typeof value === "number" ? (Number.isInteger(value) ? "number" : "number")
        : typeof value === "boolean" ? "boolean" : "string";
      schema[key] = { type };
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
  const publishedModesFor = (model: Model): ProfileKind[] =>
    derivePublishedExecution(model, { mappings: state.mappings }).publishedModes;
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
