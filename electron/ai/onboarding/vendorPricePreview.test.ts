import { describe, expect, it, vi } from "vitest";
import { appFetch } from "../../appFetch";
import { readCatalog } from "../../catalog/catalogStore";
import { publicPriceFor, readVendorPricePreview } from "./vendorPricePreview";
import type { VendorPriceQuery } from "../../shared/contracts/vendorPricePreview";

vi.mock("../../appFetch", () => ({ appFetch: vi.fn() }));
vi.mock("../../catalog/catalogStore", () => ({ readCatalog: vi.fn() }));
const q: VendorPriceQuery = { vendorKey: "apimart", kind: "video", modelId: "doubao-seedance-2.0-mini",
  referenceCount: 0, hasVideoInput: false, durationSec: 5, count: 1, resolution: "720p" };
const data = { model_name: q.modelId, membership: { category: "video" }, billing_type: "per_second", resolution_enabled: true,
  resolution_paid_prices: { "720P": 0.0390344, "720P-input": 0.02376 } };
const quote = (d: Record<string, unknown> = data, input = q, list: unknown = null) =>
  publicPriceFor(input, { success: true, data: d }, list, "official");

describe("read-only public media price", () => {
  it("prices the exact resolution and output duration, refusing an unproved base or a reference surcharge", () => {
    expect(quote()?.usd).toBeCloseTo(0.195172, 9);
    expect(quote()?.credits).toBeCloseTo(1.95172, 9);
    for (const patch of [{ modelId: "other" }, { count: 0 }, { durationSec: 0 }, { resolution: "4K" },
      { resolution: undefined }, { referenceCount: 1 }, { hasVideoInput: true }, { hasVideoInput: undefined }])
      expect(quote(data, { ...q, ...patch })).toBeNull();
    for (const patch of [{ billing_tiers: [{}] }, { precharge_billing_type: "token_formula" }, { billing_type: "per_call" }])
      expect(quote({ ...data, ...patch })).toBeNull();
  });
  it("requires a documented per-image unit and exact match, not a precharge or editable local price", () => {
    const img = { ...q, modelId: "gpt-image-2", kind: "image" as const, resolution: "2K", count: 2 };
    const imagePrice = { model_name: img.modelId, membership: { category: "image" }, resolution_enabled: true, resolution_paid_prices: { "2K": 0.015 } };
    const list = (unit: string) => ({ success: true, data: { models: { image: [
      { id: img.modelId, specification: "image", fixed_prices: { unit } }] } } });
    expect(quote(imagePrice, img)).toBeNull();
    expect(quote(imagePrice, img, list("usd_per_call"))).toBeNull();
    expect(quote(imagePrice, img, list("usd_per_image"))).toEqual({ usd: 0.03, credits: 0.3, source: "official" });
  });
  it("uses the published output estimate only for an explicit size and quality, never the automatic precharge ceiling", () => {
    const input: VendorPriceQuery = { ...q, kind: "image", modelId: "gpt-image-2.6-flare", size: "1:1", resolution: "1K", quality: "medium" };
    const d = { model_name: input.modelId, membership: { category: "image" }, billing_type: "tiered_token",
      precharge_billing_type: "size_quality_token_formula", pricing: { unit: "usd_per_million_tokens" },
      size_quality_paid_prices: { "1:1": { medium: 0.034776, auto: 0.168576 }, "1:1@2k": { medium: 0.035 } } };
    expect(quote(d, input)).toMatchObject({ usd: 0.034776, basis: "output-estimate" });
    expect(quote(d, { ...input, resolution: "2K" })?.usd).toBe(0.035);
    for (const change of [{ size: "auto" }, { quality: "auto" }, { size: undefined }, { resolution: "4K" }, { referenceCount: 1 }])
      expect(quote(d, { ...input, ...change })).toBeNull();
  });

  it("sends only a public GET to the real configured service origin, shares simultaneous reads, and never quotes a relay as APIMart", async () => {
    const connection = (baseUrlHint: string) => vi.mocked(readCatalog).mockReturnValue({ vendors: [{ key: "apimart", baseUrlHint }] } as ReturnType<typeof readCatalog>);
    connection("https://api.apib.ai/v1");
    vi.mocked(appFetch).mockImplementation(async (input, init) => {
      expect(String(input)).toBe("https://api.apib.ai/api/pricing/model?model=doubao-seedance-2.0-mini");
      expect(init?.method).toBe("GET"); expect(init?.headers).toBeUndefined();
      return Response.json({ success: true, data });
    });
    const [a, b] = await Promise.all([readVendorPricePreview(q), readVendorPricePreview(q)]);
    expect(a?.usd).toBeCloseTo(0.195172, 9); expect(b).toEqual(a); expect(appFetch).toHaveBeenCalledTimes(1);
    connection("https://relay.example/v1");
    expect(await readVendorPricePreview(q)).toBeNull(); expect(appFetch).toHaveBeenCalledTimes(1);
  });
});
