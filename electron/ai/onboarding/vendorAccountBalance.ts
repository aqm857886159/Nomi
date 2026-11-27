import { createHash } from "node:crypto";
import { readCatalog } from "../../catalog/catalogStore";
import { builtinVendorSeed } from "../../catalog/builtinVendorSeeds";
import { decryptApiKeyRecord, type ApiKeyRecord } from "../../catalog/secrets";
import type { CatalogState } from "../../catalog/types";
import { userVendorBaseUrl } from "../../catalog/userVendorBase";
import { vendorAuthSpec } from "../../catalog/vendorAuthSpec";
import { findIllegalHeader, isJsonRecord } from "../../jsonUtils";
import { builtinVendorKeyOfKey } from "../../shared/builtinVendorIdentity";
import type { VendorAccountBalance, VendorAccountBalanceRequest, VendorBalanceCheck, VendorBalanceFailure, VendorReportedBalance } from "../../shared/contracts/vendorAccountBalance";
import { codeDeclaredFallbackOrigins, fetchVendorWithBaseFallback } from "../../vendor/vendorBaseFallback";
import { authorizeSubmitDestination } from "../../vendor/vendorOutboundGuard";
import { authHeaders } from "../requestPipeline";

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

type BalanceSubject = "account" | "key";

function parseReportedBalance(body: unknown, subject: BalanceSubject): VendorReportedBalance | null {
  if (!isJsonRecord(body) || body.success === false) return null;
  const payload = isJsonRecord(body.data) ? body.data : body;
  if (payload.success === false) return null;
  const amount = finiteNumber(payload.remain_balance);
  const credits = finiteNumber(payload.remain_credits);
  if (subject === "key" && (payload.unlimited_quota === true || amount === -1 || credits === -1)) {
    return { remainCredits: null, reportedBalance: null, unlimited: true };
  }
  const reportedBalance = amount !== null && amount >= 0 ? amount : null;
  const remainCredits = credits !== null && credits >= 0 ? credits : null;
  if (reportedBalance === null && remainCredits === null) return null;
  // Zero is independent of the configured unit. A positive amount alone cannot prove a credit count.
  return { remainCredits: remainCredits ?? (reportedBalance === 0 ? 0 : null), reportedBalance, unlimited: false };
}

/** Preserve the #1624 snapshot and its balance-only conversion for existing send-side callers. */
export function parseVendorAccountBalance(
  body: unknown,
  topUpUrl: string,
  fetchedAt = Date.now(),
  subject: BalanceSubject = "key",
): VendorAccountBalance | null {
  const reading = parseReportedBalance(body, subject);
  if (!reading) return null;
  const { reportedBalance, unlimited } = reading;
  const remainCredits = reading.remainCredits ?? (reportedBalance !== null ? reportedBalance * 10 : null);
  return { remainCredits, remainUsd: reportedBalance, unlimited, topUpUrl, fetchedAt };
}

type BalanceReadOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  catalog?: CatalogState;
  resolveApiKey?: (rec: ApiKeyRecord | undefined) => string;
};

type EndpointResult =
  | { status: "received"; body: unknown }
  | { status: VendorBalanceFailure };

function balanceReader(payload: VendorAccountBalanceRequest, options: BalanceReadOptions & { candidateKey?: string }) {
  const vendorKey = typeof payload?.vendorKey === "string" ? payload.vendorKey.trim() : "";
  if (!vendorKey) return null;
  const builtinKey = builtinVendorKeyOfKey(vendorKey);
  const seed = builtinVendorSeed(builtinKey);
  const config = seed?.accountBalance;
  if (!seed || !config) return null;
  const catalog = options.catalog ?? readCatalog();
  const vendor = catalog.vendors.find((row) => row.key === vendorKey && (options.candidateKey !== undefined || row.enabled));
  if (!vendor) return null;
  const resolveApiKey = options.resolveApiKey ?? decryptApiKeyRecord;
  const apiKey = (options.candidateKey ?? resolveApiKey(catalog.apiKeysByVendor[vendor.key])).trim();
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
  const headers = authHeaders(vendorAuthSpec(vendor), apiKey);
  if (findIllegalHeader(headers)) return null;
  const doFetch = options.fetchImpl ?? fetchVendorWithBaseFallback;
  const read = async (subject: BalanceSubject): Promise<EndpointResult> => {
    const path = subject === "account" ? config.userBalancePath : config.path;
    const target = new URL(path, parsedBase.origin);
    const refusal = await authorizeSubmitDestination({ vendor, url: target.href, carriesCredential: true });
    if (refusal) return { status: "unavailable" };
    try {
      const response = await doFetch(target.href, {
        method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (subject === "key" && (response.status === 401 || response.status === 403)) return { status: "invalid" };
        return { status: "received", body: null };
      }
      const body = await response.json().catch(() => null);
      return { status: "received", body };
    } catch {
      return { status: "offline" };
    }
  };
  return {
    read,
    topUpUrl: config.topUpUrl,
    get checkedKeyId() { return createHash("sha256").update(apiKey).digest("hex"); },
  };
}

/** Account-only snapshot used beside the send button. */
export async function readVendorAccountBalance(
  payload: VendorAccountBalanceRequest,
  options: BalanceReadOptions = {},
): Promise<VendorAccountBalance | null> {
  const reader = balanceReader(payload, options);
  if (!reader) return null;
  const result = await reader.read("account");
  return result.status === "received"
    ? parseVendorAccountBalance(result.body, reader.topUpUrl, (options.now ?? Date.now)(), "account")
    : null;
}

export async function checkVendorAccountBalance(
  payload: VendorAccountBalanceRequest,
  options: BalanceReadOptions & { candidateKey?: string } = {},
): Promise<VendorBalanceCheck> {
  const reader = balanceReader(payload, options);
  if (!reader) return { status: "unavailable" };
  const [account, key] = await Promise.all([reader.read("account"), reader.read("key")]);
  if (key.status === "invalid") return { status: "invalid", checkedKeyId: reader.checkedKeyId };
  if (account.status === "unavailable" || key.status === "unavailable") return { status: "unavailable" };
  if (account.status === "offline" && key.status === "offline") return { status: "offline", checkedKeyId: reader.checkedKeyId };
  return {
    status: "received",
    checkedKeyId: reader.checkedKeyId,
    accountBalance: account.status === "received" ? parseReportedBalance(account.body, "account") : null,
    keyQuota: key.status === "received" ? parseReportedBalance(key.body, "key") : null,
  };
}
