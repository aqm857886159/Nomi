import { describe, expect, it, vi } from "vitest";
import { APIMART_VENDOR_SEED } from "../../catalog/apimartVendor";
import type { CatalogState } from "../../catalog/types";
import { parseVendorAccountBalance, readVendorAccountBalance } from "./vendorAccountBalance";

const NOW = 1_763_800_000_000;
const TOP_UP = APIMART_VENDOR_SEED.accountBalance.topUpUrl;

function makeCatalog(baseUrlHint: string = APIMART_VENDOR_SEED.baseUrl, enabled = true): CatalogState {
  return {
    version: 1,
    vendors: [
      {
        key: "apimart",
        name: "APIMart",
        baseUrlHint,
        authType: "bearer",
        enabled,
        createdAt: "2026-11-22T00:00:00.000Z",
        updatedAt: "2026-11-22T00:00:00.000Z",
      },
    ],
    models: [],
    mappings: [],
    apiKeysByVendor: {
      apimart: {
        vendorKey: "apimart",
        apiKey: "encrypted",
        enc: "safeStorage",
        enabled: true,
        createdAt: "2026-11-22T00:00:00.000Z",
        updatedAt: "2026-11-22T00:00:00.000Z",
      },
    },
  } as unknown as CatalogState;
}

describe("parseVendorAccountBalance", () => {
  it("parses APIMart remain_credits and remain_balance", () => {
    expect(parseVendorAccountBalance({ success: true, remain_balance: 1.2, remain_credits: 12 }, TOP_UP, NOW)).toEqual({
      remainCredits: 12,
      remainUsd: 1.2,
      unlimited: false,
      topUpUrl: TOP_UP,
      fetchedAt: NOW,
    });
  });

  it("derives remainCredits from remain_balance × 10 when remain_credits is absent", () => {
    expect(parseVendorAccountBalance({ data: { remain_balance: 0.75 } }, TOP_UP, NOW)).toEqual({
      remainCredits: 7.5,
      remainUsd: 0.75,
      unlimited: false,
      topUpUrl: TOP_UP,
      fetchedAt: NOW,
    });
  });

  it("treats APIMart -1 sentinel as unlimited so sending is never blocked", () => {
    expect(parseVendorAccountBalance({ remain_balance: -1 }, TOP_UP, NOW)).toEqual({
      remainCredits: null,
      remainUsd: null,
      unlimited: true,
      topUpUrl: TOP_UP,
      fetchedAt: NOW,
    });
  });

  it("returns null on malformed or missing balance payloads", () => {
    expect(parseVendorAccountBalance(null, TOP_UP, NOW)).toBeNull();
    expect(parseVendorAccountBalance({}, TOP_UP, NOW)).toBeNull();
    expect(parseVendorAccountBalance({ remain_balance: -5 }, TOP_UP, NOW)).toBeNull();
  });
});

describe("readVendorAccountBalance", () => {
  it("reads GET /v1/balance with Bearer key for official APIMart origin", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true, remain_balance: 0.25, remain_credits: 2.5 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const out = await readVendorAccountBalance(
      { vendorKey: "apimart" },
      { catalog: makeCatalog(), resolveApiKey: () => "sk-test-balance", fetchImpl, now: () => NOW },
    );
    expect(out).toEqual({ remainCredits: 2.5, remainUsd: 0.25, unlimited: false, topUpUrl: TOP_UP, fetchedAt: NOW });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.apimart.ai/v1/balance");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer sk-test-balance");
  });

  it("refuses custom relay origins and missing keys with 0 outbound calls", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await readVendorAccountBalance(
      { vendorKey: "apimart" },
      { catalog: makeCatalog("https://relay.example.test"), resolveApiKey: () => "sk-test", fetchImpl },
    )).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    expect(await readVendorAccountBalance(
      { vendorKey: "apimart" },
      { catalog: makeCatalog(), resolveApiKey: () => "", fetchImpl },
    )).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null on HTTP 401/500 or network error so sending falls back cleanly", async () => {
    const errFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    expect(await readVendorAccountBalance(
      { vendorKey: "apimart" },
      { catalog: makeCatalog(), resolveApiKey: () => "sk-test", fetchImpl: errFetch },
    )).toBeNull();

    const failFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await readVendorAccountBalance(
      { vendorKey: "apimart" },
      { catalog: makeCatalog(), resolveApiKey: () => "sk-test", fetchImpl: failFetch },
    )).toBeNull();
  });
});
