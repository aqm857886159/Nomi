import { createHash } from "node:crypto";
import type { ModelAccountBalance } from "../../shared/contracts/modelSettingsAccount";
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
  const apiKey = options.candidateKey ?? (options.resolveApiKey ?? decryptApiKeyRecord)(catalog.apiKeysByVendor[vendor.key]);
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
  return { read, topUpUrl: config.topUpUrl, keySuffix: apiKey.length > 4 ? apiKey.slice(-4) : "" };
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
  if (key.status === "invalid") return { status: "invalid" };
  if (account.status === "unavailable" || key.status === "unavailable") return { status: "unavailable" };
  if (account.status === "offline" && key.status === "offline") return { status: "offline" };
  return {
    status: "received",
    accountBalance: account.status === "received" ? parseReportedBalance(account.body, "account") : null,
    keyQuota: key.status === "received" ? parseReportedBalance(key.body, "key") : null,
  };
}

const settingsCache = new Map<string, {
  revision: string;
  expires: number;
  reading: Promise<ModelAccountBalance>;
  last?: ModelAccountBalance;
}>();

function settingsAccountTarget(key: string) {
  if (typeof key !== "string" || builtinVendorKeyOfKey(key) !== "apimart") return null;
  const catalog = readCatalog();
  const vendor = catalog.vendors.find(row => row.key === key && row.enabled);
  const record = catalog.apiKeysByVendor[key];
  if (!vendor || !record?.enabled) return null;
  const revision = createHash("sha256").update(JSON.stringify([record, userVendorBaseUrl(vendor), vendor.credentialBinding, vendorAuthSpec(vendor)])).digest("hex");
  return { catalog, revision };
}

export async function readModelSettingsAccount(key: string, refresh = false): Promise<ModelAccountBalance | null> {
  const target = settingsAccountTarget(key);
  if (!target) { settingsCache.delete(key); return null; }
  let entry = settingsCache.get(key);
  if (!entry || entry.revision !== target.revision || (entry.expires !== Infinity && (refresh || entry.expires <= Date.now()))) {
    const reader = balanceReader({ vendorKey: key }, { catalog: target.catalog });
    if (!reader) return null;
    const last = entry?.revision === target.revision ? entry.last : undefined;
    const reading = Promise.all([reader.read("account"), reader.read("key")]).then(([account, keyResult]) => {
      const accountCredits = account.status === "received" ? parseReportedBalance(account.body, "account")?.remainCredits : null;
      const quota = keyResult.status === "received" ? parseReportedBalance(keyResult.body, "key") : null;
      const quotaReady = quota?.unlimited || quota?.remainCredits != null;
      return {
        keySuffix: reader.keySuffix,
        accountCredits: accountCredits ?? last?.accountCredits ?? null,
        keyCredits: quotaReady ? quota.remainCredits : last?.keyCredits ?? null,
        unlimited: quotaReady ? quota.unlimited : last?.unlimited ?? false,
        accountStaleSince: accountCredits == null && last?.accountCredits != null ? last.accountStaleSince ?? last.observedAt : null,
        quotaStaleSince: !quotaReady && last && (last.unlimited || last.keyCredits !== null) ? last.quotaStaleSince ?? last.observedAt : null,
        observedAt: Date.now(),
      };
    });
    entry = { revision: target.revision, expires: Infinity, reading };
    settingsCache.set(key, entry);
  }
  const snapshot = await entry.reading;
  entry.last = snapshot;
  entry.expires = snapshot.observedAt + 30_000;
  return settingsAccountTarget(key)?.revision === entry.revision ? snapshot : null;
}
