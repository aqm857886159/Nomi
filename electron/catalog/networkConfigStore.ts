// 「可携带凭据的连接配置」加密编排层 —— proxyUrl（可含 user:pass）与 extraHeaders（可含 Authorization）
// 走**与 apiKey/customConfig 完全同一条 safeStorage 机制**（P1 不另起加密管线；P4 机制只感知「凭据载荷」，
// 不感知「这是代理还是头」）。与 customConfigStore.ts 平行：值加密进 ApiKeyRecord，明文永不进 catalog；
// 解密只在明确读取时发生；旧明文（vendor.network.proxyUrl / vendor.meta.extraHeaders）延迟迁移。
//
// 为什么把两者放一个 store：它们是**同一类**——「连接级、可携带密钥、随 vendor 记录一起增删」。统一边界
// 才能让「凭据字段明文落盘」这类问题整类消失（见 credentialConfigFields.ts 的结构性预防登记表）。
import { isJsonRecord, nowIso, type JsonRecord } from "../jsonUtils";
import {
  type ApiKeyRecord,
  type EncryptedSecretValue,
  decryptCustomSecretValue,
  encryptCustomSecretValue,
} from "./secrets";
import type { CatalogState, Vendor } from "./types";

/** 一条 vendor 记录里「网络类凭据」的加密载荷（与 customConfig 同 tier，同 record 同删除边界）。 */
export type EncryptedNetworkConfig = {
  /** 整串代理 URL（含可能的 user:pass），加密后的形。缺省 = 未配代理。 */
  proxyUrl?: EncryptedSecretValue;
  /** 自定义请求头：**每个值**独立加密（头名是公开的、值才是秘密）。缺省 = 无自定义头。 */
  extraHeaders?: Record<string, EncryptedSecretValue>;
};

/** 从 vendor 读旧明文 proxyUrl（迁移前的落盘形）。空串/非串视为无。 */
function legacyProxyUrl(vendor: Vendor | undefined): string {
  const raw = vendor?.network?.proxyUrl;
  return typeof raw === "string" ? raw.trim() : "";
}

/** 从 vendor.meta 读旧明文 extraHeaders（迁移前的落盘形）。只取 string→string 的合法项。 */
function legacyExtraHeaders(vendor: Vendor | undefined): Record<string, string> {
  const meta = isJsonRecord(vendor?.meta) ? vendor.meta : {};
  const raw = meta.extraHeaders;
  if (!isJsonRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(raw)) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    const value = String(rawValue ?? "").trim();
    if (value) out[name] = value;
  }
  return out;
}

/** vendor 是否还带**旧明文** network/header 字段（迁移判据）。 */
export function hasLegacyNetworkConfigField(vendor: Vendor | undefined): boolean {
  const meta = isJsonRecord(vendor?.meta) ? vendor.meta : undefined;
  const hasLegacyProxy = typeof vendor?.network?.proxyUrl === "string" && vendor.network.proxyUrl.trim().length > 0;
  const hasLegacyHeaders = Boolean(meta && isJsonRecord(meta.extraHeaders) && Object.keys(meta.extraHeaders).length > 0);
  return hasLegacyProxy || hasLegacyHeaders;
}

/** 把整串 proxyUrl 加密成载荷（空串 = 清除，返回 undefined）。安全存储不可用时 fail-closed（抛错）。 */
export function encryptProxyUrl(plain: string): EncryptedSecretValue | undefined {
  const trimmed = plain.trim();
  return trimmed ? encryptCustomSecretValue(trimmed) : undefined;
}

/** 把 extraHeaders（明文 map）逐值加密（保留头名，只加密值）。空 map = undefined。fail-closed。 */
export function encryptExtraHeaders(plain: Record<string, string>): Record<string, EncryptedSecretValue> | undefined {
  const out: Record<string, EncryptedSecretValue> = {};
  for (const [rawName, rawValue] of Object.entries(plain)) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    const value = String(rawValue ?? "").trim();
    if (!value) continue;
    out[name] = encryptCustomSecretValue(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 解出整串 proxyUrl 明文（解不开 → 空串，与 apiKey 解密同容错）。 */
export function decryptProxyUrl(record: EncryptedNetworkConfig | undefined): string {
  return decryptCustomSecretValue(record?.proxyUrl);
}

/** 解出 extraHeaders 明文 map（逐值解密，头名保留）。 */
export function decryptExtraHeaders(record: EncryptedNetworkConfig | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, secret] of Object.entries(record?.extraHeaders || {})) {
    const key = name.trim();
    if (!key) continue;
    const value = decryptCustomSecretValue(secret);
    if (value) out[key] = value;
  }
  return out;
}

/**
 * 读取时的**解密 + 旧明文兜底**：优先用加密载荷，缺失才回退到 vendor 上的旧明文。
 * 供 readCatalog 在唯一读 choke point 把明文 proxyUrl/extraHeaders 回填到**内部** vendor（供出站消费者
 * 同步读取），DTO 侧由 publicVendor 剥离。加密值优先、旧明文兜底——保证迁移前后读到的值一致。
 */
export function resolveNetworkConfigForRead(
  vendor: Vendor,
  record: ApiKeyRecord | undefined,
): { proxyUrl?: string; proxyEnabled?: boolean; extraHeaders?: Record<string, string> } {
  const encrypted = record?.networkConfig;
  const proxyUrl = decryptProxyUrl(encrypted) || legacyProxyUrl(vendor);
  const decryptedHeaders = decryptExtraHeaders(encrypted);
  const extraHeaders = Object.keys(decryptedHeaders).length > 0 ? decryptedHeaders : legacyExtraHeaders(vendor);
  return {
    ...(proxyUrl ? { proxyUrl } : {}),
    ...(vendor.network?.proxyEnabled !== undefined ? { proxyEnabled: vendor.network.proxyEnabled } : {}),
    ...(Object.keys(extraHeaders).length > 0 ? { extraHeaders } : {}),
  };
}

/**
 * 把一次 vendor upsert 携带的明文 proxyUrl/extraHeaders 加密进它的 ApiKeyRecord（原地改 state），
 * 并从待写 vendor 上摘掉明文——写边界的单一入口（applyVendorUpsert 调它）。safeStorage 不可用时
 * encrypt* 抛错，事务整体不写（与 customConfig 一致，fail-closed）。
 *
 * `incomingProxyUrl` / `incomingExtraHeaders` 为 undefined 时表示「本次未提供该字段」→ 保留记录里已存的；
 * 空串 / 空 map 表示「显式清空」。
 */
export function applyPlainNetworkConfig(
  state: CatalogState,
  vendorKey: string,
  incoming: { proxyUrl?: string; extraHeaders?: Record<string, string> },
): void {
  const existing = credentialRecordForNetworkWrite(state, vendorKey);
  const existingNetwork = existing.networkConfig || {};

  let nextProxy: EncryptedSecretValue | undefined = existingNetwork.proxyUrl;
  if (incoming.proxyUrl !== undefined) nextProxy = encryptProxyUrl(incoming.proxyUrl);
  let nextHeaders: Record<string, EncryptedSecretValue> | undefined = existingNetwork.extraHeaders;
  if (incoming.extraHeaders !== undefined) nextHeaders = encryptExtraHeaders(incoming.extraHeaders);

  const nextNetwork: EncryptedNetworkConfig = {
    ...(nextProxy ? { proxyUrl: nextProxy } : {}),
    ...(nextHeaders ? { extraHeaders: nextHeaders } : {}),
  };
  const t = nowIso();

  if (Object.keys(nextNetwork).length > 0) {
    state.apiKeysByVendor[vendorKey] = { ...existing, networkConfig: nextNetwork, updatedAt: t };
    return;
  }
  // 无网络凭据了：若记录还有别的凭据（apiKey / customConfig）则只去掉 networkConfig，否则整条清除。
  const rest = { ...existing };
  delete rest.networkConfig;
  if (rest.apiKey || (rest.customConfig && Object.keys(rest.customConfig).length > 0)) {
    state.apiKeysByVendor[vendorKey] = { ...rest, updatedAt: t };
  } else {
    delete state.apiKeysByVendor[vendorKey];
  }
}

/** Ensure a credential record exists for a network-config write (mirrors customConfigStore.credentialRecord). */
function credentialRecordForNetworkWrite(state: CatalogState, vendorKey: string): ApiKeyRecord {
  const existing = state.apiKeysByVendor[vendorKey];
  if (existing) return existing;
  const t = nowIso();
  return { vendorKey, apiKey: "", enc: "plain", enabled: false, createdAt: t, updatedAt: t };
}

/**
 * Internal-only read overlay: apply the effective (encrypted-record-wins, legacy-fallback)
 * proxy/extraHeaders onto the vendor the outbound layer reads. Does NOT strip legacy plaintext
 * (write-time migration still needs to find it). Never hand the result to a renderer/export path.
 */
export function overlayDecryptedNetworkConfig(vendor: Vendor, record: ApiKeyRecord | undefined): Vendor {
  if (!record?.networkConfig) return vendor;
  const resolved = resolveNetworkConfigForRead(vendor, record);
  const next: Vendor = { ...vendor };
  if (resolved.proxyUrl || resolved.proxyEnabled !== undefined) next.network = { ...(vendor.network || {}), ...(resolved.proxyUrl ? { proxyUrl: resolved.proxyUrl } : {}) };
  if (resolved.extraHeaders) {
    const meta = isJsonRecord(vendor.meta) ? vendor.meta : {};
    next.meta = { ...meta, extraHeaders: resolved.extraHeaders };
  }
  return next;
}

/**
 * A portable vendor for an include-keys export: the effective (decrypted) proxy/extraHeaders are
 * re-attached as plaintext so the destination re-encrypts them on import, mirroring the plaintext
 * apiKey. Reads the resolved values from the record (the overlaid vendor already carries them).
 */
export function exportableVendorWithNetworkConfig(base: Vendor, record: ApiKeyRecord | undefined): Vendor {
  const resolved = resolveNetworkConfigForRead(base, record);
  const meta = isJsonRecord(base.meta) ? { ...base.meta } : undefined;
  const nextMeta = resolved.extraHeaders ? { ...(meta || {}), extraHeaders: resolved.extraHeaders } : meta;
  return {
    ...base,
    ...(resolved.proxyUrl || resolved.proxyEnabled !== undefined ? { network: { ...(base.network || {}), ...(resolved.proxyUrl ? { proxyUrl: resolved.proxyUrl } : {}) } } : {}),
    ...(nextMeta ? { meta: nextMeta } : {}),
  };
}

/** Drop plaintext extraHeaders from the meta that will be persisted on the vendor row. */
export function metaWithoutExtraHeaders(meta: unknown): unknown {
  if (!isJsonRecord(meta) || !Object.prototype.hasOwnProperty.call(meta, "extraHeaders")) return meta;
  const clean = { ...meta };
  delete clean.extraHeaders;
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/** string→string, trimmed, dropping empty keys/values (matches extractVendorExtraHeaders shape). */
export function normalizedExtraHeaders(raw: unknown): Record<string, string> {
  if (!isJsonRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(raw)) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    const value = String(rawValue ?? "").trim();
    if (value) out[name] = value;
  }
  return out;
}

/**
 * Resolve the credential-bearing network fields to encrypt for one vendor upsert. A field the
 * upsert explicitly supplies (raw.network for proxy, raw.meta.extraHeaders for headers) wins,
 * including an explicit empty value (which clears it). A field the upsert omits falls back to the
 * EXISTING vendor's legacy plaintext so a plain re-save migrates pre-v12 secrets instead of
 * stripping them — but only when the record does not already hold that secret, so an
 * already-encrypted value is never re-encrypted or made to fail closed on an unrelated re-save.
 */
export function resolveNetworkConfigForWrite(
  raw: JsonRecord,
  incomingMeta: unknown,
  existing: Vendor | undefined,
  existingRecord: ApiKeyRecord | undefined,
): { proxyUrl?: string; extraHeaders?: Record<string, string> } {
  const out: { proxyUrl?: string; extraHeaders?: Record<string, string> } = {};
  const encrypted = existingRecord?.networkConfig;

  const rawNetwork = raw.network;
  if (rawNetwork !== undefined) {
    const hasProxyUrl = isJsonRecord(rawNetwork) && Object.prototype.hasOwnProperty.call(rawNetwork, "proxyUrl");
    const proxyUrl = hasProxyUrl && isJsonRecord(rawNetwork) ? rawNetwork.proxyUrl : undefined;
    if (hasProxyUrl) out.proxyUrl = typeof proxyUrl === "string" ? proxyUrl : "";
    else if (!encrypted?.proxyUrl) {
      const legacyProxy = typeof existing?.network?.proxyUrl === "string" ? existing.network.proxyUrl.trim() : "";
      if (legacyProxy) out.proxyUrl = legacyProxy;
    }
  } else if (!encrypted?.proxyUrl) {
    const legacyProxy = typeof existing?.network?.proxyUrl === "string" ? existing.network.proxyUrl.trim() : "";
    if (legacyProxy) out.proxyUrl = legacyProxy;
  }

  const suppliesHeaders = raw.meta !== undefined
    && ((isJsonRecord(incomingMeta) && Object.prototype.hasOwnProperty.call(incomingMeta, "extraHeaders"))
      || (isJsonRecord(raw.meta) && Object.prototype.hasOwnProperty.call(raw.meta, "extraHeaders")));
  if (suppliesHeaders) {
    const source = isJsonRecord(incomingMeta) && Object.prototype.hasOwnProperty.call(incomingMeta, "extraHeaders")
      ? (incomingMeta as JsonRecord).extraHeaders
      : (raw.meta as JsonRecord).extraHeaders;
    out.extraHeaders = normalizedExtraHeaders(source);
  } else if (!encrypted?.extraHeaders) {
    const legacyHeaders = normalizedExtraHeaders(isJsonRecord(existing?.meta) ? existing.meta.extraHeaders : undefined);
    if (Object.keys(legacyHeaders).length > 0) out.extraHeaders = legacyHeaders;
  }
  return out;
}
