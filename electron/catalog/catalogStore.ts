import crypto from "node:crypto";
import path from "node:path";
import { isJsonRecord, nowIso, type JsonRecord } from "../jsonUtils";
import { sanitizeName } from "../projects/repository";
import { writeJsonFileAtomic } from "../jsonFile";
import { CATALOG_FILE, getSettingsRoot, readJson } from "../runtimePaths";
import { type ApiKeyRecord, decryptApiKeyRecord, isSafeStorageAvailable, makeApiKeyRecordFromPlain } from "./secrets";
import { humanizeModelKey } from "./modelLabel";
import { applyBuiltinSeeds } from "./seedBuiltins";
import type { AiSdkProviderKind, BillingModelKind, CatalogState, HttpOperation, Mapping, Model, ProfileKind, Vendor } from "./types";
import { CURRENT_CATALOG_VERSION } from "./types";

function catalogPath(): string {
  return path.join(getSettingsRoot(), CATALOG_FILE);
}

function defaultCatalog(): CatalogState {
  // v0.8: empty catalog. Fresh users add their own models via the Wizard.
  // No more phantom seed entries (chatfire/sora/gpt-4o-mini) that have no keys.
  return {
    version: CURRENT_CATALOG_VERSION,
    vendors: [],
    models: [],
    mappings: [],
    apiKeysByVendor: {},
  };
}

export function readCatalog(): CatalogState {
  const parsed = readJson<CatalogState | null>(catalogPath(), null);
  if (!parsed) {
    const initial = defaultCatalog();
    writeCatalog(initial);
    return initial;
  }

  // Migrate forward. v1 → v2: tag pre-existing keys as plaintext-encoded; M5.2
  // will lazy-upgrade them to safeStorage on first read once that lands.
  const migrated = migrateCatalogForward(parsed);

  const apiKeysByVendor = migrated.apiKeysByVendor || {};
  return {
    ...migrated,
    vendors: migrated.vendors.map((vendor) => ({
      ...vendor,
      providerKind: normalizeProviderKind(vendor.providerKind),
      hasApiKey: Boolean(apiKeysByVendor[vendor.key]?.apiKey && apiKeysByVendor[vendor.key]?.enabled !== false),
    })),
    apiKeysByVendor,
  };
}

/**
 * 应用内置模型种子（内置档案：Seedance 等主流模型）。**app 启动时调一次**——
 * 不放进 readCatalog（那会在每次读取/测试里都触发，污染测试且多余）。幂等、存在即跳过，
 * 写盘只在新建或种子有变化时发生。
 */
export function ensureBuiltinModelSeeds(): void {
  const current = readJson<CatalogState | null>(catalogPath(), null);
  const base = current ? migrateCatalogForward(current) : defaultCatalog();
  const { state, changed } = applyBuiltinSeeds(base, new Date().toISOString());
  if (!current || changed) writeCatalog(state);
}

/**
 * Convert one legacy mapping payload into a `{create, query}` pair, handling:
 *  - bare op: `{method, path, headers, body}` → treat as create
 *  - v2 envelope: `{version: "v2", create: {default: op}, query: {default: op}}`
 *    → unwrap both stages
 * Returns whatever is recognizable; the caller merges across rows.
 */
function extractLegacyStages(raw: unknown): { create?: HttpOperation; query?: HttpOperation; statusMapping?: Record<string, string[]> } {
  if (!isJsonRecord(raw)) return {};
  const out: { create?: HttpOperation; query?: HttpOperation; statusMapping?: Record<string, string[]> } = {};
  const opFrom = (v: unknown): HttpOperation | undefined => {
    if (!isJsonRecord(v)) return undefined;
    const inner = isJsonRecord(v.default) ? v.default : v;
    if (typeof inner.method === "string" && typeof inner.path === "string") return inner as unknown as HttpOperation;
    return undefined;
  };
  // Bare op first — a legacy {method, path, headers, body, query} row has its
  // own `query` field (HTTP query params), so envelope detection by the
  // presence of `raw.query` is wrong. Only unwrap an envelope when the marker
  // `version === "v2"` is present or `raw.create` is itself an op.
  if (typeof raw.method === "string" && typeof raw.path === "string") {
    out.create = raw as unknown as HttpOperation;
  } else if (raw.version === "v2" || opFrom(raw.create) || opFrom(raw.query)) {
    const c = opFrom(raw.create);
    const q = opFrom(raw.query);
    if (c) out.create = c;
    if (q) out.query = q;
    if (isJsonRecord(raw.status_mapping)) out.statusMapping = raw.status_mapping as Record<string, string[]>;
  }
  return out;
}

function normalizeLegacyMappings(rawMappings: unknown): Mapping[] {
  const list = Array.isArray(rawMappings) ? rawMappings : [];
  const grouped = new Map<string, Mapping>();
  for (const item of list) {
    if (!isJsonRecord(item)) continue;
    const vendorKey = String(item.vendorKey || "").trim();
    const taskKind = (item.taskKind as ProfileKind) || "chat";
    if (!vendorKey) continue;
    const key = `${vendorKey}|${taskKind}`;
    const existing = grouped.get(key);
    const name = String(item.name || "");
    const isQueryRow = /\bquery\b/i.test(name);
    const fromRequest = extractLegacyStages(item.requestMapping);
    const fromResponse = extractLegacyStages(item.responseMapping);
    // If the row's name says "query" but the legacy op landed in `create`,
    // promote it to `query` — those old rows stored a single op regardless of stage.
    const stages: { create?: HttpOperation; query?: HttpOperation; statusMapping?: Record<string, string[]> } = {};
    for (const stage of [fromRequest, fromResponse]) {
      if (stage.create && isQueryRow && !stage.query) {
        stages.query = stages.query || stage.create;
      } else {
        if (stage.create) stages.create = stages.create || stage.create;
        if (stage.query) stages.query = stages.query || stage.query;
      }
      if (stage.statusMapping) stages.statusMapping = { ...(stages.statusMapping || {}), ...stage.statusMapping };
    }
    const baseName = name.replace(/\s*\((create|query)\)\s*$/i, "").trim() || taskKind;
    const id = String(item.id || "").trim() || `mapping-${crypto.randomUUID()}`;
    const createdAt = String(item.createdAt || nowIso());
    if (!existing) {
      if (!stages.create && !stages.query) continue; // unsalvageable
      grouped.set(key, {
        id,
        vendorKey,
        taskKind,
        name: baseName,
        enabled: normalizeEnabled(item.enabled, true),
        create: stages.create || (stages.query as HttpOperation), // create is required; fall back if only query was salvageable
        ...(stages.query ? { query: stages.query } : {}),
        ...(stages.statusMapping ? { statusMapping: stages.statusMapping } : {}),
        createdAt,
        updatedAt: nowIso(),
      });
    } else {
      // Merge: keep first row's create, fill in query from any later row.
      if (!existing.query && stages.query) existing.query = stages.query;
      if (!existing.query && stages.create && isQueryRow) existing.query = stages.create;
      if (stages.statusMapping) existing.statusMapping = { ...(existing.statusMapping || {}), ...stages.statusMapping };
      existing.updatedAt = nowIso();
    }
  }
  return Array.from(grouped.values());
}

/**
 * In-place forward migration. Unknown future versions fall back to defaults.
 * Always returns a state at CURRENT_CATALOG_VERSION.
 */
function migrateCatalogForward(state: CatalogState): CatalogState {
  let s = state;

  if (!s.version || (s.version as number) < 1) {
    // Garbled state — fall back to defaults rather than risk corruption.
    return defaultCatalog();
  }

  if (s.version === 1) {
    // v1 → v2: tag every existing API key as plaintext so M5.2 knows what to upgrade.
    const apiKeysByVendor: Record<string, ApiKeyRecord> = {};
    for (const [k, rec] of Object.entries(s.apiKeysByVendor || {})) {
      apiKeysByVendor[k] = { ...rec, enc: rec.enc || "plain" };
    }
    s = { ...s, version: 2, apiKeysByVendor };
    writeCatalog(s);
  }

  if (s.version === 2) {
    // v2 → v3: collapse legacy {requestMapping,responseMapping} into flat
    // {create,query}. Handles three legacy shapes — bare op, v2 envelope, and
    // split create/query rows — and dedupes by (vendorKey, taskKind).
    s = { ...s, version: 3, mappings: normalizeLegacyMappings(s.mappings) };
    writeCatalog(s);
  }

  if ((s.version as number) > CURRENT_CATALOG_VERSION) {
    // Newer file than this app understands — keep going read-only, but don't downgrade.
    console.warn(`[catalog] file version ${s.version} > app version ${CURRENT_CATALOG_VERSION}; reading as-is`);
  }

  // Lazy upgrade: any plaintext keys get re-encrypted on first read once safeStorage is up.
  // This handles both legacy v1 keys post-migration and import-from-export scenarios.
  if (isSafeStorageAvailable()) {
    let dirty = false;
    const upgraded: Record<string, ApiKeyRecord> = {};
    for (const [k, rec] of Object.entries(s.apiKeysByVendor || {})) {
      if (rec.enc !== "safeStorage" && rec.apiKey) {
        upgraded[k] = makeApiKeyRecordFromPlain(rec.apiKey, rec.vendorKey, rec.enabled, rec.createdAt, rec.updatedAt);
        dirty = true;
      } else {
        upgraded[k] = rec;
      }
    }
    if (dirty) {
      s = { ...s, apiKeysByVendor: upgraded };
      writeCatalog(s);
    }
  }

  return s;
}

function writeCatalog(state: CatalogState): CatalogState {
  writeJsonFileAtomic(catalogPath(), state);
  return state;
}

function normalizeEnabled(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeProviderKind(value: unknown, fallback: AiSdkProviderKind = "openai-compatible"): AiSdkProviderKind {
  return value === "anthropic" || value === "openai-compatible" || value === "openai-responses" ? value : fallback;
}

function filterByParams<T extends { vendorKey?: string; kind?: BillingModelKind; enabled?: boolean; taskKind?: ProfileKind }>(
  items: T[],
  params: unknown,
): T[] {
  if (!params || typeof params !== "object") return items;
  const raw = params as JsonRecord;
  return items.filter((item) => {
    if (typeof raw.vendorKey === "string" && item.vendorKey !== raw.vendorKey) return false;
    if (typeof raw.kind === "string" && item.kind !== raw.kind) return false;
    if (typeof raw.taskKind === "string" && item.taskKind !== raw.taskKind) return false;
    if (typeof raw.enabled === "boolean" && item.enabled !== raw.enabled) return false;
    return true;
  });
}

export function listModelCatalogVendors(): Vendor[] {
  return readCatalog().vendors;
}

export function listModelCatalogModels(params?: unknown): Model[] {
  return filterByParams(readCatalog().models, params);
}

export function listModelCatalogMappings(params?: unknown): Mapping[] {
  return filterByParams(readCatalog().mappings, params);
}

/**
 * Resolve the onboarding doc-reader LLM from a configured **text** model in the
 * catalog — i.e. the model the user already added (e.g. dm-fox GPT-5.5). This is
 * the product source of truth: it works identically in dev and a packaged app,
 * with no env vars / no `.secrets`. The key is decrypted here in main and never
 * leaves the process. Returns null when no usable text model is configured (the
 * caller then surfaces a "add a text model first" message). Bearer/none-auth
 * vendors only — query/x-api-key auth isn't a chat-completions shape.
 */
export function resolveOnboardingAgentFromCatalog():
  | {
      providerKind: AiSdkProviderKind;
      baseUrl: string;
      modelId: string;
      apiKey: string;
      extraHeaders?: Record<string, string>;
    }
  | null {
  const state = readCatalog();
  for (const model of state.models) {
    if (model.kind !== "text" || !model.enabled) continue;
    const vendor = state.vendors.find((v) => v.key === model.vendorKey && v.enabled);
    if (!vendor || !vendor.baseUrlHint) continue;
    const apiKey = decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]);
    if (!apiKey) continue;
    const extraHeaders = extractVendorExtraHeaders(vendor);
    return {
      providerKind: normalizeProviderKind(vendor.providerKind),
      baseUrl: vendor.baseUrlHint,
      modelId: model.modelKey,
      apiKey,
      ...(extraHeaders ? { extraHeaders } : {}),
    };
  }
  return null;
}

export function getModelCatalogHealth(): unknown {
  const state = readCatalog();
  const enabledVendors = state.vendors.filter((vendor) => vendor.enabled);
  const enabledModels = state.models.filter((model) => model.enabled);
  const enabledApiKeys = Object.values(state.apiKeysByVendor).filter((key) => key.enabled && key.apiKey).length;
  const executableModels = enabledModels.filter((model) => {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey);
    const apiKey = state.apiKeysByVendor[model.vendorKey];
    return Boolean(vendor?.enabled && (vendor.authType === "none" || (apiKey?.enabled && apiKey.apiKey)));
  });
  const byKind = (["text", "image", "video", "audio"] as BillingModelKind[]).map((kind) => ({
    kind,
    enabledModels: enabledModels.filter((model) => model.kind === kind).length,
    executableModels: executableModels.filter((model) => model.kind === kind).length,
  }));
  const issues = [];
  if (state.vendors.length === 0 || state.models.length === 0) {
    issues.push({ code: "catalog_empty", severity: "error", message: "Local model catalog is empty" });
  }
  for (const model of enabledModels) {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey);
    const apiKey = state.apiKeysByVendor[model.vendorKey];
    if (!vendor?.enabled) {
      issues.push({ code: "vendor_disabled", severity: "error", message: `Vendor disabled: ${model.vendorKey}`, vendorKey: model.vendorKey, modelKey: model.modelKey, kind: model.kind });
    } else if (vendor.authType !== "none" && !apiKey?.apiKey) {
      issues.push({ code: "vendor_api_key_missing", severity: "error", message: `API key missing: ${model.vendorKey}`, vendorKey: model.vendorKey, modelKey: model.modelKey, kind: model.kind });
    }
  }
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    counts: {
      vendors: state.vendors.length,
      enabledVendors: enabledVendors.length,
      models: state.models.length,
      enabledModels: enabledModels.length,
      mappings: state.mappings.length,
      enabledMappings: state.mappings.filter((mapping) => mapping.enabled).length,
      enabledApiKeys,
    },
    byKind,
    issues,
  };
}

export function upsertModelCatalogVendor(payload: unknown): Vendor {
  const state = readCatalog();
  const raw = payload as JsonRecord;
  const key = sanitizeName(raw.key, "").toLowerCase().replace(/\s+/g, "-");
  if (!key) throw new Error("vendor key is required");
  const existing = state.vendors.find((vendor) => vendor.key === key);
  const t = nowIso();
  const vendor: Vendor = {
    key,
    name: String(raw.name || existing?.name || key).trim(),
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    hasApiKey: existing?.hasApiKey ?? false,
    baseUrlHint: typeof raw.baseUrlHint === "string" ? raw.baseUrlHint.trim() || null : existing?.baseUrlHint ?? null,
    authType: (raw.authType as Vendor["authType"]) || existing?.authType || "bearer",
    authHeader: typeof raw.authHeader === "string" ? raw.authHeader.trim() || null : existing?.authHeader ?? null,
    authQueryParam: typeof raw.authQueryParam === "string" ? raw.authQueryParam.trim() || null : existing?.authQueryParam ?? null,
    providerKind: normalizeProviderKind(raw.providerKind, existing?.providerKind ?? "openai-compatible"),
    meta: raw.meta ?? existing?.meta,
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  state.vendors = [vendor, ...state.vendors.filter((item) => item.key !== key)];
  writeCatalog(state);
  return { ...vendor, hasApiKey: Boolean(state.apiKeysByVendor[key]?.apiKey) };
}

export function deleteModelCatalogVendor(key: string): void {
  const state = readCatalog();
  state.vendors = state.vendors.filter((vendor) => vendor.key !== key);
  state.models = state.models.filter((model) => model.vendorKey !== key);
  state.mappings = state.mappings.filter((mapping) => mapping.vendorKey !== key);
  delete state.apiKeysByVendor[key];
  writeCatalog(state);
}

export function upsertModelCatalogVendorApiKey(vendorKey: string, payload: unknown): unknown {
  const state = readCatalog();
  const key = String(vendorKey || "").trim();
  const apiKey = String((payload as JsonRecord)?.apiKey || "").trim();
  if (!key) throw new Error("vendor key is required");
  if (!apiKey) throw new Error("api key is required");
  const t = nowIso();
  const existing = state.apiKeysByVendor[key];
  state.apiKeysByVendor[key] = makeApiKeyRecordFromPlain(
    apiKey,
    key,
    normalizeEnabled((payload as JsonRecord)?.enabled, true),
    existing?.createdAt || t,
    t,
  );
  writeCatalog(state);
  return { vendorKey: key, hasApiKey: true, enabled: state.apiKeysByVendor[key].enabled, createdAt: state.apiKeysByVendor[key].createdAt, updatedAt: t };
}

export function clearModelCatalogVendorApiKey(vendorKey: string): unknown {
  const state = readCatalog();
  const key = String(vendorKey || "").trim();
  const t = nowIso();
  delete state.apiKeysByVendor[key];
  writeCatalog(state);
  return { vendorKey: key, hasApiKey: false, enabled: false, createdAt: t, updatedAt: t };
}

export function upsertModelCatalogModel(payload: unknown): Model {
  const state = readCatalog();
  const raw = payload as JsonRecord;
  const modelKey = String(raw.modelKey || "").trim();
  const vendorKey = String(raw.vendorKey || "").trim();
  if (!modelKey || !vendorKey) throw new Error("modelKey and vendorKey are required");
  const existing = state.models.find((model) => model.vendorKey === vendorKey && model.modelKey === modelKey);
  const t = nowIso();
  const model: Model = {
    modelKey,
    vendorKey,
    modelAlias: typeof raw.modelAlias === "string" ? raw.modelAlias.trim() || null : existing?.modelAlias ?? null,
    // 显示名兜底不落裸 id（审计 A13）：没给 labelZh 时人话化 modelKey 排版。
    labelZh: String(raw.labelZh || existing?.labelZh || "").trim() || humanizeModelKey(modelKey),
    kind: (raw.kind as BillingModelKind) || existing?.kind || "text",
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    meta: raw.meta ?? existing?.meta,
    pricing: raw.pricing as Model["pricing"] || existing?.pricing,
    onboarding: (raw.onboarding as Model["onboarding"]) ?? existing?.onboarding,
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  state.models = [model, ...state.models.filter((item) => !(item.vendorKey === vendorKey && item.modelKey === modelKey))];
  writeCatalog(state);
  return model;
}

export function deleteModelCatalogModel(vendorKey: string, modelKey: string): void {
  const state = readCatalog();
  state.models = state.models.filter((model) => !(model.vendorKey === vendorKey && model.modelKey === modelKey));
  writeCatalog(state);
}

export function upsertModelCatalogMapping(payload: unknown): Mapping {
  const state = readCatalog();
  const raw = payload as JsonRecord;
  const vendorKey = String(raw.vendorKey || "").trim();
  const taskKind = (raw.taskKind as ProfileKind) || "chat";
  if (!vendorKey) throw new Error("vendorKey is required");
  // One mapping per (vendor, taskKind). If id is supplied and matches, update
  // that row; otherwise locate by (vendor, taskKind) so callers can upsert
  // without tracking ids.
  const existing = state.mappings.find((m) =>
    raw.id ? m.id === raw.id : m.vendorKey === vendorKey && m.taskKind === taskKind,
  );
  const id = String(raw.id || existing?.id || `mapping-${crypto.randomUUID()}`);
  const t = nowIso();
  // Accept new shape (create/query) directly, or legacy {requestMapping,...}
  // (e.g. via the unchanged import path) and normalize on the way in.
  const legacy = extractLegacyStages(raw.requestMapping ?? raw.requestProfile);
  const legacyResp = extractLegacyStages(raw.responseMapping);
  const create = (raw.create as HttpOperation | undefined) || legacy.create || legacyResp.create || existing?.create;
  const query = (raw.query as HttpOperation | undefined) || legacy.query || legacyResp.query || existing?.query;
  if (!create) throw new Error("create operation is required (method + path)");
  const mapping: Mapping = {
    id,
    vendorKey,
    taskKind,
    name: String(raw.name || existing?.name || taskKind).trim(),
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    create,
    ...(query ? { query } : {}),
    ...(raw.statusMapping || legacy.statusMapping || existing?.statusMapping
      ? { statusMapping: (raw.statusMapping as Record<string, string[]>) || legacy.statusMapping || existing?.statusMapping }
      : {}),
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  state.mappings = [mapping, ...state.mappings.filter((item) => item.id !== id)];
  writeCatalog(state);
  return mapping;
}

export function deleteModelCatalogMapping(id: string): void {
  const state = readCatalog();
  state.mappings = state.mappings.filter((mapping) => mapping.id !== id);
  writeCatalog(state);
}

export function exportModelCatalogPackage(params?: unknown): unknown {
  const state = readCatalog();
  const includeApiKeys = Boolean((params as JsonRecord | undefined)?.includeApiKeys);
  return {
    version: "desktop-local-v1",
    exportedAt: nowIso(),
    vendors: state.vendors.map((vendor) => ({
      vendor,
      // Export carries plaintext keys for portability; re-import will re-encrypt on the target machine.
      ...(includeApiKeys && state.apiKeysByVendor[vendor.key]?.apiKey
        ? { apiKey: { apiKey: decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]), enabled: state.apiKeysByVendor[vendor.key].enabled } }
        : {}),
      models: state.models.filter((model) => model.vendorKey === vendor.key),
      mappings: state.mappings.filter((mapping) => mapping.vendorKey === vendor.key),
    })),
  };
}

export function importModelCatalogPackage(payload: unknown): unknown {
  const state = readCatalog();
  const raw = payload as { vendors?: Array<{ vendor?: unknown; apiKey?: unknown; models?: unknown[]; mappings?: unknown[] }> };
  let vendors = 0;
  let models = 0;
  let mappings = 0;
  const errors: string[] = [];
  for (const bundle of raw.vendors || []) {
    try {
      const vendor = upsertModelCatalogVendor(bundle.vendor);
      vendors += 1;
      const apiKey = bundle.apiKey as JsonRecord | undefined;
      if (apiKey?.apiKey) upsertModelCatalogVendorApiKey(vendor.key, apiKey);
      for (const model of bundle.models || []) {
        upsertModelCatalogModel({ ...(model as JsonRecord), vendorKey: (model as JsonRecord).vendorKey || vendor.key });
        models += 1;
      }
      for (const mapping of bundle.mappings || []) {
        upsertModelCatalogMapping({ ...(mapping as JsonRecord), vendorKey: (mapping as JsonRecord).vendorKey || vendor.key });
        mappings += 1;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  writeCatalog(readCatalog() || state);
  return { imported: { vendors, models, mappings }, errors };
}

/**
 * Read user-supplied custom request headers off a vendor. Stored under
 * `vendor.meta.extraHeaders` (a string→string map) by the manual-entry form so
 * relay/proxy gateways that need an extra auth header work without us hardcoding
 * per-provider knowledge. Returns undefined when none are set.
 */
export function extractVendorExtraHeaders(vendor: Vendor): Record<string, string> | undefined {
  const meta = vendor.meta as JsonRecord | undefined;
  const raw = meta?.extraHeaders;
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = String(key || "").trim();
    const v = String(value ?? "").trim();
    if (k && v) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
