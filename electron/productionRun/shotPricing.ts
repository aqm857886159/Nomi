import type { PlanCandidate } from "../capabilityCore/executionContract";

/**
 * P4 S2 — per-shot pricing derive + preview projection + seal precheck (pure, provider-free).
 *
 * ## Why this module exists and where the numbers come from
 *
 * The only pricing truth source is the catalog model row's optional `pricing` field
 * (electron/catalog/types.ts:207-213): `{ cost, enabled, specCosts: [{ specKey, cost, enabled }] }`.
 * It is user-configurable. Everything here derives from it — never a hard-coded price.
 *
 * ## The specKey matching rule (no prior code precedent — see the plan §9 honesty boundary)
 *
 * The catalog `specCosts` shape has existed since C1 (commit ee7b0a47) but **no consumer ever joined
 * it to a parameter selection** — the intended `estimateGenerationCost` (archetype params × specCosts)
 * was documented as "数据已有全未用" (docs/plan/2026-06-11-nomi-harness-master-plan.md:244) and never
 * built; there is no `specKey` example anywhere in the tree. S2 therefore has to *define* the rule.
 * The conservative rule adopted here mirrors the documented additive join and stays honest:
 *
 *   price(shot) = pricing.cost  +  Σ specCost.cost   for every ENABLED specCost whose specKey matches
 *                                                    a parameter the shot actually selected.
 *
 * A specKey "matches a selection" when it equals either:
 *   - a bare selected value  (specKey "720p"           matches parameters.resolution === "720p"), or
 *   - a paramKey:value pair  (specKey "resolution:720p" matches the same selection).
 * Values are compared as trimmed strings (numeric selections stringify: duration 5 → "5").
 *
 * If there is no pricing row, pricing is disabled, or the base cost is not a finite non-negative
 * number → the price is honestly `{ known: false }`. We NEVER substitute 0 for an unknown price:
 * an unpriced model must surface as "未知" in preview, not as "¥0" (plan §3.1/§9). (The separate
 * *ledger* wiring may still reserve 0 for an unpriced shot — that is "no priced liability to reserve",
 * not a fabricated display price; the two concerns are deliberately kept apart.)
 */

export type ModelPricingSpec = {
  specKey: string;
  cost: number;
  enabled: boolean;
};

export type ModelPricing = {
  cost: number;
  enabled: boolean;
  specCosts: ReadonlyArray<ModelPricingSpec>;
};

/** A catalog model row reduced to its identity + pricing (the only fields this module reads). */
export type ModelPricingRow = {
  providerId: string;
  modelId: string;
  pricing?: ModelPricing;
};

/** Resolve the pricing config for a provider/model identity (candidate.providerId maps to vendorKey). */
export type PricingResolver = (providerId: string, modelId: string) => ModelPricing | undefined;

/** A derived per-shot price: an honest known amount, or explicitly unknown. Never a fabricated 0. */
export type ShotPrice = { known: true; amount: number } | { known: false };

/**
 * A paid gate cannot be issued when the catalog cannot prove a price.  Keep
 * this error at the pricing boundary so preview may still surface an honest
 * `{ known: false }`, while every authorization caller shares the same
 * fail-closed code/message instead of silently treating unknown as zero.
 */
export class GenerationPricingUnavailableError extends Error {
  readonly code = "generation_pricing_unknown" as const;
  readonly shotId: string;

  constructor(shotId: string) {
    super(`Cannot authorize paid generation without a known price: ${shotId}`);
    this.name = "GenerationPricingUnavailableError";
    this.shotId = shotId;
  }
}

export function assertKnownShotPrice(price: ShotPrice, shotId: string): asserts price is { known: true; amount: number } {
  if (!price.known) throw new GenerationPricingUnavailableError(shotId);
}

export type ShotPriceInput = {
  candidate: Pick<PlanCandidate, "providerId" | "modelId" | "parameters">;
  resolvePricing: PricingResolver;
};

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * The set of specKeys a shot's parameter selection can match: for each parameter, both the bare
 * stringified value and the `paramKey:value` composite. Non-scalar values are ignored (a specCost
 * cannot meaningfully key on an object/array selection).
 */
function selectedSpecKeys(parameters: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  for (const [paramKey, raw] of Object.entries(parameters)) {
    if (raw === undefined || raw === null) continue;
    const scalar = typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean";
    if (!scalar) continue;
    const value = String(raw).trim();
    if (!value) continue;
    keys.add(value);
    keys.add(`${paramKey}:${value}`);
  }
  return keys;
}

/**
 * Derive a single shot's price from its selected model + parameters and the catalog pricing.
 * Pure. Returns `{ known: false }` (never 0) when the price cannot be honestly established.
 */
export function deriveShotPrice(input: ShotPriceInput): ShotPrice {
  const pricing = input.resolvePricing(input.candidate.providerId, input.candidate.modelId);
  if (!pricing || pricing.enabled !== true || !isFiniteNonNegative(pricing.cost)) return { known: false };

  const selected = selectedSpecKeys(input.candidate.parameters ?? {});
  let amount = pricing.cost;
  for (const spec of pricing.specCosts ?? []) {
    if (spec.enabled !== true) continue;
    if (!isFiniteNonNegative(spec.cost)) continue;
    const specKey = typeof spec.specKey === "string" ? spec.specKey.trim() : "";
    if (!specKey) continue;
    if (selected.has(specKey)) amount += spec.cost;
  }
  return { known: true, amount };
}

// ---------------------------------------------------------------------------------------------------
// Preview projection
// ---------------------------------------------------------------------------------------------------

/** A structured, i18n-safe degradation reason. The renderer maps `code` (+`params`) via t(); never a string. */
export type ShotDegradation = {
  code: "model_cannot_take_character_reference";
  params: { modelId: string };
};

/** An honest per-shot duration estimate: a known seconds value, or explicitly unknown. */
export type DurationEstimate = { known: true; seconds: number } | { known: false };

export type PreviewShotInput = {
  shotId: string;
  candidate: Pick<PlanCandidate, "providerId" | "modelId" | "parameters">
    & Partial<Pick<PlanCandidate, "references">>;
  /** Whether this shot references a character (for the "model can't take a face" degradation). */
  hasCharacter?: boolean;
  /** Whether the selected model exposes a reference-image channel. */
  supportsReferenceImage?: boolean;
};

export type PreviewShotProjection = {
  shotId: string;
  price: ShotPrice;
  durationEstimate: DurationEstimate;
  degradations: ShotDegradation[];
};

export type MultiShotPreviewTotal = {
  /** Sum of the KNOWN per-shot prices only. Unknown-price shots are excluded (not counted as 0). */
  knownSubtotal: number;
  /** How many shots have an unknown price — the honest "we could not price N of these" signal. */
  unknownShotCount: number;
  currency: string;
};

export type MultiShotPreviewProjection = {
  shots: PreviewShotProjection[];
  total: MultiShotPreviewTotal;
};

// ---------------------------------------------------------------------------------------------------
// P4 S3a — multi-shot confirmation gate projection (the wire shape carried through the three layers:
// approvalReceipt challenge → mcpProtocol → appIntegration → renderer confirmation card).
// ---------------------------------------------------------------------------------------------------

/**
 * A single read-only shot row on the multi-shot confirmation card. Every field is already resolved
 * to what the card shows: `providerModelText` is the human-readable "model · mode" string built here
 * (the renderer never re-joins provider/model), while `degradations` stay STRUCTURED (code + params)
 * so the renderer translates them via t() — never a pre-rendered string that would pierce the i18n gate.
 * Price/duration keep the S2 honest-unknown semantics (never a fabricated 0/"¥0").
 */
export type MultiShotGateShot = {
  shotId: string;
  index: number;
  sceneOneLiner: string;
  providerModelText: string;
  durationSeconds: number | null;
  price: ShotPrice;
  degradations: ShotDegradation[];
  /** Safe, user-visible reference identities; paths and provider URLs never cross this boundary. */
  referenceMedia?: Array<{ assetId: string; kind?: string; role?: string; version: number }>;
};

/**
 * The whole multi-shot projection attached to a generation gate challenge. Serializable end-to-end.
 * Its presence is what makes the renderer show the multi-shot card instead of the flat single-shot one;
 * a single-shot gate omits it entirely (byte-identical to today — the single-shot E2E is the regression gate).
 */
export type MultiShotGateProjection = {
  planVersion?: number;
  planHash?: string;
  specs?: {
    durationSeconds?: number | null;
    aspectRatio?: string | null;
    shotCount?: number | null;
  };
  shots: MultiShotGateShot[];
  currency?: string;
  hardLimit?: number | null;
  anchorChips?: Array<{ label: string; price: ShotPrice }>;
  waitSeconds?: number | null;
  /** J06 — 估计依据：'coldstart' = 无历史数据时给区间（low/high），'historical' = P50/P90 实测值。 */
  etaBasis?: 'coldstart' | 'historical';
  /** J06 — 冷启动悲观上限（秒）；仅 etaBasis='coldstart' 时存在。 */
  waitSecondsHigh?: number | null;
  frozenItems?: string[];
  expiresAt?: string | null;
};

export type ProjectMultiShotPreviewInput = {
  shots: ReadonlyArray<PreviewShotInput>;
  resolvePricing: PricingResolver;
  /** Estimate a shot's duration in seconds, or return undefined when it cannot be estimated. */
  durationSeconds: (candidate: PreviewShotInput["candidate"]) => number | undefined;
  currency?: string;
};

function shotDegradations(shot: PreviewShotInput): ShotDegradation[] {
  const degradations: ShotDegradation[] = [];
  if (shot.hasCharacter === true && shot.supportsReferenceImage === false) {
    degradations.push({ code: "model_cannot_take_character_reference", params: { modelId: shot.candidate.modelId } });
  }
  return degradations;
}

/**
 * Project a multi-shot plan into per-shot preview rows + an honest total. Pure — no provider call
 * (preview must stay zero-request, an S2 invariant). Unknown prices/durations surface as unknown.
 */
export function projectMultiShotPreview(input: ProjectMultiShotPreviewInput): MultiShotPreviewProjection {
  const currency = input.currency?.trim() || "CNY";
  const shots = input.shots.map((shot): PreviewShotProjection => {
    const price = deriveShotPrice({ candidate: shot.candidate, resolvePricing: input.resolvePricing });
    const seconds = input.durationSeconds(shot.candidate);
    const durationEstimate: DurationEstimate = isFiniteNonNegative(seconds)
      ? { known: true, seconds }
      : { known: false };
    return { shotId: shot.shotId, price, durationEstimate, degradations: shotDegradations(shot) };
  });
  const knownSubtotal = shots.reduce((sum, shot) => (shot.price.known ? sum + shot.price.amount : sum), 0);
  const unknownShotCount = shots.reduce((count, shot) => (shot.price.known ? count : count + 1), 0);
  return { shots, total: { knownSubtotal, unknownShotCount, currency } };
}

// ---------------------------------------------------------------------------------------------------
// P4 S4 — build the multi-shot gate projection (the real display.shots the confirmation card renders).
// This is the ASSEMBLY the S3a card was waiting on (mcpGenerationTools.ts:616 "scales once shots[] is
// threaded through"). Pure — no provider call (the gate stays zero-request). Same single source of
// truth as the single-shot preview (deriveShotPrice / shotDegradations), so prices/degradations agree.
// ---------------------------------------------------------------------------------------------------

/** One shot's already-resolved display inputs (the caller joins provider/model into the human string). */
export type GateShotInput = {
  shotId: string;
  /** One-line scene description shown on the card (from the candidate prompt). */
  sceneOneLiner: string;
  /** Human "provider · model（mode）" string built by the caller — the renderer never re-joins it. */
  providerModelText: string;
  candidate: Pick<PlanCandidate, "providerId" | "modelId" | "parameters" | "references">;
  durationSeconds?: number;
  hasCharacter?: boolean;
  supportsReferenceImage?: boolean;
};

export type BuildMultiShotGateProjectionInput = {
  shots: ReadonlyArray<GateShotInput>;
  resolvePricing: PricingResolver;
  currency?: string;
  planVersion?: number;
  planHash?: string;
  specs?: MultiShotGateProjection["specs"];
  hardLimit?: number | null;
  anchorChips?: MultiShotGateProjection["anchorChips"];
  waitSeconds?: number | null;
  frozenItems?: string[];
  expiresAt?: string | null;
};

/**
 * Build the serializable {@link MultiShotGateProjection} the confirmation card renders. Every per-shot
 * row is resolved to what the card shows; prices keep the honest-unknown semantics (never a fabricated
 * 0), and degradations stay STRUCTURED (code + params) so the renderer translates them via t().
 */
export function buildMultiShotGateProjection(input: BuildMultiShotGateProjectionInput): MultiShotGateProjection {
  const shots: MultiShotGateShot[] = input.shots.map((shot, index): MultiShotGateShot => {
    const price = deriveShotPrice({ candidate: shot.candidate, resolvePricing: input.resolvePricing });
    const seconds = shot.durationSeconds;
    return {
      shotId: shot.shotId,
      index: index + 1,
      sceneOneLiner: shot.sceneOneLiner,
      providerModelText: shot.providerModelText,
      durationSeconds: isFiniteNonNegative(seconds) ? seconds : null,
      price,
      degradations: shotDegradations({ shotId: shot.shotId, candidate: shot.candidate as never, hasCharacter: shot.hasCharacter, supportsReferenceImage: shot.supportsReferenceImage }),
      ...(shot.candidate.references?.length ? {
        referenceMedia: shot.candidate.references.map((reference) => ({
          assetId: reference.assetId,
          ...(reference.kind ? { kind: reference.kind } : {}),
          ...(reference.role ? { role: reference.role } : {}),
          version: reference.version,
        })),
      } : {}),
    };
  });
  return {
    ...(input.planVersion !== undefined ? { planVersion: input.planVersion } : {}),
    ...(input.planHash !== undefined ? { planHash: input.planHash } : {}),
    ...(input.specs ? { specs: input.specs } : {}),
    shots,
    currency: input.currency?.trim() || "CNY",
    ...(input.hardLimit !== undefined ? { hardLimit: input.hardLimit } : {}),
    ...(input.anchorChips ? { anchorChips: input.anchorChips } : {}),
    ...(input.waitSeconds !== undefined ? { waitSeconds: input.waitSeconds } : {}),
    ...(input.frozenItems ? { frozenItems: input.frozenItems } : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// Seal precheck
// ---------------------------------------------------------------------------------------------------

export type SealAffordabilityShot = {
  shotId: string;
  price: ShotPrice;
};

export type CheckSealAffordabilityInput = {
  /** Shots in checkbox (selection) order — the order maxAffordableShots is counted in. */
  shots: ReadonlyArray<SealAffordabilityShot>;
  /** The hard spend ceiling (policy.maxSpend). null = unbounded. */
  maxSpend: number | null;
};

export type SealAffordabilityResult =
  | { ok: true; hasUnknownPrice: boolean }
  | { ok: false; maxAffordableShots: number; knownSubtotal: number; maxSpend: number };

/**
 * Precheck whether a plan can be sealed under the hard spend ceiling.
 * - maxSpend null → always ok (unbounded); still reports whether any shot price is unknown.
 * - maxSpend set → walk shots in checkbox order accumulating KNOWN prices. Unknown-price shots
 *   contribute 0 toward the cap (we cannot count what we cannot price) but still occupy a slot.
 *   If the running known subtotal exceeds the cap, reject with maxAffordableShots = the count of
 *   shots that fit before the breach (the "最多只能完成前 N 镜" signal, plan §3.1/§4).
 *   When it fits, ok — but flag hasUnknownPrice so the caller can mark cost certainty (plan S2 §3).
 */
export function checkSealAffordability(input: CheckSealAffordabilityInput): SealAffordabilityResult {
  const hasUnknownPrice = input.shots.some((shot) => !shot.price.known);
  const knownSubtotal = input.shots.reduce((sum, shot) => (shot.price.known ? sum + shot.price.amount : sum), 0);

  if (input.maxSpend === null) return { ok: true, hasUnknownPrice };

  const maxSpend = input.maxSpend;
  let running = 0;
  let affordable = 0;
  for (const shot of input.shots) {
    const next = running + (shot.price.known ? shot.price.amount : 0);
    if (next > maxSpend) break;
    running = next;
    affordable += 1;
  }
  if (affordable < input.shots.length) {
    return { ok: false, maxAffordableShots: affordable, knownSubtotal, maxSpend };
  }
  return { ok: true, hasUnknownPrice };
}
