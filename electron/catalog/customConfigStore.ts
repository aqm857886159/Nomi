import { isJsonRecord, nowIso } from "../jsonUtils";
import {
  type ApiKeyRecord,
  encryptCustomSecretValue,
  isSafeStorageAvailable,
} from "./secrets";
import type { CatalogState, Vendor } from "./types";

export type CustomCallConfigPublicEntry = { name: string; hasValue: true };
export type CustomCallConfigPatchEntry = { name: string; value?: string; keepFrom?: string };

export function normalizedCustomConfig(raw: unknown): Record<string, string> {
  if (!isJsonRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(raw)) {
    const name = rawName.trim();
    if (!name) continue;
    if (typeof rawValue === "string") out[name] = rawValue;
    else if (typeof rawValue === "number" || typeof rawValue === "boolean") out[name] = String(rawValue);
    else if (rawValue === null) out[name] = "";
  }
  return out;
}

export function withoutLegacyCustomConfig(meta: unknown): unknown {
  if (!isJsonRecord(meta) || !Object.prototype.hasOwnProperty.call(meta, "customConfig")) return meta;
  const clean = { ...meta };
  delete clean.customConfig;
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function legacyCustomConfig(vendor: Vendor | undefined): Record<string, string> {
  const meta = isJsonRecord(vendor?.meta) ? vendor.meta : {};
  return normalizedCustomConfig(meta.customConfig);
}

export function credentialRecord(state: CatalogState, vendorKey: string): ApiKeyRecord {
  const existing = state.apiKeysByVendor[vendorKey];
  if (existing) return existing;
  const t = nowIso();
  return { vendorKey, apiKey: "", enc: "plain", enabled: false, createdAt: t, updatedAt: t };
}

export function applyPlainCustomConfig(
  state: CatalogState,
  vendorKey: string,
  config: Record<string, string>,
): void {
  const existing = credentialRecord(state, vendorKey);
  const encrypted = Object.fromEntries(
    Object.entries(config).map(([name, value]) => [name, encryptCustomSecretValue(value)]),
  );
  if (Object.keys(encrypted).length > 0) {
    state.apiKeysByVendor[vendorKey] = { ...existing, customConfig: encrypted, updatedAt: nowIso() };
  } else if (existing.apiKey) {
    const rest = { ...existing };
    delete rest.customConfig;
    state.apiKeysByVendor[vendorKey] = { ...rest, updatedAt: nowIso() };
  } else {
    delete state.apiKeysByVendor[vendorKey];
  }
}

export function publicVendor(vendor: Vendor): Vendor {
  return { ...vendor, meta: withoutLegacyCustomConfig(vendor.meta) };
}

/** Returns null while OS safe storage is unavailable so the caller can retry on the next read. */
export function migrateLegacyCustomConfigSecrets(state: CatalogState): CatalogState | null {
  const legacy = state.vendors
    .map((vendor) => ({ vendor, config: legacyCustomConfig(vendor) }))
    .filter(({ config }) => Object.keys(config).length > 0);
  if (legacy.length > 0 && !isSafeStorageAvailable()) return null;

  const next: CatalogState = {
    ...state,
    version: 9,
    vendors: state.vendors.map((vendor) => ({ ...vendor, meta: withoutLegacyCustomConfig(vendor.meta) })),
    apiKeysByVendor: { ...(state.apiKeysByVendor || {}) },
  };
  for (const { vendor, config } of legacy) applyPlainCustomConfig(next, vendor.key, config);
  return next;
}

/** Mutates one in-memory catalog transaction; persistence stays at the catalog store choke point. */
export function replaceCustomCallConfig(
  state: CatalogState,
  vendorKey: string,
  payload: unknown,
): CustomCallConfigPublicEntry[] {
  const key = String(vendorKey || "").trim();
  const vendorIndex = state.vendors.findIndex((item) => item.key === key);
  if (vendorIndex < 0) throw new Error(`供应商不存在：${key}`);
  const rawEntries = Array.isArray(payload) ? payload : [];
  const current = state.apiKeysByVendor[key]?.customConfig || {};
  const legacy = legacyCustomConfig(state.vendors[vendorIndex]);
  const next: NonNullable<ApiKeyRecord["customConfig"]> = {};
  for (const rawEntry of rawEntries) {
    if (!isJsonRecord(rawEntry)) continue;
    const name = String(rawEntry.name || "").trim();
    if (!name) continue;
    if (Object.prototype.hasOwnProperty.call(rawEntry, "value")) {
      next[name] = encryptCustomSecretValue(String(rawEntry.value ?? ""));
      continue;
    }
    const source = String(rawEntry.keepFrom || "").trim();
    if (source && current[source]) {
      next[name] = current[source];
      continue;
    }
    if (source && Object.prototype.hasOwnProperty.call(legacy, source)) {
      next[name] = encryptCustomSecretValue(legacy[source]);
      continue;
    }
    throw new Error(`自定义配置 ${name} 没有可保留的已存值，请重新输入`);
  }

  const existing = credentialRecord(state, key);
  if (Object.keys(next).length > 0) {
    state.apiKeysByVendor[key] = { ...existing, customConfig: next, updatedAt: nowIso() };
  } else if (existing.apiKey) {
    const rest = { ...existing };
    delete rest.customConfig;
    state.apiKeysByVendor[key] = { ...rest, updatedAt: nowIso() };
  } else {
    delete state.apiKeysByVendor[key];
  }
  state.vendors[vendorIndex] = {
    ...state.vendors[vendorIndex],
    meta: withoutLegacyCustomConfig(state.vendors[vendorIndex].meta),
  };
  return Object.keys(next)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ name, hasValue: true }));
}
