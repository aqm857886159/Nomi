import { createSingleFlightCache } from "../../shared/boundedCache";
import { readCatalog } from "../../catalog/catalogStore";
import { userVendorBaseUrl } from "../../catalog/userVendorBase";
import { isJsonRecord } from "../../jsonUtils";
import { builtinVendorKeyOfKey } from "../../shared/builtinVendorIdentity";
import type { VendorPricePreview, VendorPriceQuery } from "../../shared/contracts/vendorPricePreview";
import { builtinVendorSeed } from "../../catalog/builtinVendorSeeds";
import { codeDeclaredFallbackOrigins, fetchVendorWithBaseFallback, rewriteVendorUrl } from "../../vendor/vendorBaseFallback";

const MAX_AGE = 5 * 60_000;
const cache = createSingleFlightCache<string, unknown>({
  maxEntries: 128, ttlMs: MAX_AGE, order: "fifo", evictBeforeSet: true,
  cacheResult: (body) => body !== null,
});

/**
 * 和生成 / 轮询 / 上传同一个出站函数：主域连不上、自愈梯子换到官方备用域后，价目请求跟着换。
 * 缓存按改写后的地址记；读失败不留缓存，换线后下一次立刻重读。
 */
async function publicPrices(url: string): Promise<unknown> {
  const key = rewriteVendorUrl(url);
  return cache.getOrLoad(key, () =>
    fetchVendorWithBaseFallback(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8000) })
      .then(async (r) => { if (r.ok) return r.json(); await r.body?.cancel(); return null; }).catch(() => null),
  );
}

/**
 * 图层分离按哪一档预扣：只登记官方页写明了的模型（按发给供应商的线上模型名）。
 * Seedream 5.5（docs.apimart.ai/en/api-reference/images/seedream-5-5/generation，2026-11-26 取）原文：
 * 「`1K` / `1.5K` reserve at the lower tier; `2K` / `auto` at the higher tier」；价目 `layer_decomposition_paid_prices`
 * 只有 `1K`（低档）/ `2K`（高档）两个键。默认 `auto` 因此按高档算（D-1126-se-auto-tier）。
 * Seedream 5.0 Pro 页没写 `auto` 按哪档（它的图层分离也不让选清晰度）→ 不登记，不印数。
 */
const LAYER_SPLIT_RESERVE_TIER: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "seedream-5-5": { "1k": "1K", "1.5k": "1K", "2k": "2K", auto: "2K" },
};

/** 官方总表里这个图片模型的单价单位明写「每张」（`usd_per_image`）才算——单靠单模型接口看不出单位。 */
function listedPerImage(imageList: unknown, modelId: string): boolean {
  if (!isJsonRecord(imageList) || imageList.success !== true || !isJsonRecord(imageList.data) || !isJsonRecord(imageList.data.models)) return false;
  const images = imageList.data.models.image;
  const row: unknown = Array.isArray(images) ? images.find((r: unknown) => isJsonRecord(r) && r.id === modelId) : null;
  return isJsonRecord(row) && row.specification === "image" && isJsonRecord(row.fixed_prices) && row.fixed_prices.unit === "usd_per_image";
}

/**
 * 图层分离的预扣口径：层数上限 × 档位单价 + 输入图费（首张免费的模型扣掉一张）。官方按实际层数与像素档结算、失败全退，
 * 所以这是「最多大约多少」，界面照普通约价标「约」，不写成实际扣费。数一个读不到就 null（不报 0、不猜）。
 */
function layerSplitPriceFor(query: VendorPriceQuery, d: Record<string, unknown>, imageList: unknown, source: string): VendorPricePreview | null {
  const maxImages = query.layerSplit?.maxImages ?? 0;
  const tier = LAYER_SPLIT_RESERVE_TIER[query.modelId]?.[(query.size ?? "auto").toLowerCase()];
  if (!tier || !Number.isSafeInteger(maxImages) || maxImages < 1 || query.count !== 1
      || !Number.isSafeInteger(query.referenceCount) || query.referenceCount < 1 || query.hasVideoInput === true) return null;
  const published = Number(d.layer_decomposition_max_images);
  if (!Number.isSafeInteger(published) || maxImages > published) return null;
  const rates = d.layer_decomposition_paid_prices;
  const rate = isJsonRecord(rates) ? rates[tier] : undefined;
  const inputRate = d.input_image_paid_price;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0
      || typeof inputRate !== "number" || !Number.isFinite(inputRate) || inputRate < 0) return null;
  if (!listedPerImage(imageList, query.modelId)) return null;
  const chargedInputs = d.input_image_first_free === true ? query.referenceCount - 1 : query.referenceCount;
  const usd = maxImages * rate + chargedInputs * inputRate;
  return Number.isFinite(usd * 10) && usd > 0 ? { source, usd, credits: usd * 10 } : null;
}

export function publicPriceFor(query: VendorPriceQuery, detail: unknown, imageList: unknown, source: string): VendorPricePreview | null {
  if (query?.layerSplit) {
    if (query.kind !== "image" || typeof query.modelId !== "string" || !isJsonRecord(detail) || detail.success !== true || !isJsonRecord(detail.data)) return null;
    const d = detail.data;
    if (d.model_name !== query.modelId || !isJsonRecord(d.membership) || d.membership.category !== "image"
        || d.billing_tiers || d.precharge_billing_type || d.token_price) return null;
    return layerSplitPriceFor(query, d, imageList, source);
  }
  // Input media may add a fee or bill both source and output seconds. The fixed output rate alone can't price it.
  if (!query || !["image", "video"].includes(query.kind) || !Number.isSafeInteger(query.count) || query.count <= 0
      || query.referenceCount !== 0 || query.hasVideoInput === true || typeof query.modelId !== "string") return null;
  if (!isJsonRecord(detail) || detail.success !== true || !isJsonRecord(detail.data)) return null;
  const d = detail.data;
  if (d.model_name !== query.modelId || !isJsonRecord(d.membership) || d.membership.category !== query.kind
      || d.billing_tiers) return null;
  const video = query.kind === "video";
  if (!video && d.precharge_billing_type === "size_quality_token_formula" && d.billing_type === "tiered_token"
      && isJsonRecord(d.pricing) && d.pricing.unit === "usd_per_million_tokens" && isJsonRecord(d.size_quality_paid_prices)) {
    // An explicit fixed output size/quality has an official token estimate. Input and actual billed tokens are unknown.
    if (!query.size || !query.quality || !query.resolution || query.size === "auto" || query.quality === "auto") return null;
    const resolution = query.resolution.toLowerCase();
    const tier = d.size_quality_paid_prices[query.size + (resolution === "1k" ? "" : "@" + resolution)];
    const estimate = isJsonRecord(tier) ? tier[query.quality] : null;
    if (typeof estimate !== "number" || estimate <= 0 || !Number.isFinite(estimate * query.count * 10)) return null;
    const usd = estimate * query.count;
    return { source, usd, credits: usd * 10, basis: "output-estimate" };
  }
  if (d.precharge_billing_type || d.token_price) return null;
  if (video && d.billing_type !== "per_second") return null;
  // The single-model endpoint omits the unit for fixed image prices; require an explicit per-image unit from the official listing.
  if (!video && !listedPerImage(imageList, query.modelId)) return null;
  const seconds = video ? query.durationSec : 1;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  let rate: unknown = d.paid_price;
  if (d.resolution_enabled === true || d.resolution_paid_prices !== undefined) {
    if (!isJsonRecord(d.resolution_paid_prices) || typeof query.resolution !== "string" || !query.resolution.trim()) return null;
    const rates = d.resolution_paid_prices;
    if (Object.keys(rates).some((k) => k.endsWith("-input")) && query.hasVideoInput !== false) return null;
    const audioRate = Object.keys(rates).some((k) => k.endsWith("-audio"));
    if (audioRate && typeof query.hasAudio !== "boolean") return null;
    const key = query.resolution.toLowerCase() + (audioRate && query.hasAudio ? "-audio" : "");
    rate = Object.entries(rates).find(([k]) => k.toLowerCase() === key)?.[1];
  }
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  const usd = seconds * query.count * rate;
  // APIMart publishes credits = amount_usd × 10.
  return Number.isFinite(usd * 10) ? { source, usd, credits: usd * 10 } : null;
}

export async function readVendorPricePreview(query: VendorPriceQuery): Promise<VendorPricePreview | null> {
  if (!query || typeof query.vendorKey !== "string" || typeof query.modelId !== "string" || !/^[a-z0-9][a-z0-9._/-]{0,159}$/i.test(query.modelId)) return null;
  const builtinKey = builtinVendorKeyOfKey(query.vendorKey);
  const seed = builtinVendorSeed(builtinKey);
  const vendor = readCatalog().vendors.find((v) => v.key === query.vendorKey);
  const pricing = seed?.publicPricing;
  if (!seed || !pricing || !vendor) return null;
  const base = userVendorBaseUrl(vendor);
  if (!URL.canParse(base)) return null;
  const url = new URL(base);
  if (url.username || url.password || !["/", "/v1", "/v1/"].includes(url.pathname)
      || ![new URL(seed.baseUrl).origin, ...codeDeclaredFallbackOrigins(builtinKey)].includes(url.origin)) return null;
  const list = new URL(pricing.listPath, url.origin);
  const source = new URL(pricing.modelPath, url.origin);
  source.searchParams.set("model", query.modelId);
  const [detail, images] = await Promise.all([publicPrices(source.href), query.kind === "image" ? publicPrices(list.href) : null]);
  return publicPriceFor(query, detail, images, rewriteVendorUrl(source.href));
}
