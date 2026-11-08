import { appFetch } from "../../appFetch";
import { builtinVendorSeed } from "../../catalog/builtinVendorSeeds";
import { isJsonRecord } from "../../jsonUtils";
import { builtinVendorKeyOfKey } from "../../shared/builtinVendorIdentity";
import type { VendorAccountFacts } from "../../shared/contracts/vendorAccountFacts";
import { createExplicitProxyDispatcher } from "../../systemProxy";
import { resolveVendorReadTarget } from "./vendorHealth";

type Target = NonNullable<ReturnType<typeof resolveVendorReadTarget>>;
type Reply = { status: number; data: Record<string, unknown> | null };
const cache = new Map<string, { fingerprint: string; expires: number; reading: Promise<VendorAccountFacts> }>();
const CACHE_MS = 30_000;
const WEEK_SECONDS = 7 * 24 * 60 * 60;

async function read(target: Target, url: URL): Promise<Reply> {
  try {
    for (const [name, value] of Object.entries(target.query)) url.searchParams.set(name, value);
    const response = await appFetch(url, {
      method: "GET", headers: target.headers, signal: AbortSignal.timeout(12_000),
      ...(target.proxyUrl ? { dispatcher: createExplicitProxyDispatcher(target.proxyUrl) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status, data: null };
    }
    const body: unknown = await response.json();
    return { status: response.status, data: isJsonRecord(body) && body.success === true ? body : null };
  } catch {
    return { status: 0, data: null };
  }
}

function nonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

async function readSnapshot(vendorKey: string, target: Target, keyUrl: URL, accountUrl: URL, usageUrl: URL): Promise<VendorAccountFacts> {
  const end = Math.floor(Date.now() / 1000);
  usageUrl.searchParams.set("scope", "account");
  usageUrl.searchParams.set("start", String(end - WEEK_SECONDS));
  usageUrl.searchParams.set("end", String(end));
  const [key, account, usage] = await Promise.all([read(target, keyUrl), read(target, accountUrl), read(target, usageUrl)]);
  const total = isJsonRecord(usage.data?.data) && isJsonRecord(usage.data.data.total) ? usage.data.data.total : null;
  return {
    vendorKey, checkedAt: Date.now(),
    keyState: key.data ? "valid" : key.status === 401 ? "invalid" : "unknown",
    accountCredits: nonnegative(account.data?.remain_credits),
    keyCredits: nonnegative(key.data?.remain_credits),
    keyUnlimited: key.data?.unlimited_quota === true,
    usageCredits: nonnegative(total?.credits),
    usageRequests: nonnegative(total?.requests),
  };
}

export async function readVendorAccountFacts(vendorKey: string, force = false): Promise<VendorAccountFacts | null> {
  const seed = builtinVendorSeed(builtinVendorKeyOfKey(vendorKey));
  const routes = seed?.accountFacts;
  const probe = seed?.credentialProbe;
  if (!routes || probe?.cost !== "free" || probe.request.method !== "GET") return null;
  const target = resolveVendorReadTarget(vendorKey);
  if (!target || !URL.canParse(target.baseUrl)) {
    cache.delete(vendorKey);
    return null;
  }
  const base = new URL(target.baseUrl);
  if (![new URL(seed.baseUrl).origin, ...routes.alternateOrigins].includes(base.origin)
      || !["/", "/v1", "/v1/"].includes(base.pathname) || base.username || base.password) {
    cache.delete(vendorKey);
    return null;
  }
  let entry = cache.get(vendorKey);
  if (!entry || entry.fingerprint !== target.fingerprint || (entry.expires !== Infinity && (force || entry.expires <= Date.now()))) {
    entry = {
      fingerprint: target.fingerprint, expires: Infinity,
      reading: readSnapshot(vendorKey, target, new URL(probe.request.path, base), new URL(routes.accountPath, base), new URL(routes.usagePath, base)),
    };
    cache.set(vendorKey, entry);
  }
  const snapshot = await entry.reading;
  entry.expires = snapshot.checkedAt + CACHE_MS;
  // A different key or endpoint can be installed while the three requests are in flight.
  return resolveVendorReadTarget(vendorKey)?.fingerprint === entry.fingerprint ? snapshot : null;
}
