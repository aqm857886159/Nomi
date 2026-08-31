import type { Model } from "./types";

export type GenerationMediaKind = "image" | "video";

export type CheapestGenerationModel = {
  vendorKey: string;
  modelKey: string;
  cost: number;
};

export type CheapestGenerationModelResult = CheapestGenerationModel | {
  status: "unpriced" | "unavailable";
  vendorKey: string;
  kind: GenerationMediaKind;
};

type SelectionInput = {
  kind: GenerationMediaKind;
  models: readonly Model[];
  /** Explicit provider requests are honored; automatic selection defaults to ApiMart. */
  vendorKey?: string;
};

function declaredBaseCost(model: Model): number | undefined {
  const pricing = model.pricing;
  if (!pricing || pricing.enabled !== true || !Number.isFinite(pricing.cost) || pricing.cost < 0) return undefined;
  return pricing.cost;
}

/**
 * Test-harness-only cost selector. It must never be used by ProductionRun, composer,
 * or the user's default-model resolver. Pick the cheapest known-price candidate without
 * guessing from model names; an unpriced candidate can never win a paid test job.
 */
export function selectCheapestTestGenerationModel(input: SelectionInput): CheapestGenerationModelResult {
  const vendorKey = input.vendorKey?.trim() || "apimart";
  const candidates = input.models.filter((model) =>
    model.vendorKey === vendorKey && model.kind === input.kind && model.enabled,
  );
  if (candidates.length === 0) return { status: "unavailable", vendorKey, kind: input.kind };

  const priced = candidates
    .map((model) => {
      const cost = declaredBaseCost(model);
      return cost === undefined ? undefined : { vendorKey: model.vendorKey, modelKey: model.modelKey, cost };
    })
    .filter((candidate): candidate is CheapestGenerationModel => candidate !== undefined)
    .sort((a, b) => a.cost - b.cost || a.modelKey.localeCompare(b.modelKey));
  return priced[0] ?? { status: "unpriced", vendorKey, kind: input.kind };
}
