import { describe, expect, it, vi } from "vitest";
import { APIMART_VENDOR_SEED } from "../../catalog/apimartVendor";
import type { CatalogState } from "../../catalog/types";
import { checkVendorAccountBalance, parseVendorAccountBalance, readVendorAccountBalance } from "./vendorAccountBalance";

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

  it("rejects a logical HTTP-200 failure even when its payload carries a balance", () => {
    expect(parseVendorAccountBalance({ code: 401, data: { remain_credits: 12 } }, TOP_UP, NOW)).toBeNull();
    expect(parseVendorAccountBalance({ code: 200, data: { remain_credits: 12 } }, TOP_UP, NOW)?.remainCredits).toBe(12);
  });

  it("returns null on malformed or missing balance payloads", () => {
    expect(parseVendorAccountBalance(null, TOP_UP, NOW)).toBeNull();
    expect(parseVendorAccountBalance({}, TOP_UP, NOW)).toBeNull();
    expect(parseVendorAccountBalance({ remain_balance: -5 }, TOP_UP, NOW)).toBeNull();
  });
});

describe("readVendorAccountBalance", () => {
  it("reads GET /v1/user/balance with Bearer key for official APIMart origin", async () => {
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
    expect(String(url)).toBe("https://api.apimart.ai/v1/user/balance");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer sk-test-balance");
  });

  it("returns only the account snapshot to send-side readers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => String(url).endsWith("/v1/user/balance")
      ? Response.json({ remain_balance: 3 }) : Response.json({ remain_balance: -1 }));
    const balance = await readVendorAccountBalance({ vendorKey: "apimart" }, {
      catalog: makeCatalog(), resolveApiKey: () => "sk-fixture", fetchImpl,
    });
    expect(balance).toMatchObject({ remainCredits: 30, remainUsd: 3, unlimited: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

describe("onboarding balance diagnostics", () => {
  const options = { catalog: makeCatalog(undefined, false), candidateKey: "sk-fixture" };
  const request = { vendorKey: "apimart" };
  function endpoints(account: () => Response, key: () => Response) {
    return vi.fn<typeof fetch>(async (input, init) => {
      expect(init).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: "Bearer sk-fixture" } });
      const url = new URL(String(input));
      expect(url.origin).toBe(APIMART_VENDOR_SEED.baseUrl);
      if (url.pathname === "/v1/user/balance") return account();
      expect(url.pathname).toBe("/v1/balance");
      return key();
    });
  }
  it.each([
    { funds: 0, quota: { unlimited_quota: true }, limit: null, unlimited: true },
    { funds: 52.3, quota: { remain_balance: 0 }, limit: 0, unlimited: false },
    { funds: 0, quota: { remain_credits: 0, unlimited_quota: true }, limit: null, unlimited: true },
    { funds: 52.3, quota: { remain_balance: -1 }, limit: null, unlimited: true },
    { funds: 7, quota: { remain_credits: 11 }, limit: 11, unlimited: false },
  ])("keeps account $funds independent of key $quota", async ({ funds, quota, limit, unlimited }) => {
    const fetchImpl = endpoints(() => Response.json({ remain_credits: funds }), () => Response.json(quota));
    expect(await checkVendorAccountBalance(request, { ...options, fetchImpl })).toMatchObject({
      status: "received", accountBalance: { remainCredits: funds }, keyQuota: { remainCredits: limit, unlimited },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  const offline = () => { throw new TypeError("offline"); };
  it.each([
    ...[401, 403, 404, 500].map((status) => () => new Response(null, { status })),
    () => Response.json({}), () => Response.json({ remain_balance: -1 }), () => Response.json({ success: false, remain_balance: 0 }), () => new Response("html"), offline,
  ])("keeps unreadable account funds unknown even with an empty key", async (account) => {
    const fetchImpl = endpoints(account, () => Response.json({ remain_credits: 0 }));
    expect(await checkVendorAccountBalance(request, { ...options, fetchImpl })).toMatchObject({
      status: "received", accountBalance: null, keyQuota: { remainCredits: 0 },
    });
  });
  it("keeps an unlabeled amount separate from reported credits", async () => {
    const fetchImpl = endpoints(() => Response.json({ remain_balance: 0.75 }), () => Response.json({ remain_credits: 7 }));
    const result = await checkVendorAccountBalance(request, { ...options, fetchImpl });
    expect(result).toMatchObject({
      status: "received", accountBalance: { remainCredits: null, reportedBalance: 0.75 },
      keyQuota: { remainCredits: 7, reportedBalance: null },
    });
  });
  it.each([401, 403])("reports an explicit key refusal (HTTP %s)", async (status) => {
    const fetchImpl = endpoints(() => Response.json({ remain_credits: 12 }), () => new Response(null, { status }));
    expect(await checkVendorAccountBalance(request, { ...options, fetchImpl })).toEqual({ status: "invalid" });
  });
  it("reports offline only if neither endpoint responds", async () => {
    const read = (account: () => Response) => checkVendorAccountBalance(request, { ...options, fetchImpl: endpoints(account, offline) });
    expect(await read(offline)).toEqual({ status: "offline" });
    expect(await read(() => Response.json({ remain_balance: 1 }))).toMatchObject({
      status: "received", accountBalance: { reportedBalance: 1 }, keyQuota: null,
    });
  });
});
