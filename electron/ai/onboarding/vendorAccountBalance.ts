import { readCatalog } from "../../catalog/catalogStore";
import { builtinVendorSeed } from "../../catalog/builtinVendorSeeds";
import { decryptApiKeyRecord, type ApiKeyRecord } from "../../catalog/secrets";
import type { CatalogState } from "../../catalog/types";
import { userVendorBaseUrl } from "../../catalog/userVendorBase";
import { findIllegalHeader, isJsonRecord } from "../../jsonUtils";
import { builtinVendorKeyOfKey } from "../../shared/builtinVendorIdentity";
import type { VendorAccountBalance, VendorAccountBalanceRequest } from "../../shared/contracts/vendorAccountBalance";
import { codeDeclaredFallbackOrigins, fetchVendorWithBaseFallback } from "../../vendor/vendorBaseFallback";
import { authorizeSubmitDestination } from "../../vendor/vendorOutboundGuard";

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Pure parser for APIMart `GET /v1/balance` response payloads.
 * Supports both top-level `{ remain_balance, remain_credits }` and wrapped `{ data: { ... } }`.
 * Negative `-1` sentinel means unlimited quota per APIMart documentation.
 */
export function parseVendorAccountBalance(
  body: unknown,
  topUpUrl: string,
  fetchedAt = Date.now(),
): VendorAccountBalance | null {
  if (!isJsonRecord(body)) return null;
  const payload = isJsonRecord(body.data) && (
    "remain_balance" in body.data || "remain_credits" in body.data
  ) ? body.data : body;
  const remainUsd = finiteNumber(payload.remain_balance);
  const remainCreditsRaw = finiteNumber(payload.remain_credits);
  if (remainUsd === -1 || remainCreditsRaw === -1) {
    return { remainCredits: null, remainUsd: null, unlimited: true, topUpUrl, fetchedAt };
  }
  if (remainCreditsRaw !== null && remainCreditsRaw >= 0) {
    const usd = remainUsd !== null && remainUsd >= 0 ? remainUsd : remainCreditsRaw / 10;
    return { remainCredits: remainCreditsRaw, remainUsd: usd, unlimited: false, topUpUrl, fetchedAt };
  }
  if (remainUsd !== null && remainUsd >= 0) {
    return { remainCredits: remainUsd * 10, remainUsd, unlimited: false, topUpUrl, fetchedAt };
  }
  return null;
}

/**
 * Read-only balance check for official built-in vendors that declare `accountBalance`.
 * Decoupled from `vendorPricePreview` (public pricing is unauthenticated and cached separately).
 * Enforces `decryptApiKeyRecord`, official origin allowlist, `authorizeSubmitDestination`,
 * `redirect: "error"`, and `fetchVendorWithBaseFallback` (matching `vendorPricePreview`).
 * Any failure returns null so sending is never blocked.
 */
export async function readVendorAccountBalance(
  payload: VendorAccountBalanceRequest,
  options: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    catalog?: CatalogState;
    resolveApiKey?: (rec: ApiKeyRecord | undefined) => string;
  } = {},
): Promise<VendorAccountBalance | null> {
  const vendorKey = typeof payload?.vendorKey === "string" ? payload.vendorKey.trim() : "";
  if (!vendorKey) return null;
  const builtinKey = builtinVendorKeyOfKey(vendorKey);
  const seed = builtinVendorSeed(builtinKey);
  const config = seed?.accountBalance;
  if (!seed || !config) return null;
  const catalog = options.catalog ?? readCatalog();
  const vendor = catalog.vendors.find((row) => row.key === vendorKey && row.enabled);
  if (!vendor) return null;
  const apiKey = (options.resolveApiKey ?? decryptApiKeyRecord)(catalog.apiKeysByVendor[vendor.key]);
  if (!apiKey) return null;
  const base = userVendorBaseUrl(vendor);
  if (!URL.canParse(base)) return null;
  const parsedBase = new URL(base);
  const allowedOrigins = [new URL(seed.baseUrl).origin, ...codeDeclaredFallbackOrigins(builtinKey)];
  if (
    parsedBase.username
    || parsedBase.password
    || !["/", "/v1", "/v1/"].includes(parsedBase.pathname)
    || !allowedOrigins.includes(parsedBase.origin)
  ) {
    return null;
  }
  const target = new URL(config.path, parsedBase.origin);
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (findIllegalHeader(headers)) return null;
  const refusal = await authorizeSubmitDestination({
    vendor,
    url: target.href,
    carriesCredential: true,
  });
  if (refusal) return null;
  const doFetch = options.fetchImpl ?? fetchVendorWithBaseFallback;
  try {
    const response = await doFetch(target.href, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const body = await response.json();
    return parseVendorAccountBalance(body, config.topUpUrl, (options.now ?? Date.now)());
  } catch {
    return null;
  }
}
