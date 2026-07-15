import crypto from "node:crypto";
import path from "node:path";
import { findNonHeaderSafeChar, isJsonRecord, nowIso, type JsonRecord } from "../jsonUtils";
import { sanitizeName } from "../projects/repository";
import { writeJsonFileAtomic } from "../jsonFile";
import { CATALOG_FILE, getSettingsRoot, readJson } from "../runtimePaths";
import { type ApiKeyRecord, decryptApiKeyRecord, isSafeStorageAvailable, makeApiKeyRecordFromPlain } from "./secrets";
import { humanizeModelKey } from "./modelLabel";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { NEWAPI_IMAGE_EDIT_OP, NEWAPI_IMAGE_PARAM_MAP, NEWAPI_STANDARD_IMAGE_PARAMS, NEWAPI_VIDEO_PARAM_MAP } from "./newapiTransport";
import type { AiSdkProviderKind, BillingModelKind, CatalogState, HttpOperation, Mapping, Model, ProfileKind, Vendor } from "./types";
import { CURRENT_CATALOG_VERSION } from "./types";

// 内置 vendor（由 seedBuiltins 管理、op 已正确）。v4 relay 迁移只碰这之外的**用户自建中转**——
// 尤其别碰 apimart：它的 size 是比例字符串("16:9")不是像素，套 OpenAI 像素转换会发错。
const BUILTIN_VENDOR_KEYS = new Set(["kie", "apimart", "modelscope", "volcengine", "volcengine-speech", "runninghub"]);

/**
 * v3 → v4：给**用户自建 OpenAI 兼容中转**的旧图像/视频 create op 补 paramMap（铁律翻译层）。
 * 这些 op 是档案中性化之前持久化的（读 {{request.params.size}} 像素，但无 paramMap）——档案现在产
 * 中性「比例 + 清晰度档位」，没翻译就发不出去（gpt-image-2 × 自建中转报错的根因）。幂等：已有 paramMap
 * 或非 relay 形状的跳过。按 op.path 识别 new-api/OpenAI 兼容形状（/images|video/generations）。
 */
export function migrateRelayParamMaps(mappings: Mapping[]): { mappings: Mapping[]; changed: boolean } {
  let changed = false;
  const out = mappings.map((m) => {
    if (BUILTIN_VENDOR_KEYS.has(m.vendorKey)) return m;
    const create = m.create;
    if (!create || create.paramMap) return m;
    const pathStr = typeof create.path === "string" ? create.path : "";
    const isImage = /\/images\/generations$/.test(pathStr);
    const isVideo = /\/video\/generations$/.test(pathStr);
    if (!isImage && !isVideo) return m;
    // 只在 body 确实读 size（即 OpenAI 兼容像素契约）时补——避免给不相干形状乱套。
    if (!JSON.stringify(create.body ?? "").includes("request.params.size")) return m;
    changed = true;
    return { ...m, create: { ...create, paramMap: isImage ? NEWAPI_IMAGE_PARAM_MAP : NEWAPI_VIDEO_PARAM_MAP } };
  });
  return { mappings: out, changed };
}

/** 老「标准图片参数」签名（size/quality/n 的子集且非空）——v5 迁移只把这种明确的旧手动接入形状
 *  升级成现行 比例+清晰度(1K/2K/4K) 标准；doc 派生的自定义参数（键不在此集合）一律不碰。 */
function isLegacyStandardImageParams(parameters: unknown): boolean {
  if (!Array.isArray(parameters) || parameters.length === 0) return false;
  const LEGACY_KEYS = new Set(["size", "quality", "n"]);
  return parameters.every((p) => isJsonRecord(p) && LEGACY_KEYS.has(String(p.key)));
}

/** NEWAPI 标准图片参数 → model.meta.parameters 投影（与 commitOnboardedModelToCatalog 的
 *  paramsToOnboardingFields→metaParameters 同形状：{key,label,type,options?,default?}）。 */
function standardImageMetaParameters(): JsonRecord[] {
  return NEWAPI_STANDARD_IMAGE_PARAMS.map((p) => ({
    key: p.key,
    label: p.label,
    type: p.type,
    ...(p.options.length ? { options: p.options } : {}),
    ...(typeof p.defaultValue !== "undefined" ? { default: String(p.defaultValue) } : {}),
  }));
}

/**
 * v4 → v5：给**存量**用户自建中转的 image 条目补图生图能力。8c711f0c 起新接入才写
 * image_edit mapping + meta.imageOptions.supportsReferenceImages——老条目 UI 不出参考槽、连线参考
 * 会因无 mapping 掉进 fallback 被静默丢（「图生图不按原图」根因之一）。此前唯一解法是让用户
 * 删了重加，迁移根治（docs/plan/2026-07-06-i2i-reference-reliability.md L1）。
 * 边界：只碰非内置 vendor（BUILTIN_VENDOR_KEYS 之外）且有 /images/generations 形状 t2i op 的
 * （OpenAI 兼容证据，与 v4 同款嗅探）；只增不删，自定义参数不动。幂等。
 */
export function migrateRelayImageEditCapability(state: CatalogState): { state: CatalogState; changed: boolean } {
  let changed = false;
  const models = [...state.models];
  const mappings = [...state.mappings];
  const t = nowIso();
  const imageVendorKeys = new Set(models.filter((m) => m.kind === "image").map((m) => m.vendorKey));
  for (const vendorKey of imageVendorKeys) {
    if (BUILTIN_VENDOR_KEYS.has(vendorKey)) continue;
    const hasOpenAiImageShape = mappings.some(
      (m) =>
        m.vendorKey === vendorKey &&
        m.taskKind === "text_to_image" &&
        typeof m.create?.path === "string" &&
        /\/images\/generations$/.test(m.create.path),
    );
    if (!hasOpenAiImageShape) continue;
    // 1) image_edit mapping（chat/completions 多模态）：per (vendor, image_edit) 一条覆盖该 vendor
    //    全部图像模型（op 用 {{model.modelKey}} 运行时填），与新接入 catalogCommit 同源常量。
    if (!mappings.some((m) => m.vendorKey === vendorKey && m.taskKind === "image_edit")) {
      const vendorName = state.vendors.find((v) => v.key === vendorKey)?.name || vendorKey;
      mappings.push({
        id: `mapping-${crypto.randomUUID()}`,
        vendorKey,
        taskKind: "image_edit",
        name: `${vendorName} · 改图`,
        enabled: true,
        create: NEWAPI_IMAGE_EDIT_OP,
        createdAt: t,
        updatedAt: t,
      });
      changed = true;
    }
    // 2) 每个 image 模型补 supportsReferenceImages（UI 参考槽开关）；3) 老标准参数升级成 比例/清晰度
    //    （v4 已给旧 body 补 paramMap，新参数经 ratioResToOpenAiSize 翻译后照发；治「只能出 1K」）。
    for (let i = 0; i < models.length; i += 1) {
      const m = models[i];
      if (m.vendorKey !== vendorKey || m.kind !== "image") continue;
      const meta = isJsonRecord(m.meta) ? m.meta : {};
      const imageOptions = isJsonRecord(meta.imageOptions) ? meta.imageOptions : {};
      const needsFlag = imageOptions.supportsReferenceImages !== true;
      const needsParams = isLegacyStandardImageParams(meta.parameters);
      if (!needsFlag && !needsParams) continue;
      models[i] = {
        ...m,
        meta: {
          ...meta,
          ...(needsParams ? { parameters: standardImageMetaParameters() } : {}),
          imageOptions: { ...imageOptions, supportsReferenceImages: true },
        },
        updatedAt: t,
      };
      changed = true;
    }
  }
  return { state: changed ? { ...state, models, mappings } : state, changed };
}

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

  if (s.version === 3) {
    // v3 → v4: 给用户自建中转的旧图像/视频 op 补 paramMap（铁律翻译层），修「档案中性化后比例/清晰度
    // 发不出去」。只碰非内置 vendor 的 OpenAI 兼容 relay op（见 migrateRelayParamMaps）。
    const { mappings } = migrateRelayParamMaps(s.mappings);
    s = { ...s, version: 4, mappings };
    writeCatalog(s);
  }

  if (s.version === 4) {
    // v4 → v5: 存量中转 image 条目补图生图能力（image_edit mapping + supportsReferenceImages +
    // 老标准参数升级）。此前这些字段只在新接入写，老条目要「删了重加」——迁移根治（见
    // migrateRelayImageEditCapability 注释 + docs/plan/2026-07-06-i2i-reference-reliability.md）。
    const migrated = migrateRelayImageEditCapability(s);
    s = { ...migrated.state, version: 5 };
    writeCatalog(s);
  }

  if ((s.version as number) > CURRENT_CATALOG_VERSION) {
    // Newer file than this app understands — return it untouched so it stays
    // readable, and let `writeCatalog` REFUSE any write back (read-only guard).
    // This actually enforces "don't downgrade" instead of only warning about it.
    console.warn(`[catalog] file version ${s.version} > app version ${CURRENT_CATALOG_VERSION}; read-only (writes refused)`);
    return s;
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

/**
 * 只读保护（P1·修高版本静默降级根因）：写盘前先看磁盘当前文件的版本——若它高于本应用
 * 理解的 CURRENT_CATALOG_VERSION，则**拒绝写回**（抛错），绝不把更新版应用写入的新字段
 * 以当前形状压扁丢弃。保护设在唯一写盘 choke point，覆盖所有 upsert/delete/import，而非
 * 逐函数堵症状。读路径不调它 → 高版本文件仍可读、可用。
 */
function onDiskCatalogVersion(): number | null {
  const parsed = readJson<CatalogState | null>(catalogPath(), null);
  const v = parsed?.version;
  return typeof v === "number" ? v : null;
}

function writeCatalog(state: CatalogState): CatalogState {
  const diskVersion = onDiskCatalogVersion();
  if (diskVersion != null && diskVersion > CURRENT_CATALOG_VERSION) {
    throw new Error(
      `[catalog] refusing to write: on-disk version ${diskVersion} > app version ${CURRENT_CATALOG_VERSION} (read-only to avoid silent downgrade). Update the app to edit this catalog.`,
    );
  }
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

/**
 * 纯函数:把一次 vendor upsert 应用到**内存中的** state(原地改 state.vendors),返回产出的 vendor。
 * 不读盘不写盘——读盘/写盘归调用方。事务化导入(importModelCatalogPackage)与单条公开 upsert
 * 共用它,避免两份合并逻辑漂移(P1)。
 */
function applyVendorUpsert(state: CatalogState, payload: unknown): Vendor {
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
  return vendor;
}

export function upsertModelCatalogVendor(payload: unknown): Vendor {
  const state = readCatalog();
  const vendor = applyVendorUpsert(state, payload);
  writeCatalog(state);
  return { ...vendor, hasApiKey: Boolean(state.apiKeysByVendor[vendor.key]?.apiKey) };
}

export function deleteModelCatalogVendor(key: string): void {
  const state = readCatalog();
  state.vendors = state.vendors.filter((vendor) => vendor.key !== key);
  state.models = state.models.filter((model) => model.vendorKey !== key);
  state.mappings = state.mappings.filter((mapping) => mapping.vendorKey !== key);
  delete state.apiKeysByVendor[key];
  writeCatalog(state);
}

/** 纯函数:把一次 apiKey upsert 应用到内存 state(原地改 state.apiKeysByVendor)。见 applyVendorUpsert 同理。 */
function applyApiKeyUpsert(state: CatalogState, vendorKey: string, payload: unknown): void {
  const key = String(vendorKey || "").trim();
  const apiKey = String((payload as JsonRecord)?.apiKey || "").trim();
  if (!key) throw new Error("vendor key is required");
  if (!apiKey) throw new Error("api key is required");
  // 根因守门：密钥含中文/全角/控制字符 → 拼进 HTTP 头后 fetch 直接抛 ByteString 错
  // （见 findNonHeaderSafeChar）。在唯一写入口就拦掉，污染密钥永远存不进钥匙串。
  const illegal = findNonHeaderSafeChar(apiKey);
  if (illegal) {
    throw new Error(
      `API Key 含非法字符（第 ${illegal.index + 1} 位「${illegal.char}」，码点 ${illegal.code}）——密钥应为纯英文/数字，常见原因是误把中文或全角字符粘了进来，请重新粘贴。`,
    );
  }
  const t = nowIso();
  const existing = state.apiKeysByVendor[key];
  state.apiKeysByVendor[key] = makeApiKeyRecordFromPlain(
    apiKey,
    key,
    normalizeEnabled((payload as JsonRecord)?.enabled, true),
    existing?.createdAt || t,
    t,
  );
}

export function upsertModelCatalogVendorApiKey(vendorKey: string, payload: unknown): unknown {
  const state = readCatalog();
  applyApiKeyUpsert(state, vendorKey, payload);
  writeCatalog(state);
  const key = String(vendorKey || "").trim();
  const rec = state.apiKeysByVendor[key];
  return { vendorKey: key, hasApiKey: true, enabled: rec.enabled, createdAt: rec.createdAt, updatedAt: rec.updatedAt };
}

export function clearModelCatalogVendorApiKey(vendorKey: string): unknown {
  const state = readCatalog();
  const key = String(vendorKey || "").trim();
  const t = nowIso();
  delete state.apiKeysByVendor[key];
  writeCatalog(state);
  return { vendorKey: key, hasApiKey: false, enabled: false, createdAt: t, updatedAt: t };
}

/** 纯函数:把一次 model upsert 应用到内存 state(原地改 state.models)。见 applyVendorUpsert 同理。 */
function applyModelUpsert(state: CatalogState, payload: unknown): Model {
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
  return model;
}

export function upsertModelCatalogModel(payload: unknown): Model {
  const state = readCatalog();
  const model = applyModelUpsert(state, payload);
  writeCatalog(state);
  return model;
}

export function deleteModelCatalogModel(vendorKey: string, modelKey: string): void {
  const state = readCatalog();
  state.models = state.models.filter((model) => !(model.vendorKey === vendorKey && model.modelKey === modelKey));
  writeCatalog(state);
}

/**
 * 批量删除：一次 read/write 删掉多行（用户群反馈 462 个自定义模型只能逐个删=鸡肋）。
 * 逐行调 deleteModelCatalogModel 会是 N 次同步 read+writeAtomic 循环；这里合成一次，避免大目录时卡顿。
 */
export function deleteModelCatalogModels(targets: Array<{ vendorKey: string; modelKey: string }>): void {
  const list = Array.isArray(targets) ? targets : [];
  if (list.length === 0) return;
  const keySet = new Set(list.map((t) => `${String(t?.vendorKey ?? "")} ${String(t?.modelKey ?? "")}`));
  const state = readCatalog();
  state.models = state.models.filter((model) => !keySet.has(`${model.vendorKey} ${model.modelKey}`));
  writeCatalog(state);
}

/** 纯函数:把一次 mapping upsert 应用到内存 state(原地改 state.mappings)。见 applyVendorUpsert 同理。 */
function applyMappingUpsert(state: CatalogState, payload: unknown): Mapping {
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
  return mapping;
}

export function upsertModelCatalogMapping(payload: unknown): Mapping {
  const state = readCatalog();
  const mapping = applyMappingUpsert(state, payload);
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

/**
 * 事务化导入（P2·根治半成品）：整包先在**一份内存 state** 上逐项应用 + 校验，全部成功才
 * `writeCatalog` 一次性落盘；任一 bundle 抛错则**整体不写**——磁盘保持导入前原样，绝不留下
 * 「vendor 写了但它的 model 校验失败」这类不可用的半接入空壳。失败原因汇进 errors 返回。
 *
 * 为什么是「全有或全无」而非「跳过坏的、留下好的」：一个 bundle 内部就是 vendor+key+model+mapping
 * 的整体，单条 upsert 立即落盘才会产生中途半截态。把写盘收敛到唯一 choke point（事务边界），
 * 这类 bug 整类消失，而不是逐 upsert 补偿。`apply*` 纯函数与单条公开 upsert 共用（无第二份逻辑）。
 */
export function importModelCatalogPackage(payload: unknown): unknown {
  const raw = payload as { vendors?: Array<{ vendor?: unknown; apiKey?: unknown; models?: unknown[]; mappings?: unknown[] }> };
  const state = readCatalog();
  let vendors = 0;
  let models = 0;
  let mappings = 0;
  try {
    for (const bundle of raw.vendors || []) {
      const vendor = applyVendorUpsert(state, bundle.vendor);
      vendors += 1;
      const apiKey = bundle.apiKey as JsonRecord | undefined;
      if (apiKey?.apiKey) applyApiKeyUpsert(state, vendor.key, apiKey);
      for (const model of bundle.models || []) {
        applyModelUpsert(state, { ...(model as JsonRecord), vendorKey: (model as JsonRecord).vendorKey || vendor.key });
        models += 1;
      }
      for (const mapping of bundle.mappings || []) {
        applyMappingUpsert(state, { ...(mapping as JsonRecord), vendorKey: (mapping as JsonRecord).vendorKey || vendor.key });
        mappings += 1;
      }
    }
  } catch (error) {
    // 整体回滚：不写盘（磁盘还是导入前的 state），返回 0 计数 + 清晰错误。
    return { imported: { vendors: 0, models: 0, mappings: 0 }, errors: [error instanceof Error ? error.message : String(error)] };
  }
  // 全部成功 → 一次性提交。空包也安全（无变更则写回等值 state）。
  writeCatalog(state);
  return { imported: { vendors, models, mappings }, errors: [] };
}

export type CatalogMutation = {
  upsertVendor: (payload: unknown) => Vendor;
  upsertApiKey: (vendorKey: string, payload: unknown) => void;
  upsertModel: (payload: unknown) => Model;
  upsertMapping: (payload: unknown) => Mapping;
};

/**
 * 单次「读-改-写」事务（P2·根治多步落盘留半截）：读一份内存 state，把 apply* 暴露给 fn 在其上
 * 攒齐，fn 正常返回才一次性 writeCatalog；fn 抛错则整体不写（磁盘保持原样）。与
 * importModelCatalogPackage 共用同一套「全有或全无」边界——单条手动接入（commitOnboardedModelToCatalog
 * 的 vendor+key+model+mapping 四步）复用它，不再四次独立落盘、不再留「vendor 写了 model 没写成」的半接入空壳。
 */
export function mutateCatalog<T>(fn: (tx: CatalogMutation) => T): T {
  const state = readCatalog();
  const tx: CatalogMutation = {
    upsertVendor: (payload) => applyVendorUpsert(state, payload),
    upsertApiKey: (vendorKey, payload) => applyApiKeyUpsert(state, vendorKey, payload),
    upsertModel: (payload) => applyModelUpsert(state, payload),
    upsertMapping: (payload) => applyMappingUpsert(state, payload),
  };
  const result = fn(tx);
  writeCatalog(state);
  return result;
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
