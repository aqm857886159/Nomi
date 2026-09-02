import type { ProductionGenerationPlan } from "./productionRunTypes";
import type { ShotPrice } from "./shotPricing";

export class SealBudgetExceededError extends Error {
  readonly code = "seal_budget_exceeded" as const;

  constructor(
    readonly maxAffordableShots: number,
    readonly knownSubtotal: number,
    readonly maxSpend: number,
  ) {
    super(`seal_budget_exceeded: hard spend ceiling ${maxSpend} covers only the first ${maxAffordableShots} shot(s)`);
    this.name = "SealBudgetExceededError";
  }
}

export function generationSealShotPrices(raw: unknown): Map<string, ShotPrice> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error("Generation seal shotPrices must be an array");
  const prices = new Map<string, ShotPrice>();
  for (const [index, value] of raw.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid seal shot price at ${index}`);
    const entry = value as { shotId?: unknown; price?: unknown };
    const shotId = typeof entry.shotId === "string" ? entry.shotId.trim() : "";
    if (!shotId) throw new Error(`Invalid seal shot price id at ${index}`);
    const price = entry.price as ShotPrice | undefined;
    if (!price || typeof price !== "object" || typeof (price as { known?: unknown }).known !== "boolean") {
      throw new Error(`Invalid seal shot price value at ${index}`);
    }
    if (price.known && !(Number.isFinite(price.amount) && price.amount >= 0)) {
      throw new Error(`Invalid seal shot price amount at ${index}`);
    }
    prices.set(shotId, price.known ? { known: true, amount: price.amount } : { known: false });
  }
  return prices;
}

export type GenerationSealCostCertainty = ProductionGenerationPlan["costCertainty"];
