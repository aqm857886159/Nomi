import crypto from "node:crypto";
import path from "node:path";
import { findNonHeaderSafeChar, isJsonRecord, nowIso, type JsonRecord } from "../jsonUtils";
import { sanitizeName } from "../projects/repository";
import { writeJsonFileAtomic } from "../jsonFile";
import { CATALOG_FILE, getSettingsRoot, readJson } from "../runtimePaths";
import { apiKeyDecryptStatus, type ApiKeyRecord, decryptApiKeyRecord, makeApiKeyRecordFromPlain } from "./secrets";
import { humanizeModelKey } from "./modelLabel";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { migrateRelayImageEditProtocols } from "./relayImageEditMigration";
import { migrateRelayVideoImageToVideo } from "./relayVideoI2vMigration";
import { migrateComfyWorkflowOutputs } from "./comfyuiWorkflowOutputMigration";
import { migrateCatalogMediaContracts } from "./catalogMediaContractMigration";
import { migrateRelayImageEditCapability, migrateRelayParamMaps } from "./relayLegacyMigrations";
import type { AiSdkProviderKind, BillingModelKind, CatalogState, HttpOperation, Mapping, Model, ProfileKind, Vendor } from "./types";
import { CURRENT_CATALOG_VERSION } from "./types";
import { normalizeCustomCall } from "./customCallMode";
import { derivePublishedExecution, modelHasPublishedExecution } from "../shared/modelPublication";
import { deriveModelCatalogHealth } from "./catalogHealth";
import { depublishVendorForDisabledCredential } from "./credentialPublication";
import { deleteVendorLineageAndRestore, removeVendorLineage } from "./vendorLineageLifecycle";
import { guardAntigravityMappingWrite, guardAntigravityModelWrite, guardAntigravityVendorWrite } from "./antigravityWriteGuard";
import { antigravityConnection } from "../ai/antigravityConnection";
import { extractLegacyStages, normalizeLegacyMappings } from "./legacyMappingMigration";
import {
  applyPlainCustomConfig,
  hasLegacyCustomConfigField,
  legacyCustomConfig,
  migrateLegacyCustomConfigSecrets,
  normalizedCustomConfig,
  publicVendor,
  replaceCustomCallConfig,
  withoutLegacyCustomConfig,
  type CustomCallConfigPublicEntry,
} from "./customConfigStore";
import {
  applyPlainNetworkConfig,
  exportableVendorWithNetworkConfig,
  hasLegacyNetworkConfigField,
  metaWithoutExtraHeaders,
  overlayDecryptedNetworkConfig,
  resolveNetworkConfigForWrite,
} from "./networkConfigStore";

export type { CustomCallConfigPatchEntry, CustomCallConfigPublicEntry } from "./customConfigStore";

// 各版 relay 迁移各住独立模块（R9 分层：迁移与读写盘/事务无关）。这里只做接线 + 再导出，
// 测试与既有调用方按原路径 import 不变。
export { migrateRelayImageEditProtocols } from "./relayImageEditMigration";
export { migrateRelayVideoImageToVideo } from "./relayVideoI2vMigration";
export { migrateRelayImageEditCapability, migrateRelayParamMaps } from "./relayLegacyMigrations";

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

  // Migrate forward. v1 → v2 tags pre-existing keys as plaintext-encoded;
  // reads preserve those records so catalog access never opens the OS keychain.
  const migrated = migrateCatalogForward(parsed);

  const apiKeysByVendor = migrated.apiKeysByVendor || {};
  return {
    ...migrated,
    vendors: migrated.vendors.map((vendor) => {
      const base: Vendor = {
        ...vendor,
        providerKind: normalizeProviderKind(vendor.providerKind),
        hasApiKey: apiKeyDecryptStatus(apiKeysByVendor[vendor.key]) === "ok",
      };
      // Overlay the DECRYPTED proxy/header credentials onto the INTERNAL vendor at
      // this single read choke point so every outbound consumer keeps reading them
      // synchronously. readCatalog already decrypts the apiKey here (for hasApiKey),
      // so this opens no new keychain access on read. Legacy plaintext is left in
      // place under the overlay so a later write can still migrate it; publicVendor
      // strips both the overlay and any legacy plaintext from every renderer/export DTO.
      return overlayDecryptedNetworkConfig(base, apiKeysByVendor[vendor.key]);
    }),
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
 * In-place forward migration. Unknown future versions stay untouched. A v8
 * catalog carrying legacy plaintext custom config intentionally stays at v8
 * until an explicit credential write can migrate every secret atomically.
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

  if (s.version === 5) {
    // v5 → v6：同一中转的不同图片模型按真实 image_edit 协议精确分流；存量 Grok 自动修复，无需删后重加。
    const migrated = migrateRelayImageEditProtocols(s);
    s = { ...migrated.state, version: 6 };
    writeCatalog(s);
  }

  if (s.version === 6) {
    // v6 → v7：**重跑**协议分流。v6 迁移跑在「gpt-image/dall-e-2 还没接 OpenAI multipart edits」之前，
    // 故存量 gpt-image-2 等被留在 chat/completions（图生图在只认 /v1/images/edits 的中转站接不上）。
    // migrateRelayImageEditProtocols 幂等，重跑即按新智能默认把 gpt-image/dall-e-2 升到 multipart。
    // 无版本 bump 就不会重跑（v6 已是终版）——所以必须 bump 到 v7 强制存量用户也升级。
    const migrated = migrateRelayImageEditProtocols(s);
    s = { ...migrated.state, version: 7 };
    writeCatalog(s);
  }

  if (s.version === 7) {
    // v7 → v8：存量中转 video 条目补「图生视频」通道（image_to_video mapping）。接入路径此前只建
    // text_to_video，视频节点一连参考图就报「没有配置图生视频通道 · 请删除后重新接入」——而重接
    // 也不会建（根因在接入路径，已同 commit 修）。迁移让存量直接可用，不必删了重加。
    const migrated = migrateRelayVideoImageToVideo(s);
    s = { ...migrated.state, version: 8 };
    writeCatalog(s);
  }

  if (s.version === 8) {
    const hasLegacyCustomConfig = s.vendors.some(hasLegacyCustomConfigField);
    if (!hasLegacyCustomConfig) {
      s = { ...s, version: 9 };
      writeCatalog(s);
    }
  }

  if (s.version === 9) {
    s = { ...migrateComfyWorkflowOutputs(s), version: 10 };
    writeCatalog(s);
  }

  if (s.version === 10) {
    const before = s;
    const migrated = migrateCatalogMediaContracts(s);
    s = migrated.unresolved ? migrated.state : { ...migrated.state, version: 11 };
    if (!migrated.unresolved || migrated.state !== before) writeCatalog(s);
    if (migrated.unresolved) console.warn("[catalog] v11 media migration has unresolved ambiguous bindings; catalog remains v10 for retry");
  }

  if (s.version === 11) {
    // v11 → v12: credential-bearing network config (proxyUrl / extraHeaders) moves to the
    // encrypted credential record. Like v8→v9 customConfig, defer the secret encryption until
    // an explicit vendor write can migrate every secret atomically — a plain forward read must
    // not open the keychain to re-encrypt. Advance the version only when nothing legacy remains.
    const hasLegacyNetworkConfig = s.vendors.some(hasLegacyNetworkConfigField);
    if (!hasLegacyNetworkConfig) {
      s = { ...s, version: 12 };
      writeCatalog(s);
    }
  }

  if ((s.version as number) > CURRENT_CATALOG_VERSION) {
    // Newer file than this app understands — return it untouched so it stays
    // readable, and let `writeCatalog` REFUSE any write back (read-only guard).
    // This actually enforces "don't downgrade" instead of only warning about it.
    console.warn(
      `[catalog] file version ${s.version} > app version ${CURRENT_CATALOG_VERSION}; read-only (writes refused)`,
    );
    return s;
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

export function normalizeProviderKind(
  value: unknown,
  fallback: AiSdkProviderKind = "openai-compatible",
): AiSdkProviderKind {
  return value === "anthropic" || value === "openai-compatible" || value === "openai-responses" ? value : fallback;
}

function filterByParams<
  T extends { vendorKey?: string; kind?: BillingModelKind; enabled?: boolean; taskKind?: ProfileKind },
>(items: T[], params: unknown): T[] {
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
  return readCatalog().vendors.map(publicVendor);
}
export function listModelCatalogModels(params?: unknown): Array<Model & { published: boolean; publishedModes: ProfileKind[] }> {
  const state = readCatalog();
  return filterByParams(state.models, params).map((model) => ({
    ...model, ...derivePublishedExecution(model, { mappings: state.mappings }),
  })) as Array<Model & { published: boolean; publishedModes: ProfileKind[] }>;
}
export function listModelCatalogMappings(params?: unknown): Mapping[] {
  return filterByParams(readCatalog().mappings, params);
}

/** 单个可用 text「语言大脑」候选的解出形（onboarding 文档读取 / 审片环 judge 共用）。 */
export type OnboardingAgent = {
  providerKind: AiSdkProviderKind;
  baseUrl: string;
  /** 选中 text 模型所属 vendor 的 key。审片环 judge 走 runTask 需要它（runTask 按 vendorKey 解模型）。 */
  vendorKey: string;
  modelId: string;
  apiKey: string;
  extraHeaders?: Record<string, string>;
};

/**
 * List **all** usable text-model "language brain" candidates from the catalog, in
 * catalog order (same filters as {@link resolveOnboardingAgentFromCatalog}: kind
 * text + enabled, vendor enabled + baseUrlHint, decryptable key). This is the
 * source of truth for candidate selection — {@link resolveOnboardingAgentFromCatalog}
 * is `candidates[0] ?? null`, so existing callers keep exact semantics.
 *
 * 审片环 judge 用它做**候选回退**（L3 实跑抓出的韧性缺陷）：单点依赖「目录第一个 text 模型」太脆——
 * 用户真实目录里它是经中转的 claude-fable-5，对 chat 调用连续 500。judge 首调失败 → 顺移下一候选。
 * 排序与既有一致（catalog 顺序），不引入任何环境变量开关（P1），选择逻辑纯 derive 自目录数据。
 */
export function listOnboardingAgentCandidates(): OnboardingAgent[] {
  const state = readCatalog();
  const out: OnboardingAgent[] = [];
  for (const model of state.models) {
    if (model.kind !== "text" || !modelHasPublishedExecution(model, { mappings: state.mappings })) continue;
    const vendor = state.vendors.find((v) => v.key === model.vendorKey && v.enabled);
    if (!vendor || !vendor.baseUrlHint) continue;
    // Auth-free local gateways are executable without a credential. Do not
    // probe or require a stale/legacy key record for them; credentialed
    // providers remain fail-closed and must have a decryptable safeStorage key.
    const apiKey = vendor.authType === "none" ? "" : decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]);
    if (vendor.authType !== "none" && !apiKey) continue;
    const extraHeaders = extractVendorExtraHeaders(vendor);
    out.push({
      providerKind: normalizeProviderKind(vendor.providerKind),
      baseUrl: vendor.baseUrlHint,
      vendorKey: vendor.key,
      modelId: model.modelKey,
      apiKey,
      ...(extraHeaders ? { extraHeaders } : {}),
    });
  }
  return out;
}

/**
 * Resolve the onboarding doc-reader LLM from a configured **text** model in the
 * catalog — i.e. the model the user already added (e.g. dm-fox GPT-5.5). This is
 * the product source of truth: it works identically in dev and a packaged app,
 * with no env vars / no `.secrets`. The key is decrypted here in main and never
 * leaves the process. Returns null when no usable text model is configured (the
 * caller then surfaces a "add a text model first" message). Bearer/none-auth
 * vendors only — query/x-api-key auth isn't a chat-completions shape.
 *
 * = `listOnboardingAgentCandidates()[0] ?? null`（第一个可用 text 模型，语义与既往逐字一致，
 * 现有调用方不受影响）。审片环 judge 改用**全候选序列**做回退，见 listOnboardingAgentCandidates。
 */
export function resolveOnboardingAgentFromCatalog(): OnboardingAgent | null {
  return listOnboardingAgentCandidates()[0] ?? null;
}

export function getModelCatalogHealth(): unknown {
  return deriveModelCatalogHealth(readCatalog());
}

/**
 * 明确的 custom-config 凭据写边界：先加密，再从 vendor.meta 移除旧明文。
 * 全部 legacy 字段都清理完后，才在同一内存事务中升到 v9。
 */
function applyPlainCustomConfigWrite(state: CatalogState, vendorKey: string, config: Record<string, string>): void {
  applyPlainCustomConfig(state, vendorKey, config);
  state.vendors = state.vendors.map((vendor) =>
    vendor.key === vendorKey ? { ...vendor, meta: withoutLegacyCustomConfig(vendor.meta) } : vendor,
  );
  if (state.version === 8 && !state.vendors.some(hasLegacyCustomConfigField)) state.version = 9;
}

/**
 * 把一次 vendor upsert 应用到内存 state，不读盘不写盘。
 * 事务化导入与单条公开 upsert 共用它，避免两份合并逻辑漂移。
 */
function applyVendorUpsert(state: CatalogState, payload: unknown): Vendor {
  const raw = payload as JsonRecord;
  const key = sanitizeName(raw.key, "").toLowerCase().replace(/\s+/g, "-");
  if (!key) throw new Error("vendor key is required");
  const existing = state.vendors.find((vendor) => vendor.key === key);
  guardAntigravityVendorWrite({ ...raw, key, enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true) }, existing,
    (request) => antigravityConnection.canEnable(request));
  const t = nowIso();
  const existingMeta = isJsonRecord(existing?.meta) ? existing.meta : null;
  const hasIncomingCustomConfig = Boolean(
    isJsonRecord(raw.meta) && Object.prototype.hasOwnProperty.call(raw.meta, "customConfig"),
  );
  let incomingMeta: unknown;
  if (hasIncomingCustomConfig) {
    applyPlainCustomConfigWrite(state, key, normalizedCustomConfig((raw.meta as JsonRecord).customConfig));
    incomingMeta = withoutLegacyCustomConfig(raw.meta);
  } else {
    incomingMeta = raw.meta !== undefined ? raw.meta : existing?.meta;
  }
  if (!hasIncomingCustomConfig && hasLegacyCustomConfigField(existing) && raw.meta !== undefined) {
    incomingMeta = isJsonRecord(raw.meta)
      ? {
          ...raw.meta,
          customConfig: existingMeta?.customConfig,
        }
      : { customConfig: existingMeta?.customConfig };
  }
  // Credential-bearing network config (proxyUrl / extraHeaders) is encrypted into the
  // vendor's ApiKeyRecord and never persisted as plaintext on the vendor. A field the
  // upsert actually supplies is encrypted; a field it omits falls back to the existing
  // vendor's legacy plaintext so a re-save migrates (never drops) pre-v12 secrets. The
  // plaintext is stripped off the meta/network written to the vendor row below.
  const networkIncoming = resolveNetworkConfigForWrite(raw, incomingMeta, existing, state.apiKeysByVendor[key]);
  if (networkIncoming.proxyUrl !== undefined || networkIncoming.extraHeaders !== undefined) {
    applyPlainNetworkConfig(state, key, networkIncoming);
  }
  const rawNetwork = isJsonRecord(raw.network) ? raw.network : undefined;
  const proxyEnabled = typeof rawNetwork?.proxyEnabled === "boolean"
    ? rawNetwork.proxyEnabled
    : existing?.network?.proxyEnabled;
  const vendor: Vendor = {
    key,
    name: String(raw.name || existing?.name || key).trim(),
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    hasApiKey: existing?.hasApiKey ?? false,
    baseUrlHint: typeof raw.baseUrlHint === "string" ? raw.baseUrlHint.trim() || null : (existing?.baseUrlHint ?? null),
    authType: (raw.authType as Vendor["authType"]) || existing?.authType || "bearer",
    authHeader: typeof raw.authHeader === "string" ? raw.authHeader.trim() || null : (existing?.authHeader ?? null),
    authQueryParam:
      typeof raw.authQueryParam === "string" ? raw.authQueryParam.trim() || null : (existing?.authQueryParam ?? null),
    providerKind: normalizeProviderKind(raw.providerKind, existing?.providerKind ?? "openai-compatible"),
    meta: metaWithoutExtraHeaders(incomingMeta),
    ...(proxyEnabled !== undefined ? { network: { proxyEnabled } } : {}),
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  state.vendors = [vendor, ...state.vendors.filter((item) => item.key !== key)];
  // Advance v11→v12 once no vendor still carries legacy plaintext network config
  // (mirrors the v8→v9 customConfig version bump on the explicit write boundary).
  if ((state.version as number) === 11 && !state.vendors.some(hasLegacyNetworkConfigField)) state.version = 12;
  return vendor;
}

export function upsertModelCatalogVendor(payload: unknown): Vendor {
  const state = readCatalog();
  const vendor = applyVendorUpsert(state, payload);
  writeCatalog(state);
  return publicVendor({ ...vendor, hasApiKey: apiKeyDecryptStatus(state.apiKeysByVendor[vendor.key]) === "ok" });
}

export function deleteModelCatalogVendor(key: string): void {
  const state = readCatalog();
  deleteVendorLineageAndRestore(state, key);
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
  const enabled = normalizeEnabled((payload as JsonRecord)?.enabled, true);
  state.apiKeysByVendor[key] = {
    ...makeApiKeyRecordFromPlain(apiKey, key, enabled, existing?.createdAt || t, t),
    ...(existing?.customConfig ? { customConfig: existing.customConfig } : {}),
  };
  // 名实一致：停用凭据 = 该 vendor 退出「已接入/可用」投影，与凭据写入同一次落盘。见 credentialPublication。
  if (!enabled) depublishVendorForDisabledCredential(state, key, t);
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
  const existing = state.apiKeysByVendor[key];
  if (existing?.customConfig && Object.keys(existing.customConfig).length > 0) {
    state.apiKeysByVendor[key] = { ...existing, apiKey: "", enc: "plain", enabled: false, updatedAt: t };
  } else {
    delete state.apiKeysByVendor[key];
  }
  writeCatalog(state);
  return { vendorKey: key, hasApiKey: false, enabled: false, createdAt: t, updatedAt: t };
}

/** Renderer projection: names are public, values and ciphertext never cross IPC. */
export function listModelCatalogCustomCallConfig(vendorKey: string): CustomCallConfigPublicEntry[] {
  const key = String(vendorKey || "").trim();
  const state = readCatalog();
  const vendor = state.vendors.find((item) => item.key === key);
  if (!vendor) throw new Error(`供应商不存在：${key}`);
  const names = new Set([
    ...Object.keys(state.apiKeysByVendor[key]?.customConfig || {}),
    ...Object.keys(legacyCustomConfig(vendor)),
  ]);
  return [...names].sort((left, right) => left.localeCompare(right)).map((name) => ({ name, hasValue: true }));
}

function migrateLegacyCustomConfigForWrite(state: CatalogState): CatalogState {
  const hasLegacyCustomConfig = state.vendors.some(hasLegacyCustomConfigField);
  if (!hasLegacyCustomConfig) return state;
  const migrated = migrateLegacyCustomConfigSecrets(state);
  if (!migrated) {
    throw new Error("系统安全存储不可用，无法迁移旧版自定义配置；目录未写入。请解锁系统钥匙串后重试。");
  }
  return migrated;
}

/**
 * Replace the named secret set atomically. `keepFrom` copies an existing
 * ciphertext (also covering a rename); only entries carrying `value` encrypt
 * new plaintext. Missing rows are explicit deletions.
 */
export function upsertModelCatalogCustomCallConfig(vendorKey: string, payload: unknown): CustomCallConfigPublicEntry[] {
  const state = migrateLegacyCustomConfigForWrite(readCatalog());
  const result = replaceCustomCallConfig(state, vendorKey, payload);
  writeCatalog(state);
  return result;
}

/** 纯函数:把一次 model upsert 应用到内存 state(原地改 state.models)。见 applyVendorUpsert 同理。 */
function applyModelUpsert(state: CatalogState, payload: unknown): Model {
  const raw = payload as JsonRecord;
  const modelKey = String(raw.modelKey || "").trim();
  const vendorKey = String(raw.vendorKey || "").trim();
  if (!modelKey || !vendorKey) throw new Error("modelKey and vendorKey are required");
  const existing = state.models.find((model) => model.vendorKey === vendorKey && model.modelKey === modelKey);
  guardAntigravityModelWrite({ ...raw, vendorKey, modelKey, enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true) }, existing,
    (request) => antigravityConnection.canEnable(request));
  const t = nowIso();
  const customCall = normalizeCustomCall(raw.customCall, existing?.customCall);
  const model: Model = {
    modelKey,
    vendorKey,
    modelAlias: typeof raw.modelAlias === "string" ? raw.modelAlias.trim() || null : (existing?.modelAlias ?? null),
    // 显示名兜底不落裸 id（审计 A13）：没给 labelZh 时人话化 modelKey 排版。
    labelZh: String(raw.labelZh || existing?.labelZh || "").trim() || humanizeModelKey(modelKey),
    kind: (raw.kind as BillingModelKind) || existing?.kind || "text",
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    meta: raw.meta ?? existing?.meta,
    pricing: (raw.pricing as Model["pricing"]) || existing?.pricing,
    onboarding: (raw.onboarding as Model["onboarding"]) ?? existing?.onboarding,
    // 自定义调用脚本三态：undefined=保留既有（拉取/重接入流程不 clobber 用户脚本）；
    // null=显式删除（编辑器「删除脚本恢复默认」）；对象=覆写。
    ...(customCall ? { customCall } : {}),
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  state.models = [
    model,
    ...state.models.filter((item) => !(item.vendorKey === vendorKey && item.modelKey === modelKey)),
  ];
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
  state.mappings = state.mappings.filter(
    (mapping) => !(mapping.vendorKey === vendorKey && mapping.modelKey === modelKey),
  );
  writeCatalog(state);
}

/** MCP management boundary: public connection edits and per-vendor proxy toggle.
 * Keys are deliberately absent; credential writes remain trusted-UI only. */
export function manageModelCatalogConnection(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid integration management request");
  const raw = input as JsonRecord;
  const action = String(raw.action || "");
  const vendorKey = String(raw.vendorKey || "").trim();
  if (!vendorKey) throw new Error("vendorKey is required");
  const catalog = readCatalog();
  const vendor = catalog.vendors.find((item) => item.key === vendorKey);
  if (!vendor) throw new Error(`Integration vendor not found: ${vendorKey}`);
  if (action === "update_vendor") {
    const patch: JsonRecord = { key: vendorKey };
    for (const key of ["name", "baseUrl", "authType", "authHeader", "authQueryParam", "providerKind"] as const) {
      if (raw[key] !== undefined) patch[key === "baseUrl" ? "baseUrlHint" : key] = raw[key];
    }
    return { action, vendor: upsertModelCatalogVendor(patch) };
  }
  if (action === "delete_vendor") {
    deleteModelCatalogVendor(vendorKey);
    return { action, vendorKey, deleted: true };
  }
  if (action === "delete_model") {
    const modelKey = String(raw.modelKey || "").trim();
    if (!modelKey) throw new Error("modelKey is required for delete_model");
    if (!catalog.models.some((model) => model.vendorKey === vendorKey && model.modelKey === modelKey))
      throw new Error(`Integration model not found: ${vendorKey}/${modelKey}`);
    deleteModelCatalogModel(vendorKey, modelKey);
    return { action, vendorKey, modelKey, deleted: true };
  }
  if (action === "set_proxy") {
    if (typeof raw.enabled !== "boolean") throw new Error("enabled is required for set_proxy");
    if (raw.enabled && !vendor.network?.proxyUrl) throw new Error("No secure proxy is configured for this connection");
    const updated = upsertModelCatalogVendor({ key: vendorKey, network: { proxyEnabled: raw.enabled } });
    return { action, vendorKey, enabled: raw.enabled, vendor: updated };
  }
  throw new Error(`Unknown integration management action: ${action}`);
}

/**
 * 批量删除：一次 read/write 删掉多行（用户群反馈 462 个自定义模型只能逐个删=鸡肋）。
 * 逐行调 deleteModelCatalogModel 会是 N 次同步 read+writeAtomic 循环；这里合成一次，避免大目录时卡顿。
 */
export function deleteModelCatalogModels(targets: Array<{ vendorKey: string; modelKey: string }>): void {
  const list = Array.isArray(targets) ? targets : [];
  if (list.length === 0) return;
  const keySet = new Set(list.map((t) => `${String(t?.vendorKey ?? "")}\0${String(t?.modelKey ?? "")}`));
  const state = readCatalog();
  state.models = state.models.filter((model) => !keySet.has(`${model.vendorKey}\0${model.modelKey}`));
  state.mappings = state.mappings.filter(
    (mapping) => !mapping.modelKey || !keySet.has(`${mapping.vendorKey}\0${mapping.modelKey}`),
  );
  writeCatalog(state);
}

/** 纯函数:把一次 mapping upsert 应用到内存 state(原地改 state.mappings)。见 applyVendorUpsert 同理。 */
function applyMappingUpsert(state: CatalogState, payload: unknown): Mapping {
  const raw = payload as JsonRecord;
  const vendorKey = String(raw.vendorKey || "").trim();
  const taskKind = (raw.taskKind as ProfileKind) || "chat";
  if (!vendorKey) throw new Error("vendorKey is required");
  // 可选 modelKey：把 mapping 绑到特定模型。本地 ComfyUI 导入的每条 workflow 各一 mapping——同 vendor 同 taskKind
  // 靠 modelKey 区分、不互相覆盖（selectTaskMapping：精确 modelKey > generic）。缺省=generic 桶模板（老行为不变）。
  const modelKey = typeof raw.modelKey === "string" && raw.modelKey.trim() ? raw.modelKey.trim() : undefined;
  const modeId = typeof raw.modeId === "string" && raw.modeId.trim() ? raw.modeId.trim() : undefined;
  // 定位既有行：给了 id 按 id；否则按 (vendor, taskKind, modelKey, modeId)——让调用方无需追 id 也能精确 upsert，
  // 且带 modelKey 的与 generic 的、以及不同 modelKey 的互不覆盖。
  const existing = state.mappings.find((m) =>
    raw.id
      ? m.id === raw.id
      : m.vendorKey === vendorKey && m.taskKind === taskKind && (m.modelKey || undefined) === modelKey && (m.modeId || undefined) === modeId,
  );
  const id = String(raw.id || existing?.id || `mapping-${crypto.randomUUID()}`);
  const t = nowIso();
  // Accept new shape (create/query/result) directly, or legacy {requestMapping,...}
  // (e.g. via the unchanged import path) and normalize on the way in.
  const legacy = extractLegacyStages(raw.requestMapping ?? raw.requestProfile);
  const legacyResp = extractLegacyStages(raw.responseMapping);
  const create = (raw.create as HttpOperation | undefined) || legacy.create || legacyResp.create || existing?.create;
  const query = (raw.query as HttpOperation | undefined) || legacy.query || legacyResp.query || existing?.query;
  const result = (raw.result as HttpOperation | undefined) || existing?.result;
  if (!create) throw new Error("create operation is required (method + path)");
  const mapping: Mapping = {
    id,
    vendorKey,
    taskKind,
    ...(modelKey ? { modelKey } : {}),
    ...(modeId ? { modeId } : {}),
    name: String(raw.name || existing?.name || taskKind).trim(),
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    create,
    ...(query ? { query } : {}),
    ...(result ? { result } : {}),
    ...(raw.statusMapping || legacy.statusMapping || existing?.statusMapping
      ? {
          statusMapping:
            (raw.statusMapping as Record<string, string[]>) || legacy.statusMapping || existing?.statusMapping,
        }
      : {}),
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  guardAntigravityMappingWrite(mapping, (request) => Boolean(request && antigravityConnection.hasPassed(request)));
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
      // The exported vendor is public (no credential-bearing values) UNLESS keys are
      // included for portability, in which case the effective (decrypted) proxy/headers
      // ride the vendor plaintext exactly like the API key does, and re-import re-encrypts
      // them on the target machine. Without includeApiKeys, no credential leaves the box.
      vendor: includeApiKeys
        ? exportableVendorWithNetworkConfig(publicVendor(vendor), state.apiKeysByVendor[vendor.key])
        : publicVendor(vendor),
      // Export carries plaintext keys for portability; re-import will re-encrypt on the target machine.
      ...(includeApiKeys && state.apiKeysByVendor[vendor.key]
        ? {
            apiKey: {
              apiKey: decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]),
              enabled: state.apiKeysByVendor[vendor.key].enabled,
            },
          }
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
  const raw = payload as {
    vendors?: Array<{ vendor?: unknown; apiKey?: unknown; models?: unknown[]; mappings?: unknown[] }>;
  };
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
      if (isJsonRecord(apiKey?.customConfig)) {
        applyPlainCustomConfigWrite(state, vendor.key, normalizedCustomConfig(apiKey.customConfig));
      }
      for (const model of bundle.models || []) {
        applyModelUpsert(state, { ...(model as JsonRecord), vendorKey: (model as JsonRecord).vendorKey || vendor.key });
        models += 1;
      }
      for (const mapping of bundle.mappings || []) {
        applyMappingUpsert(state, {
          ...(mapping as JsonRecord),
          vendorKey: (mapping as JsonRecord).vendorKey || vendor.key,
        });
        mappings += 1;
      }
    }
  } catch (error) {
    // 整体回滚：不写盘（磁盘还是导入前的 state），返回 0 计数 + 清晰错误。
    return {
      imported: { vendors: 0, models: 0, mappings: 0 },
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  // 全部成功 → 一次性提交。空包也安全（无变更则写回等值 state）。
  writeCatalog(state);
  return { imported: { vendors, models, mappings }, errors: [] };
}

export type CatalogMutation = {
  upsertVendor: (payload: unknown) => Vendor;
  upsertApiKey: (vendorKey: string, payload: unknown) => void;
  deleteApiKey: (vendorKey: string) => void;
  deleteVendor: (vendorKey: string) => void;
  upsertModel: (payload: unknown) => Model;
  upsertMapping: (payload: unknown) => Mapping;
  deleteModelMappings: (vendorKey: string, modelKey: string) => void;
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
    deleteApiKey: (vendorKey) => {
      delete state.apiKeysByVendor[String(vendorKey || "").trim()];
    },
    deleteVendor: (vendorKey) => removeVendorLineage(state, String(vendorKey || "").trim()),
    upsertModel: (payload) => applyModelUpsert(state, payload),
    upsertMapping: (payload) => applyMappingUpsert(state, payload),
    deleteModelMappings: (vendorKey, modelKey) => {
      state.mappings = state.mappings.filter(
        (mapping) => !(mapping.vendorKey === vendorKey && mapping.modelKey === modelKey),
      );
    },
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
