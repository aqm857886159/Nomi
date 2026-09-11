// 「一镜要花多少钱」的**唯一算式**（纯函数，跨进程共用）。
//
// ── 为什么它住在中立契约层 ──
//
// 这条算式有两个读者，而且它们必须永远报同一个数：
//   · 主进程——封印合同、铸收据时按它算出**正式报价**（`productionRun/shotPricing.ts`）；
//   · 渲染层——付费确认卡上用户每改一个 chip，价格行要**当场**跟着动（`spendCardEstimate.ts`），
//     以及画布上那条批量确认条的「本波预估额度」（`generationCanvas/spend/planCostEstimate.ts`）。
//
// 在 2026-09-11 之前这两边各写各的：主进程算「基价 + 命中的规格加价」，渲染层只累加基价。
// 于是同一批镜头，确认条上印的数比真正要扣的少——**少报比不报更坏**，用户以为便宜。
// 那正是 R14.1 要横扫的「同一语义两份定义」，所以这里把算式收成一份，两边都 import 它
// （渲染层可以合法 import `electron/shared/`，见 `.dependency-cruiser.mjs` R-B1）。
//
// ── 两条不变量 ──
//
// ① **价目只来自目录**（`electron/catalog/types.ts` 的 `model.pricing`，用户可改），永不硬编码；
// ② **算不出就说算不出**，绝不落成 0。三种可能（免费 / 算不出 / 真的零元）里，
//    印 0 恰好是唯一会被读成「这次不花钱」的那一种。

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

/** 这一镜的模型身份 + 它真正选中的那些参数——算式认识的全部输入。 */
export type PricedCandidate = {
  providerId: string;
  modelId: string;
  parameters?: Record<string, unknown>;
};

export type ShotPriceInput = {
  candidate: PricedCandidate;
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
 *
 *   price(shot) = pricing.cost  +  Σ specCost.cost   for every ENABLED specCost whose specKey matches
 *                                                    a parameter the shot actually selected.
 *
 * A specKey "matches a selection" when it equals either a bare selected value (`"720p"` matches
 * `parameters.resolution === "720p"`) or a `paramKey:value` pair (`"resolution:720p"`, same selection).
 * Values compare as trimmed strings (numeric selections stringify: duration 5 → "5").
 *
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
// 目录行 → resolver（身份匹配规则，两端共用）
// ---------------------------------------------------------------------------------------------------

/** 一行「能报价的模型」。主进程喂 catalog `Model`，渲染层喂 `ModelOption`，映射各在自己那头做。 */
export type PricedModelRow = {
  vendorKey: string;
  modelKey: string;
  modelAlias?: string | null;
  pricing?: ModelPricing;
};

const normalizedIdentity = (value: string): string => value.trim().toLowerCase();

/**
 * 按 vendorKey + (modelKey 或 modelAlias) 大小写不敏感地找那一行的价目。
 *
 * 身份匹配规则必须和算式住在同一处：付费卡在渲染层重算价格时，只要「哪一行是这个模型」的判据
 * 和主进程差一点，卡上的数和真正要扣的数就会对不上——而用户看着卡按下去的那一刻，
 * 相信的是卡上那个数。找不到行 / 没有价目 → `undefined`，算式随即诚实地报「算不出」。
 */
export function createModelPricingResolver(rows: readonly PricedModelRow[]): PricingResolver {
  return (providerId, modelId) => {
    const vendor = normalizedIdentity(providerId);
    const model = normalizedIdentity(modelId);
    const row = rows.find((item) =>
      normalizedIdentity(item.vendorKey) === vendor
      && (normalizedIdentity(item.modelKey) === model
        || (typeof item.modelAlias === "string" && normalizedIdentity(item.modelAlias) === model)));
    return row?.pricing;
  };
}
