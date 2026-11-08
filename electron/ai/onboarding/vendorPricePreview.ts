import { appFetch } from "../../appFetch";
import { readCatalog } from "../../catalog/catalogStore";
import { userVendorBaseUrl } from "../../catalog/userVendorBase";
import { isJsonRecord } from "../../jsonUtils";
import { builtinVendorKeyOfKey } from "../../shared/builtinVendorIdentity";
import type { VendorPricePreview, VendorPriceQuery } from "../../shared/contracts/vendorPricePreview";
import { builtinVendorSeed } from "../../catalog/builtinVendorSeeds";

const MAX_AGE = 5 * 60_000;
const cache = new Map<string, { expires: number; reading: Promise<unknown> }>();

async function publicPrices(url: string): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() < hit.expires) return hit.reading;
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  const reading = appFetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8000) })
    .then(async (r) => { if (r.ok) return r.json(); await r.body?.cancel(); return null; }).catch(() => null);
  cache.set(url, { expires: Date.now() + MAX_AGE, reading });
  return reading;
}

export function publicPriceFor(query: VendorPriceQuery, detail: unknown, imageList: unknown, source: string): VendorPricePreview | null {
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
  if (!video) {
    // The single-model endpoint omits the unit for fixed image prices; require an explicit per-image unit from the official listing.
    if (!isJsonRecord(imageList) || imageList.success !== true || !isJsonRecord(imageList.data) || !isJsonRecord(imageList.data.models)) return null;
    const images = imageList.data.models.image;
    const row: unknown = Array.isArray(images) ? images.find((r: unknown) => isJsonRecord(r) && r.id === query.modelId) : null;
    if (!isJsonRecord(row) || row.specification !== "image" || !isJsonRecord(row.fixed_prices) || row.fixed_prices.unit !== "usd_per_image") return null;
  }
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
  // APIMart account/usage: credits = amount_usd × 10 (also the unit returned on the balance endpoint).
  return Number.isFinite(usd * 10) ? { source, usd, credits: usd * 10 } : null;
}

export async function readVendorPricePreview(query: VendorPriceQuery): Promise<VendorPricePreview | null> {
  if (!query || typeof query.vendorKey !== "string" || typeof query.modelId !== "string" || !/^[a-z0-9][a-z0-9._/-]{0,159}$/i.test(query.modelId)) return null;
  const seed = builtinVendorSeed(builtinVendorKeyOfKey(query.vendorKey));
  const vendor = readCatalog().vendors.find((v) => v.key === query.vendorKey);
  if (!seed?.accountFacts?.publicPricesPath || !vendor) return null;
  const base = userVendorBaseUrl(vendor);
  if (!URL.canParse(base)) return null;
  const url = new URL(base);
  if (url.username || url.password || !["/", "/v1", "/v1/"].includes(url.pathname)
      || ![new URL(seed.baseUrl).origin, ...seed.accountFacts.alternateOrigins].includes(url.origin)) return null;
  const list = new URL(seed.accountFacts.publicPricesPath, url.origin);
  const source = new URL(seed.accountFacts.modelPricePath, url.origin);
  source.searchParams.set("model", query.modelId);
  const [detail, images] = await Promise.all([publicPrices(source.href), query.kind === "image" ? publicPrices(list.href) : null]);
  return publicPriceFor(query, detail, images, source.href);
}
