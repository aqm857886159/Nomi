import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { configureVendorBaseFallback, resetVendorBaseFallbackForTests } from "../../vendor/vendorBaseFallback";
import { appFetch } from "../../appFetch";
import { readCatalog } from "../../catalog/catalogStore";
import { publicPriceFor, publicPriceGap, readPublicPriceListing, readVendorPricePreview } from "./vendorPricePreview";
import recorded from "../../../tests/fixtures/apimart/media-pricing-api.json";
import type { VendorPriceQuery, VendorPriceRequest } from "../../shared/contracts/vendorPricePreview";
import { applyBuiltinSeeds } from "../../catalog/seedBuiltins";
import { priceQueryFromRequest } from "./vendorPriceRequest";

vi.mock("../../appFetch", () => ({ appFetch: vi.fn() }));
vi.mock("../../catalog/catalogStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../catalog/catalogStore")>(), readCatalog: vi.fn(),
}));
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

  it("gives each model its own recorded APIMart rate, and names the listing's reason when there is no fixed rate", async () => {
    const reference = (modelId: string, kind: "image" | "video"): VendorPriceQuery => ({ vendorKey: "apimart", modelId, kind,
      resolution: kind === "video" ? "720p" : "1k", size: "1:1", quality: "medium", count: 1, durationSec: 1, referenceCount: 0, hasAudio: false, hasVideoInput: false });
    const rows = [["gpt-image-2.6-flare", "image"], ["gpt-image-2", "image"], ["gemini-nano-banana-2.1", "image"], ["doubao-seedance-2.5", "video"]] as const;
    const parsed = rows.map(([id, kind]) => {
      const detail = recorded.models[id];
      const quote = publicPriceFor(reference(id, kind), detail, kind === "image" ? recorded.list : null, "recorded");
      return [id, quote ? { credits: quote.credits, basis: quote.basis ?? null } : null, quote ? null : publicPriceGap(detail)] as const;
    });
    expect(parsed).toEqual([
      ["gpt-image-2.6-flare", { credits: expect.closeTo(0.34776, 9), basis: "output-estimate" }, null],
      ["gpt-image-2", { credits: expect.closeTo(0.085, 9), basis: null }, null],
      ["gemini-nano-banana-2.1", null, "token"],
      ["doubao-seedance-2.5", null, "tiered"],
    ]);
    expect(publicPriceGap({ success: false })).toBeNull();
    expect(publicPriceGap({ success: true, data: { billing_type: "per_second" } })).toBeNull();

    // The official fallback origin keeps this test's cached reads apart from the primary-origin tests below.
    vi.mocked(readCatalog).mockReturnValue({ vendors: [{ key: "apimart", baseUrlHint: "https://api.apib.ai/v1" }] } as ReturnType<typeof readCatalog>);
    vi.mocked(appFetch).mockReset().mockImplementation(async (input) => {
      const url = new URL(String(input));
      return Response.json(url.pathname.endsWith("/all") ? recorded.list : recorded.models[url.searchParams.get("model") as keyof typeof recorded.models]);
    });
    const listings = await Promise.all(rows.map(([id, kind]) => readPublicPriceListing(reference(id, kind))));
    expect(listings.map(l => [l.quote?.credits ?? null, l.gap])).toEqual(parsed.map(([, quote, gap]) => [quote?.credits ?? null, gap]));
    expect(await readVendorPricePreview(reference("gpt-image-2", "image"))).toEqual(listings[1].quote);
    vi.mocked(readCatalog).mockReturnValue({ vendors: [{ key: "apimart", baseUrlHint: "https://relay.example/v1" }] } as ReturnType<typeof readCatalog>);
    expect(await readPublicPriceListing(reference("gemini-nano-banana-2.1", "image"))).toEqual({ quote: null, gap: null });
    vi.mocked(appFetch).mockReset();
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

  it("retries a shared failed price read and retains the successful reply", async () => {
    const query = { ...q, modelId: "price-cache-retry" };
    vi.mocked(readCatalog).mockReturnValue({
      vendors: [{ key: "apimart", baseUrlHint: "https://api.apimart.ai/v1" }],
    } as ReturnType<typeof readCatalog>);
    const fetch = vi.mocked(appFetch).mockReset()
      .mockResolvedValueOnce(Response.json(null))
      .mockResolvedValueOnce(Response.json({ success: true, data: { ...data, model_name: query.modelId } }));
    const pair = () => Promise.all([readVendorPricePreview(query), readVendorPricePreview(query)]);
    expect(await pair()).toEqual([null, null]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [first, second] = await pair();
    expect(first?.usd).toBeCloseTo(0.195172, 9);
    expect(second).toEqual(first);
    expect(await readVendorPricePreview(query)).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["image", "video"] as const)("projects a real %s create mapping without dispatching it or forwarding credentials", async (kind) => {
    const catalog = applyBuiltinSeeds({ version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, "2026-11-09T00:00:00Z").state;
    const secret = "synthetic-price-test-key";
    catalog.apiKeysByVendor.apimart = { vendorKey: "apimart", apiKey: secret, enc: "plain", enabled: true, createdAt: "", updatedAt: "" };
    const request: VendorPriceRequest = { vendorKey: "apimart", request: {
      kind: kind === "image" ? "text_to_image" : "text_to_video", prompt: "local projection only",
      extras: kind === "image" ? {
        modelKey: "gpt-image-2.6-flare", archetype: { id: "gpt-image-2.6-flare", modeId: "t2i" },
        archetypeInput: { size: "1:1", resolution: "1K", quality: "medium", background: "auto" },
      } : {
        modelKey: "doubao-seedance-2.0", archetype: { id: "seedance-2-apimart", modeId: "t2v", variantId: "mini" },
        archetypeInput: { resolution: "720p", duration: 5, generate_audio: false },
      },
    } };
    const mapping = catalog.mappings.find(m => m.vendorKey === request.vendorKey && m.modelKey === request.request.extras?.modelKey && m.taskKind === request.request.kind)!;
    expect(mapping.create?.method).toBe("POST");
    mapping.create!.headers = { Authorization: `Bearer ${secret}` };
    mapping.create!.query = { api_key: secret };
    vi.mocked(readCatalog).mockReturnValue(catalog);
    vi.mocked(appFetch).mockClear();
    const nativeFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected native transport"));
    try {
      const projected = priceQueryFromRequest(request, catalog);
      expect(projected).toMatchObject({ kind, count: 1, referenceCount: 0 });
      expect(projected).not.toHaveProperty("url");
      expect(projected).not.toHaveProperty("headers");
      expect(projected).not.toHaveProperty("body");
      expect(JSON.stringify(projected)).not.toContain(secret);
      expect(appFetch).not.toHaveBeenCalled();
      vi.mocked(appFetch).mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        expect(url.origin).toBe("https://api.apimart.ai");
        expect(["/api/pricing/model", "/api/pricing/models/all"]).toContain(url.pathname);
        expect(init?.method).toBe("GET");
        expect(init?.headers).toBeUndefined();
        expect(init?.body).toBeUndefined();
        expect(init?.redirect).toBe("error");
        expect(JSON.stringify([input, init])).not.toContain(secret);
        expect([...url.searchParams.keys()]).toEqual(url.pathname.endsWith("/all") ? [] : ["model"]);
        return Response.json({ success: true, data: url.pathname.endsWith("/all")
          ? { models: { image: [{ id: projected!.modelId, specification: "image", fixed_prices: { unit: "usd_per_image" } }] } }
          : { model_name: projected!.modelId, membership: { category: kind }, billing_type: kind === "video" ? "per_second" : "per_image", paid_price: 0.01 } });
      });
      expect(await readVendorPricePreview(projected!)).not.toBeNull();
      expect(appFetch).toHaveBeenCalledTimes(kind === "image" ? 2 : 1);
      expect(nativeFetch).not.toHaveBeenCalled();
      const reads = vi.mocked(appFetch).mock.calls.length;
      mapping.create!.method = "GET";
      expect(priceQueryFromRequest(request, catalog)).toBeNull();
      mapping.create!.method = "POST";
      mapping.create!.path = "https://elsewhere.example/v1/images/generations";
      expect(priceQueryFromRequest(request, catalog)).toBeNull();
      expect(appFetch).toHaveBeenCalledTimes(reads);
    } finally {
      nativeFetch.mockRestore();
    }
  });

  it("follows the official fallback origin the self-healing ladder switched to; never a hard-coded primary", async () => {
    // 不开代理的国内创作者：主域连不上，梯子已把 apimart 换到官方备用域（落盘状态）。连接里存的仍是主域。
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "price-fallback-"));
    const file = path.join(dir, "vendor-base.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, overrides: { apimart: "https://api.aiuxu.com" } }));
    resetVendorBaseFallbackForTests();
    configureVendorBaseFallback(file, { restoreDelayMs: 9_999_999 });
    try {
      vi.mocked(readCatalog).mockReturnValue({ vendors: [{ key: "apimart", baseUrlHint: "https://api.apimart.ai/v1" }] } as ReturnType<typeof readCatalog>);
      vi.mocked(appFetch).mockReset();
      vi.mocked(appFetch).mockImplementation(async (input) => {
        expect(new URL(String(input)).origin).toBe("https://api.aiuxu.com");
        return Response.json({ success: true, data });
      });
      const fallbackQuery = { ...q, durationSec: 7 };
      const quoted = await readVendorPricePreview(fallbackQuery);
      expect(vi.mocked(appFetch).mock.calls.map(([input]) => new URL(String(input)).origin)).toEqual(["https://api.aiuxu.com"]);
      expect(quoted?.source).toBe("https://api.aiuxu.com/api/pricing/model?model=doubao-seedance-2.0-mini");
      // 连接本身存成了官方备用域（以前手动填过）也认；不在代码声明里的域不认。
      vi.mocked(readCatalog).mockReturnValue({ vendors: [{ key: "apimart", baseUrlHint: "https://api.aishuch.com/v1" }] } as ReturnType<typeof readCatalog>);
      expect(await readVendorPricePreview({ ...q, durationSec: 8 })).not.toBeNull();
    } finally {
      resetVendorBaseFallbackForTests();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
