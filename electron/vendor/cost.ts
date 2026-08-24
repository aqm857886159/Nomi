/**
 * Provider-neutral cost evidence.
 *
 * The renderer estimates from catalog pricing; this module only reads actual
 * provider evidence from a completed response.  A missing field is an honest
 * unknown, never a fabricated zero.
 */

export type ProviderCostActual = {
  amount: number;
  unit: "credits";
  provider: string;
};

type CostFieldPath = readonly string[];

const COST_FIELDS_BY_PROVIDER: Record<string, readonly CostFieldPath[]> = {
  apimart: [["data", "credits_cost"]],
  kie: [["data", "creditsConsumed"]],
};

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readPath(value: unknown, path: CostFieldPath): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Some providers wrap the final record in an array (`data[0]`), while others
 * return an object.  Walk only object keys so we can support both without
 * knowing a vendor's entire response schema.
 */
function findNumericField(value: unknown, field: string): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNumericField(item, field);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const direct = record[field];
  if (isFiniteNonNegative(direct)) return direct;
  for (const child of Object.values(record)) {
    const found = findNumericField(child, field);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function extractProviderCostActual(providerKey: string, response: unknown): ProviderCostActual | undefined {
  const provider = String(providerKey || "").trim().toLowerCase();
  const paths = COST_FIELDS_BY_PROVIDER[provider];
  if (!provider || !paths) return undefined;
  for (const path of paths) {
    const direct = readPath(response, path);
    if (isFiniteNonNegative(direct)) return { amount: direct, unit: "credits", provider };
    const fallback = findNumericField(response, path[path.length - 1]);
    if (fallback !== undefined) return { amount: fallback, unit: "credits", provider };
  }
  return undefined;
}
