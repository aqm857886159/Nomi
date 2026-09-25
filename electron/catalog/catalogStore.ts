import crypto from "node:crypto";
import { findNonHeaderSafeChar, isJsonRecord, nowIso, type JsonRecord } from "../jsonUtils";
import { sanitizeName } from "../projects/repository";
import { configReadFailure, quarantineUnreadableConfigFile, writeConfigFileAtomic } from "../configFileStore";
import {
  catalogIsNewerOnDisk,
  catalogPath,
  modelCatalogReadOnlyStatus,
  readCatalogFile,
  readCatalogFileBytes,
  snapshotBeforeMigration,
} from "./catalogFileAccess";
export { modelCatalogReadOnlyStatus, type ModelCatalogReadOnlyStatus } from "./catalogFileAccess";
import { apiKeyDecryptStatus, decryptApiKeyRecord, makeApiKeyRecordFromPlain } from "./secrets";
import { humanizeModelKey } from "./modelLabel";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { migrateCatalogForward } from "./catalogMigrations";
import type { AiSdkProviderKind, BillingModelKind, CatalogState, HttpOperation, Mapping, Model, ProfileKind, Vendor } from "./types";
import { CURRENT_CATALOG_VERSION } from "./types";
import { normalizeCustomCall } from "./customCallMode";
import { sealUpsertDraft } from "./upsertDraft";
import { derivePublishedExecution } from "../shared/modelPublication";
import type { ModelAvailability } from "../shared/modelAvailability";
import { createCatalogAvailability } from "./catalogModelAvailability";
import { deriveModelCatalogHealth } from "./catalogHealth";
import { depublishVendorForDisabledCredential } from "./credentialPublication";
import { deleteVendorLineageAndRestore, removeVendorLineage, vendorLineageClosure } from "./vendorLineageLifecycle";
import { guardAntigravityMappingWrite, guardAntigravityModelWrite, guardAntigravityVendorWrite } from "./antigravityWriteGuard";
import { antigravityConnection } from "../ai/antigravityConnection";
import { extractLegacyStages } from "./legacyMappingMigration";
import {
  applyPlainCustomConfigWrite,
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
  hasLegacyNetworkConfigField,
  metaWithoutExtraHeaders,
  overlayDecryptedNetworkConfig,
  resolveNetworkConfigForWrite,
} from "./networkConfigStore";
import { buildCatalogPackage, CATALOG_PACKAGE_VERSION, catalogPackageImportSchema, type CatalogPackage } from "./catalogPackageFormat";
import { invalidateProviderAdapterRunsForVendors } from "../providerAdapter/store";
import { invalidateVendorValidation, normalizedConnectionScope } from "./vendorValidationInvalidation";
import { assertNoCredentialBindingRewrite, bindCredentialDestination } from "./credentialBinding"; // §6.1
export type { CustomCallConfigPatchEntry, CustomCallConfigPublicEntry } from "./customConfigStore";
// 各版 relay 迁移各住独立模块（R9 分层：迁移与读写盘/事务无关）。这里只做接线 + 再导出，
// 测试与既有调用方按原路径 import 不变。
export { migrateRelayImageEditProtocols } from "./relayImageEditMigration";
export { migrateRelayVideoImageToVideo } from "./relayVideoI2vMigration";
export { migrateRelayImageEditCapability, migrateRelayParamMaps } from "./relayLegacyMigrations";
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

// 读缓存（2026-09-25 画布跟手实测）：画布上选中一张卡，提示词面板经同步 IPC 连读十几次目录，每次都重新
// 解析、迁移、逐家解密，渲染线程被卡 29–61 ms。盘上字节没变就复用上一次的结果——键是路径 + 原始字节，
// 不是 mtime（同一毫秒两次写会漏），本进程 writeCatalog、别的实例、手改文件都自然失效。
// 有密钥解不开（钥匙串锁着）时不缓存：解锁后下一次读必须重新解密，行为与无缓存时一致。
// 调用方会就地改返回值再 writeCatalog，所以缓存本体不外借，每次给深拷贝。
let catalogReadCache: { path: string; bytes: string; state: CatalogState } | null = null;

export function readCatalog(): CatalogState {
  const cachePath = catalogPath();
  const bytes = readCatalogFileBytes();
  if (bytes !== null && catalogReadCache?.path === cachePath && catalogReadCache.bytes === bytes) {
    return structuredClone(catalogReadCache.state);
  }
  const outcome = readCatalogFile();
  if (outcome.status === "missing") {
    const initial = defaultCatalog();
    writeCatalog(initial);
    return initial;
  }
  if (outcome.status === "failed") {
    // **绝不覆盖**：读不出来的文件原样留在盘上（语法损坏的那一份改名留底），本次会话以空目录
    // 运行且 writeCatalog 会一路拒绝落盘。旧代码在这里写 defaultCatalog()，一次读失败就把用户
    // 全部模型配置永久抹平。状态由 modelCatalogReadOnlyStatus() 向界面交代。
    quarantineUnreadableConfigFile(catalogPath());
    return defaultCatalog();
  }
  const parsed = outcome.value;

  // Migrate forward. v1 → v2 tags pre-existing keys as plaintext-encoded;
  // reads preserve those records so catalog access never opens the OS keychain.
  const migrated = migrateCatalogForward(snapshotBeforeMigration(parsed), defaultCatalog, writeCatalog);

  const apiKeysByVendor = migrated.apiKeysByVendor || {};
  let everyKeyReadable = true;
  const state: CatalogState = {
    ...migrated,
    vendors: migrated.vendors.map((vendor) => {
      const keyStatus = apiKeyDecryptStatus(apiKeysByVendor[vendor.key]);
      if (keyStatus === "locked") everyKeyReadable = false;
      const base: Vendor = {
        ...vendor,
        providerKind: normalizeProviderKind(vendor.providerKind),
        hasApiKey: keyStatus === "ok",
        credentialVerificationPending: apiKeysByVendor[vendor.key]?.verificationPending === true,
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
  // 迁移可能刚把文件写了一遍：字节变了就先不缓存，下一次读再缓存新的那份。
  const cacheable = bytes !== null && everyKeyReadable && readCatalogFileBytes() === bytes;
  catalogReadCache = cacheable ? { path: cachePath, bytes, state: structuredClone(state) } : null;
  return state;
}

/**
 * 应用内置模型种子（内置档案：Seedance 等主流模型）。**app 启动时调一次**——
 * 不放进 readCatalog（那会在每次读取/测试里都触发，污染测试且多余）。幂等、存在即跳过，
 * 写盘只在新建或种子有变化时发生。
 */
export function ensureBuiltinModelSeeds(): void {
  const outcome = readCatalogFile();
  // 读不出来 / 盘上版本比本应用新 → 这一次不对账。种子对账是**写**，而写不出去的两种情形
  // 都必须安静跳过，不许抛：它此前挂在四条只读 IPC 上，抛出去就是渲染层那个空白设置页
  // （rootcause-config-loss-on-reinstall.md §0）。真正的只读状态由 modelCatalogReadOnlyStatus() 报。
  if (outcome.status === "failed") return;
  if (outcome.status === "ok" && typeof outcome.value?.version === "number" && outcome.value.version > CURRENT_CATALOG_VERSION) return;
  const current = outcome.status === "ok" ? outcome.value : null;
  const base = current ? migrateCatalogForward(snapshotBeforeMigration(current), defaultCatalog, writeCatalog) : defaultCatalog();
  const { state, changed } = applyBuiltinSeeds(base, new Date().toISOString());
  if (!current || changed) writeCatalog(state);
}

/**
 * 只读保护（P1·修高版本静默降级根因）：写盘前先看磁盘当前文件的版本——若它高于本应用
 * 理解的 CURRENT_CATALOG_VERSION，则**拒绝写回**（抛错），绝不把更新版应用写入的新字段
 * 以当前形状压扁丢弃。保护设在唯一写盘 choke point，覆盖所有 upsert/delete/import，而非
 * 逐函数堵症状。读路径不调它 → 高版本文件仍可读、可用。
 */
function writeCatalog(state: CatalogState): CatalogState {
  const outcome = readCatalogFile();
  // 读不出来就绝不写回（本次会话只读）——我们不知道盘上那份是什么，盖掉它就是永久丢失。
  // 账本只在这份文件重新读通时销账，所以一次损坏不会在同一次运行里被后续某个 upsert 洗掉。
  const failure = configReadFailure(catalogPath());
  if (outcome.status === "failed" || failure) {
    throw new Error(
      `[catalog] refusing to write: the catalog file could not be read (${failure?.reason ?? "unreadable"}: ${failure?.message ?? "unknown"}). ` +
        `CATALOG_UNREADABLE_READ_ONLY — the existing file is left untouched${failure?.quarantinedPath ? ` (kept as ${failure.quarantinedPath})` : ""}.`,
    );
  }
  const diskVersion = catalogIsNewerOnDisk(outcome);
  if (diskVersion != null) {
    throw new Error(
      `[catalog] refusing to write: on-disk version ${diskVersion} > app version ${CURRENT_CATALOG_VERSION} (read-only to avoid silent downgrade). Update the app to edit this catalog.`,
    );
  }
  writeConfigFileAtomic(catalogPath(), state);
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
/** 目录模型的对外投影。`availability` 见 shared/modelAvailability.ts：那是「能不能用」的唯一答案，
 * 在这里随行下发，渲染层一律读它、谁都不许再拼一份（P0-10 根因）。 */
export function listModelCatalogModels(params?: unknown): Array<Model & {
  published: boolean; publishedModes: ProfileKind[]; availability: ModelAvailability;
}> {
  const state = readCatalog();
  const availability = createCatalogAvailability(state);
  return filterByParams(state.models, params).map((model) => ({
    ...model,
    ...derivePublishedExecution(model, { mappings: state.mappings }),
    availability: availability.of(model),
  })) as Array<Model & { published: boolean; publishedModes: ProfileKind[]; availability: ModelAvailability }>;
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
  const availability = createCatalogAvailability(state);
  const out: OnboardingAgent[] = [];
  for (const model of state.models) {
    // 「能不能用」只有一个 owner；这里只再加本用途独有的角色要求：text + 有 baseUrl 可直连。
    if (model.kind !== "text" || !availability.of(model).usable) continue;
    const vendor = state.vendors.find((v) => v.key === model.vendorKey);
    if (!vendor || !vendor.baseUrlHint) continue;
    // Auth-free local gateways are executable without a credential.
    const apiKey = vendor.authType === "none" ? "" : decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]);
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
  const health = deriveModelCatalogHealth(readCatalog());
  // 降级运行（盘上版本更新）与「文件读不了」都必须**随健康度一起下发**，不能只留在主进程日志里：
  // 这两种情况下目录看起来就是空的，界面若拿不到理由就只能猜，用户就只会看到「配置没了」。
  return { ...(health as Record<string, unknown>), readOnly: modelCatalogReadOnlyStatus() };
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
  assertNoCredentialBindingRewrite(raw.credentialBinding, existing?.credentialBinding);
  const previousScope = normalizedConnectionScope(existing);
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
  // Credential-bearing network config is encrypted into ApiKeyRecord; omitted fields migrate legacy plaintext.
  const networkIncoming = resolveNetworkConfigForWrite(raw, incomingMeta, existing, state.apiKeysByVendor[key]);
  if (networkIncoming.proxyUrl !== undefined || networkIncoming.extraHeaders !== undefined) {
    applyPlainNetworkConfig(state, key, networkIncoming);
  }
  const rawNetwork = isJsonRecord(raw.network) ? raw.network : undefined;
  const proxyEnabled = typeof rawNetwork?.proxyEnabled === "boolean"
    ? rawNetwork.proxyEnabled
    : existing?.network?.proxyEnabled;
  // 整份覆写：Vendor 的每个字段都要有一条裁决，漏一个编译红（见 upsertDraft.ts 的类根因说明）。
  const vendor = sealUpsertDraft<Vendor>({
    key,
    name: String(raw.name || existing?.name || key).trim(),
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    hasApiKey: existing?.hasApiKey ?? false,
    // readCatalog 每次从 apiKeysByVendor[].verificationPending 现算并覆盖，落盘的值没有意义。
    credentialVerificationPending: undefined,
    baseUrlHint: typeof raw.baseUrlHint === "string" ? raw.baseUrlHint.trim() || null : (existing?.baseUrlHint ?? null),
    authType: (raw.authType as Vendor["authType"]) || existing?.authType || "bearer",
    authHeader: typeof raw.authHeader === "string" ? raw.authHeader.trim() || null : (existing?.authHeader ?? null),
    authScheme: typeof raw.authScheme === "string" ? raw.authScheme.trim() || null : (existing?.authScheme ?? undefined),
    authQueryParam: typeof raw.authQueryParam === "string" ? raw.authQueryParam.trim() || null : (existing?.authQueryParam ?? null),
    providerKind: normalizeProviderKind(raw.providerKind, existing?.providerKind ?? "openai-compatible"),
    // 绑定只从 existing 继承、永不从 payload 读（§6.1）：改地址不会顺手把绑定改掉。
    credentialBinding: existing?.credentialBinding,
    network: proxyEnabled !== undefined ? { proxyEnabled } : undefined,
    // 用户数据（这家怎么传参考图）：不带该键=保留，显式 null=清除。三态同 Model.customCall。
    assetIngestion: raw.assetIngestion === null ? undefined : ((raw.assetIngestion as Vendor["assetIngestion"]) ?? existing?.assetIngestion),
    meta: metaWithoutExtraHeaders(incomingMeta),
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  });
  state.vendors = [vendor, ...state.vendors.filter((item) => item.key !== key)];
  if (existing && previousScope !== normalizedConnectionScope(vendor)) invalidateVendorValidation(state, key);
  // Advance v11→v12 once no vendor still carries legacy plaintext network config
  // (mirrors the v8→v9 customConfig version bump on the explicit write boundary).
  if ((state.version as number) === 11 && !state.vendors.some(hasLegacyNetworkConfigField)) state.version = 12;
  return vendor;
}
export function upsertModelCatalogVendor(payload: unknown): Vendor {
  const state = readCatalog();
  const key = String((payload as JsonRecord)?.key || "").trim();
  const existing = state.vendors.find((vendor) => vendor.key === key);
  const vendor = applyVendorUpsert(state, payload);
  writeCatalog(state);
  if (existing && normalizedConnectionScope(existing) !== normalizedConnectionScope(vendor)) {
    invalidateProviderAdapterRunsForVendors(new Set([vendor.key]));
  }
  return publicVendor({ ...vendor, hasApiKey: apiKeyDecryptStatus(state.apiKeysByVendor[vendor.key]) === "ok" });
}
export function deleteModelCatalogVendor(key: string): void {
  const state = readCatalog();
  const deleting = vendorLineageClosure(state, String(key || "").trim());
  deleteVendorLineageAndRestore(state, key);
  writeCatalog(state);
  invalidateProviderAdapterRunsForVendors(deleting);
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
    ...((payload as JsonRecord)?.verificationPending === true ? { verificationPending: true as const } : {}),
    ...(existing?.networkConfig ? { networkConfig: existing.networkConfig } : {}),
    ...(existing?.customConfig ? { customConfig: existing.customConfig } : {}),
  };
  // 凭据绑定（§6.1）：全仓唯一的 key 写门，绑定不可能有第二个写入口。判据住 credentialBinding.ts。
  bindCredentialDestination(state.vendors.find((vendor) => vendor.key === key), t);
  if (!enabled) { invalidateVendorValidation(state, key); depublishVendorForDisabledCredential(state, key, t); }
}
export function upsertModelCatalogVendorApiKey(vendorKey: string, payload: unknown): unknown {
  const state = readCatalog();
  applyApiKeyUpsert(state, vendorKey, payload);
  writeCatalog(state);
  const key = String(vendorKey || "").trim();
  const rec = state.apiKeysByVendor[key];
  if (rec?.enabled === false) invalidateProviderAdapterRunsForVendors(new Set([key]));
  return { vendorKey: key, hasApiKey: true, verificationPending: rec.verificationPending === true, enabled: rec.enabled, createdAt: rec.createdAt, updatedAt: rec.updatedAt };
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
  invalidateVendorValidation(state, key);
  writeCatalog(state);
  invalidateProviderAdapterRunsForVendors(new Set([key]));
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
  const model = sealUpsertDraft<Model>({
    modelKey,
    vendorKey,
    modelAlias: typeof raw.modelAlias === "string" ? raw.modelAlias.trim() || null : (existing?.modelAlias ?? null),
    labelZh: String(raw.labelZh || existing?.labelZh || "").trim() || humanizeModelKey(modelKey),
    kind: (raw.kind as BillingModelKind) || existing?.kind || "text",
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    unlisted: typeof raw.unlisted === "boolean" ? raw.unlisted : existing?.unlisted,
    tokenPricing: existing?.tokenPricing, free: existing?.free,
    meta: raw.meta ?? existing?.meta,
    pricing: (raw.pricing as Model["pricing"]) || existing?.pricing,
    onboarding: (raw.onboarding as Model["onboarding"]) ?? existing?.onboarding,
    customCall: customCall || undefined,
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  });
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
  deleteModelCatalogModels([{ vendorKey, modelKey }]);
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
  const suppressed = [...(state.suppressedBuiltinModels || [])];
  for (const model of state.models) {
    if (keySet.has(`${model.vendorKey}\0${model.modelKey}`) && isJsonRecord(model.meta) && typeof model.meta.catalogLifecycle === "string"
      && !suppressed.some((row) => row.vendorKey === model.vendorKey && row.modelKey === model.modelKey)) {
      suppressed.push({ vendorKey: model.vendorKey, modelKey: model.modelKey });
    }
  }
  state.suppressedBuiltinModels = suppressed;
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
  const mapping = sealUpsertDraft<Mapping>({
    id,
    vendorKey,
    taskKind,
    modelKey,
    modeId,
    name: String(raw.name || existing?.name || taskKind).trim(),
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    create,
    // 传输契约（同步/异步 + 任务不要了怎么办，见 transportDelivery.ts）：导入包会带，不许落盘即丢。
    delivery: (raw.delivery as Mapping["delivery"]) ?? existing?.delivery,
    abandon: (raw.abandon as Mapping["abandon"]) ?? existing?.abandon,
    query: query || undefined,
    result: result || undefined,
    statusMapping: (raw.statusMapping as Record<string, string[]>) || legacy.statusMapping || existing?.statusMapping,
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  });
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
export function exportModelCatalogPackage(): CatalogPackage {
  // 形状与凭据裁决都住在 catalogPackageFormat（那里同时放着它必须满足的 zod 契约与「永不带 key」的理由）。
  // 这里只负责读一份 state。导出**不接受任何参数**：没有「这次带上 key」这一档。
  return buildCatalogPackage(readCatalog());
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
export type CatalogImportConflict = Readonly<{
  kind: "vendor" | "model" | "mapping";
  /** 供应商 key；model 再带 modelKey，mapping 再带 id。界面照这个出「冲突清单」。 */
  vendorKey: string;
  modelKey?: string;
  mappingId?: string;
}>;

export type CatalogImportResult = Readonly<{
  imported: { vendors: number; models: number; mappings: number };
  /** 因为本机已经有同一条而**没有动**的数量。 */
  kept: { vendors: number; models: number; mappings: number };
  conflicts: CatalogImportConflict[];
  errors: string[];
}>;

const emptyImportResult = (errors: string[]): CatalogImportResult => ({
  imported: { vendors: 0, models: 0, mappings: 0 },
  kept: { vendors: 0, models: 0, mappings: 0 },
  conflicts: [],
  errors,
});

export function importModelCatalogPackage(payload: unknown, options?: { conflictPolicy?: "keep" | "replace" }): CatalogImportResult {
  // 比 zod 早一步说人话：包版本比这个应用新时，zod 只会吐一句「Invalid literal value」，
  // 而用户需要知道的是「这份是更新版本的 Nomi 导出的，请升级后再导入」。
  const declaredVersion = isJsonRecord(payload) ? payload.version : undefined;
  if (typeof declaredVersion === "string" && declaredVersion !== CATALOG_PACKAGE_VERSION) {
    return emptyImportResult([
      `这份配置包的格式是 ${declaredVersion}，当前 Nomi 只认识 ${CATALOG_PACKAGE_VERSION}。`
        + `多半是更新版本的 Nomi 导出的——请先升级 Nomi 再导入。你现在的配置一个字都没动。`,
    ]);
  }
  // 信封先过公开契约（docs/engineering/formats/desktop-local-v1.schema.json 就是它导出来的）。
  // 骨架不对 = 整包不写、原因照实说，而不是一路 as 下去在某条 upsert 里抛一句看不懂的话。
  // 条目内部仍交给既有 apply*Upsert 归一（新旧两种 mapping 形状都收），这里不改写任何一格。
  const envelope = catalogPackageImportSchema.safeParse(payload);
  if (!envelope.success) {
    return emptyImportResult(
      envelope.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "package"}: ${issue.message}`),
    );
  }
  const raw = payload as {
    vendors?: Array<{ vendor?: unknown; apiKey?: unknown; models?: unknown[]; mappings?: unknown[] }>;
  };
  // **合并，不是覆盖**（09-21 拍板）：本机已经有同一条时默认保留本机那份，并把冲突列给用户看。
  // 为什么默认是「保留」：导入最常见的两个场景是「新机器上恢复」（本机是空的，零冲突、全量进来）
  // 和「补上我缺的那几家」。反过来默认覆盖，就会在用户只想补一家时安静改掉他调好的另一家——
  // 那又是一次「我的配置自己变了」。要覆盖必须是用户在确认那一步显式选的（conflictPolicy: 'replace'）。
  const keepExisting = (options?.conflictPolicy ?? "keep") === "keep";
  const state = readCatalog();
  let vendors = 0;
  let models = 0;
  let mappings = 0;
  const kept = { vendors: 0, models: 0, mappings: 0 };
  const conflicts: CatalogImportConflict[] = [];
  try {
    for (const bundle of raw.vendors || []) {
      const incomingKey = sanitizeName((bundle.vendor as JsonRecord | undefined)?.key, "").toLowerCase().replace(/\s+/g, "-");
      const existingVendor = state.vendors.find((candidate) => candidate.key === incomingKey);
      let vendorKey = incomingKey;
      if (existingVendor && keepExisting) {
        conflicts.push({ kind: "vendor", vendorKey: existingVendor.key });
        kept.vendors += 1;
      } else {
        const vendor = applyVendorUpsert(state, bundle.vendor);
        vendorKey = vendor.key;
        if (existingVendor) conflicts.push({ kind: "vendor", vendorKey });
        vendors += 1;
      }
      const apiKey = bundle.apiKey as JsonRecord | undefined;
      // 凭据只在本机还没有一份时写入：导入绝不覆盖用户已经存好的 key（那是最难重建、也最不该被
      // 一次导入换掉的东西）。导入侧仍然**收** key——那是「让 AI 直接写一份配置」那条接入路径。
      const hasCredential = Boolean(state.apiKeysByVendor[vendorKey]);
      if (apiKey?.apiKey && (!hasCredential || !keepExisting)) applyApiKeyUpsert(state, vendorKey, apiKey);
      if (isJsonRecord(apiKey?.customConfig) && (!hasCredential || !keepExisting)) {
        applyPlainCustomConfigWrite(state, vendorKey, normalizedCustomConfig(apiKey.customConfig));
      }
      for (const model of bundle.models || []) {
        const row = model as JsonRecord;
        const modelKey = String(row.modelKey || "");
        const owner = String(row.vendorKey || vendorKey);
        if (keepExisting && state.models.some((item) => item.vendorKey === owner && item.modelKey === modelKey)) {
          conflicts.push({ kind: "model", vendorKey: owner, modelKey });
          kept.models += 1;
          continue;
        }
        applyModelUpsert(state, { ...row, vendorKey: owner });
        models += 1;
      }
      for (const mapping of bundle.mappings || []) {
        const row = mapping as JsonRecord;
        const mappingId = String(row.id || "");
        if (keepExisting && mappingId && state.mappings.some((item) => item.id === mappingId)) {
          conflicts.push({ kind: "mapping", vendorKey: String(row.vendorKey || vendorKey), mappingId });
          kept.mappings += 1;
          continue;
        }
        applyMappingUpsert(state, { ...row, vendorKey: row.vendorKey || vendorKey });
        mappings += 1;
      }
    }
  } catch (error) {
    // 整体回滚：不写盘（磁盘还是导入前的 state），返回 0 计数 + 清晰错误。
    return emptyImportResult([error instanceof Error ? error.message : String(error)]);
  }
  // 全部成功 → 一次性提交，走的就是手动保存那一扇写入门（writeCatalog），所以：读不出来拒绝写、
  // 盘上版本更新拒绝写、写前把上一版轮转成 model-catalog.bak.json —— 导入前的留底不需要另写一份。
  writeCatalog(state);
  return { imported: { vendors, models, mappings }, kept, conflicts, errors: [] };
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
export function mutateCatalog<T>(fn: (tx: CatalogMutation, state: Readonly<CatalogState>) => T): T {
  const state = readCatalog();
  const invalidatedVendors = new Set<string>();
  const tx: CatalogMutation = {
    upsertVendor: (payload) => applyVendorUpsert(state, payload),
    upsertApiKey: (vendorKey, payload) => {
      applyApiKeyUpsert(state, vendorKey, payload);
      if ((payload as JsonRecord)?.enabled === false) invalidatedVendors.add(String(vendorKey || "").trim());
    },
    deleteApiKey: (vendorKey) => {
      const key = String(vendorKey || "").trim();
      delete state.apiKeysByVendor[key];
      invalidateVendorValidation(state, key);
      invalidatedVendors.add(key);
    },
    deleteVendor: (vendorKey) => {
      const key = String(vendorKey || "").trim();
      vendorLineageClosure(state, key).forEach((candidate) => invalidatedVendors.add(candidate));
      removeVendorLineage(state, key);
    },
    upsertModel: (payload) => applyModelUpsert(state, payload),
    upsertMapping: (payload) => applyMappingUpsert(state, payload),
    deleteModelMappings: (vendorKey, modelKey) => {
      state.mappings = state.mappings.filter(
        (mapping) => !(mapping.vendorKey === vendorKey && mapping.modelKey === modelKey),
      );
    },
  };
  const result = fn(tx, state);
  writeCatalog(state);
  invalidateProviderAdapterRunsForVendors(invalidatedVendors);
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
