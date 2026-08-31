// API key 加密 —— 从 runtime.ts 拆出（见
// docs/plan/2026-06-04-runtime-split-execution.md 第 4 步）。
//
// safeStorage 走 OS 钥匙串（macOS Keychain / Windows DPAPI / Linux libsecret）。
// 不可用时（如无 keyring 的 rootless Linux）回退明文，并给记录打 enc 标记，
// 供下次读取时懒升级（见 runtime.ts readCatalog）。
import { safeStorage } from "electron";

export type ApiKeyRecord = {
  vendorKey: string;
  /** Key material. Encoding indicated by `enc`. Legacy v1 records have no `enc` and are plaintext. */
  apiKey: string;
  /** v2+: how the apiKey above is encoded. Absent = legacy plaintext (v1). */
  enc?: "safeStorage" | "plain";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Custom-call named configuration values. These share the vendor credential
   * record so API keys and AK/SK-style secondary secrets have one storage and
   * deletion boundary. Values are never exposed through the vendor DTO.
   */
  customConfig?: Record<string, EncryptedSecretValue>;
};

export type EncryptedSecretValue = {
  value: string;
  enc: "safeStorage";
};

let __safeStorageConfirmed = false;
let __safeStorageUnavailableWarned = false;

export function isSafeStorageAvailable(): boolean {
  if (__safeStorageConfirmed) return true;
  let available = false;
  try {
    available = safeStorage.isEncryptionAvailable();
  } catch {
    available = false;
  }
  if (available) {
    __safeStorageConfirmed = true;
    return true;
  }
  if (!__safeStorageUnavailableWarned) {
    __safeStorageUnavailableWarned = true;
    console.warn("[catalog] safeStorage unavailable; API keys will be stored as plaintext");
  }
  return false;
}

/** Build a fresh ApiKeyRecord from plaintext, encrypting if safeStorage is available. */
export function makeApiKeyRecordFromPlain(
  plain: string,
  vendorKey: string,
  enabled: boolean,
  createdAt: string,
  updatedAt: string,
): ApiKeyRecord {
  if (isSafeStorageAvailable()) {
    const encrypted = safeStorage.encryptString(plain).toString("base64");
    return { vendorKey, apiKey: encrypted, enc: "safeStorage", enabled, createdAt, updatedAt };
  }
  return { vendorKey, apiKey: plain, enc: "plain", enabled, createdAt, updatedAt };
}

/** Custom config is always fail-closed: unlike legacy API keys it may not add a plaintext fallback. */
export function encryptCustomSecretValue(plain: string): EncryptedSecretValue {
  if (!isSafeStorageAvailable()) {
    throw new Error("系统安全存储不可用，无法保存自定义配置；未写入任何明文。请解锁系统钥匙串后重试。");
  }
  return {
    value: safeStorage.encryptString(plain).toString("base64"),
    enc: "safeStorage",
  };
}

export function decryptCustomSecretValue(record: EncryptedSecretValue | undefined): string {
  if (!record?.value) return "";
  try {
    return safeStorage.decryptString(Buffer.from(record.value, "base64"));
  } catch (error) {
    console.error(
      `[catalog] failed to decrypt custom configuration: ${error instanceof Error ? error.message : error}`,
    );
    return "";
  }
}

export function decryptCustomConfigRecord(record: ApiKeyRecord | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, secret] of Object.entries(record?.customConfig || {})) {
    const normalizedName = name.trim();
    if (!normalizedName) continue;
    out[normalizedName] = decryptCustomSecretValue(secret);
  }
  return out;
}

/** Runtime compatibility for a v8 catalog whose migration is deferred until the keychain is available. */
export function decryptCustomConfigWithLegacy(
  record: ApiKeyRecord | undefined,
  vendorMeta: unknown,
): Record<string, string> {
  const legacy: Record<string, string> = {};
  if (vendorMeta && typeof vendorMeta === "object" && !Array.isArray(vendorMeta)) {
    const raw = (vendorMeta as Record<string, unknown>).customConfig;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [rawName, rawValue] of Object.entries(raw as Record<string, unknown>)) {
        const name = rawName.trim();
        if (!name) continue;
        if (typeof rawValue === "string") legacy[name] = rawValue;
        else if (typeof rawValue === "number" || typeof rawValue === "boolean") legacy[name] = String(rawValue);
        else if (rawValue === null) legacy[name] = "";
      }
    }
  }
  return { ...legacy, ...decryptCustomConfigRecord(record) };
}

/** Decode an ApiKeyRecord to plaintext. Returns "" if a safeStorage-encoded value can't be decrypted. */
export function decryptApiKeyRecord(rec: ApiKeyRecord | undefined): string {
  if (!rec || !rec.apiKey) return "";
  if (rec.enc === "safeStorage") {
    try {
      return safeStorage.decryptString(Buffer.from(rec.apiKey, "base64"));
    } catch (e) {
      console.error(
        `[catalog] failed to decrypt API key for vendor ${rec.vendorKey}: ${e instanceof Error ? e.message : e}`,
      );
      return "";
    }
  }
  // enc === "plain" or absent (legacy v1)
  return rec.apiKey;
}

/**
 * 一条 vendor 凭据记录的三态健康度——**"key 到底能不能用" 的单一真相源**（供 executableModel 报诚实错误、
 * list_models 标 keyStatus 共用，P1 不各写一份）：
 *   · `missing`：根本没有记录，或记录里没有任何 key 材料 → 没配过。
 *   · `locked` ：记录**在**，且是 safeStorage 密文，但当前宿主身份解不开（decrypt 抛错或吐空串）——
 *               典型是 capability 宿主身份与主 App 加密时的身份不符（host.ts 头注点名的坑）。
 *               这与 `missing` 天差地别：文件里明明有 key，只是这个进程读不动它。
 *   · `ok`     ：解出非空明文（或本就是非空明文的 legacy/plain 记录）→ 真能用。
 *
 * 注意「密文非空 vs 明文非空」的分野：只有 safeStorage 记录才会落进 `locked`；plain/legacy 记录解不出非空
 * 就是从未真正配好，算 `missing`（它没有"被锁住的"东西——所见即所得）。
 */
export type ApiKeyDecryptStatus = "ok" | "missing" | "locked";

export function apiKeyDecryptStatus(rec: ApiKeyRecord | undefined): ApiKeyDecryptStatus {
  if (!rec || !rec.apiKey) return "missing";
  if (rec.enc === "safeStorage") {
    // 密文在手：解得开非空 = ok；解不开 / 解出空串 = locked（身份不匹配等，key 确实存在只是读不动）。
    return decryptApiKeyRecord(rec) ? "ok" : "locked";
  }
  // plain / legacy：非空明文 = ok；空 = 从未配好，算 missing（没有"被锁"的东西）。
  return rec.apiKey ? "ok" : "missing";
}
