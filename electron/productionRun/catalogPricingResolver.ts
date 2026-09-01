import type { Model } from "../catalog/types";
import type { ExecutionContractV1 } from "../capabilityCore/executionContract";
import { deriveShotPrice, type ModelPricing, type ShotPrice } from "./shotPricing";

/**
 * P4 S2 — the runtime bridge from the catalog to the pure pricing derive.
 *
 * The catalog model row (`Model.pricing`, electron/catalog/types.ts:207-213) is the single pricing
 * truth. A candidate/contract identifies its model by `providerId` (= catalog `vendorKey`) and
 * `modelId` (= catalog `modelKey`) — see the E2E fixture where providerId "apimart" / modelId
 * "gpt-image-2" matches vendorKey "apimart" / modelKey "gpt-image-2". This module resolves that row
 * and adapts it into the `ModelPricing` shape the pure `shotPricing` functions consume. It reads a
 * snapshot of `models` supplied by the caller (the wiring reads `readCatalog().models`); it never
 * calls a provider and never fabricates a price.
 */

const normalized = (value: string): string => value.trim().toLowerCase();

function toModelPricing(pricing: Model["pricing"]): ModelPricing | undefined {
  if (!pricing || typeof pricing !== "object") return undefined;
  const specCosts = Array.isArray(pricing.specCosts)
    ? pricing.specCosts
        .filter((spec): spec is NonNullable<typeof spec> => Boolean(spec) && typeof spec.specKey === "string")
        .map((spec) => ({ specKey: spec.specKey, cost: spec.cost, enabled: spec.enabled }))
    : [];
  return { cost: pricing.cost, enabled: pricing.enabled, specCosts };
}

/**
 * Build a `resolveModelPricing(providerId, modelId)` over a catalog models snapshot. Matches on
 * vendorKey + (modelKey OR modelAlias), case-insensitively, mirroring how the rest of the semantic
 * chain resolves model identity. Returns undefined when the model or its pricing is absent →
 * the pure derive then reports the price as honestly unknown.
 */
export function createCatalogModelPricingResolver(models: readonly Model[]): (providerId: string, modelId: string) => ModelPricing | undefined {
  return (providerId, modelId) => {
    const vendor = normalized(providerId);
    const model = normalized(modelId);
    const row = models.find((item) =>
      normalized(item.vendorKey) === vendor
      && (normalized(item.modelKey) === model || (typeof item.modelAlias === "string" && normalized(item.modelAlias) === model)));
    return row ? toModelPricing(row.pricing) : undefined;
  };
}

/**
 * Build a `resolveShotPrice(contract)` for the authorization seam: derive the
 * sealed sub-contract's real per-shot price from the same catalog snapshot.
 * Unknown remains `{ known: false }`; the paid gate rejects it before a Run is
 * sealed or submitted, so an unknown price cannot become a fabricated zero
 * liability.
 */
export function createCatalogShotPriceResolver(models: readonly Model[]): (contract: ExecutionContractV1) => ShotPrice {
  const resolvePricing = createCatalogModelPricingResolver(models);
  return (contract) => deriveShotPrice({
    candidate: { providerId: contract.providerId, modelId: contract.modelId, parameters: contract.parameters },
    resolvePricing,
  });
}
