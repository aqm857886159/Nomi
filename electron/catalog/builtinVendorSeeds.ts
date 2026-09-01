import { KIE_VENDOR_SEED } from "./kieSeedance";
import { APIMART_VENDOR_SEED } from "./apimartVendor";
import { AGNES_VENDOR_SEED } from "./agnesVendor";
import { MODELSCOPE_VENDOR_SEED } from "./modelscopeVendor";
import { VOLCENGINE_VENDOR_SEED, VOLCENGINE_SPEECH_VENDOR_SEED } from "./volcengineVendor";
import { DREAMINA_VENDOR_SEED } from "./dreaminaVendor";
import { RUNNINGHUB_VENDOR_SEED } from "./runninghub3d";
import { REPLICATE_VENDOR_SEED } from "./replicate";
import { COMFYUI_VENDOR_SEED } from "./comfyuiLocal";
import { CODEX_LOCAL_VENDOR_SEED } from "./codexImages";
import { LOCAL_TEXT_VENDOR_SEED } from "../localRuntime/localTextVendorSeed";
import { ANTIGRAVITY_VENDOR_SEED } from "./antigravityTexts";
import { MINIMAX_VENDOR_SEED } from "./minimaxOfficial";
import { ELEVENLABS_VENDOR_SEED } from "./elevenlabs";
import { MESHY_VENDOR_SEED } from "./meshyOfficial";
import { FAL_VENDOR_SEED } from "./falOfficial";
import { RUNWAY_VENDOR_SEED } from "./runwayOfficial";
import type { Vendor } from "./types";

// ---------------------------------------------------------------------------
// 内置供应商种子的**单一清单**。此前这份名单只以「seedBuiltins 里 11 行 seedVendor 调用」
// 的形式存在，别处想知道「哪些 host 是我们内置认得的」就只能再抄一份 —— 抄一份就会漂。
// 这里集中一次，seedBuiltins 与 deriveVendorKeyFromBaseUrl 共用（P1）。
// ---------------------------------------------------------------------------

export type CredentialMode = "direct-key" | "certification";

export type VendorSeed = {
  key: string;
  name: string;
  baseUrl: string;
  /** 官方 host 迁移时仅修复仍指向旧内置 host 的存量记录；用户自定义 relay 永不覆盖。 */
  legacyBaseUrls?: readonly string[];
  authType: Vendor["authType"];
  authHeader?: string | null;
  authQueryParam?: string | null;
  providerKind?: Vendor["providerKind"];
  enabled?: boolean;
  assetIngestion?: Vendor["assetIngestion"];
  /**
   * How a credential entered in the built-in Settings card becomes usable.
   * `direct-key` is reserved for code-owned, published contracts (currently
   * APIMart); absent means the canonical integration-certification flow owns
   * promotion.
   */
  credentialMode?: CredentialMode;
};

/** 顺序 = 原 seedBuiltins 的播种顺序（保持既有装机行为一致）。 */
export const BUILTIN_VENDOR_SEEDS: readonly VendorSeed[] = [
  KIE_VENDOR_SEED,
  APIMART_VENDOR_SEED,
  AGNES_VENDOR_SEED, // Agnes AI 公开模型目录；以账户实际额度为准
  MODELSCOPE_VENDOR_SEED,
  VOLCENGINE_VENDOR_SEED,
  VOLCENGINE_SPEECH_VENDOR_SEED,
  DREAMINA_VENDOR_SEED,
  RUNNINGHUB_VENDOR_SEED, // RunningHub aggregator（先接 3D 混元文生3D）
  REPLICATE_VENDOR_SEED, // Replicate（元素拆解 qwen-image-layered，按量付费）
  FAL_VENDOR_SEED, // fal.ai CDN upload（模型 endpoint 由用户配置）
  RUNWAY_VENDOR_SEED, // Runway ephemeral upload（模型 endpoint 由用户配置）
  COMFYUI_VENDOR_SEED, // 本地 ComfyUI（无鉴权本地后端，默认关、用户显式启用）
  LOCAL_TEXT_VENDOR_SEED, // 本地文本模型（Ollama / LM Studio / LocalAI，无鉴权，默认关、用户显式连）
  CODEX_LOCAL_VENDOR_SEED, // Codex 本地生图（实验，默认关）
  ANTIGRAVITY_VENDOR_SEED, // 官方本机 CLI；完整能力验证前默认关闭
  MINIMAX_VENDOR_SEED,
  ELEVENLABS_VENDOR_SEED,
  MESHY_VENDOR_SEED,
];

/** Return the immutable code-owned seed for a vendor key, if one exists. */
export function builtinVendorSeed(vendorKey: string): VendorSeed | undefined {
  const key = String(vendorKey || "").trim();
  return BUILTIN_VENDOR_SEEDS.find((seed) => seed.key === key);
}

/**
 * Publicly expose the credential flow for a catalog row without trusting
 * renderer-supplied metadata. Built-ins default to certification unless the
 * immutable seed explicitly opts into the direct-key contract; custom rows do
 * not receive a mode and therefore remain fail-closed in the UI.
 */
export function credentialModeForVendor(vendorKey: string): CredentialMode | undefined {
  const seed = builtinVendorSeed(vendorKey);
  if (!seed) return undefined;
  return seed.credentialMode ?? "certification";
}

/**
 * A direct-key vendor is allowed to unlock only its shipped contract after the
 * renderer has saved an encrypted credential.  Keeping this policy beside the
 * single seed list prevents UI and IPC callers from growing vendor-name
 * allowlists in separate files.
 */
export function isBuiltinDirectKeyVendor(vendorKey: string): boolean {
  return builtinVendorSeed(vendorKey)?.credentialMode === "direct-key";
}

/**
 * Check the transport scope of a built-in direct-key vendor against its code
 * seed.  This is shared by renderer mutation and runtime bootstrap so an old
 * catalog edit cannot retarget an already-saved credential to another host.
 */
export function builtinVendorScopeMatches(vendor: Vendor): boolean {
  const seed = builtinVendorSeed(vendor.key);
  if (!seed || seed.credentialMode !== "direct-key") return false;
  const normalize = (value: unknown, trimSlashes = false): unknown => {
    if (typeof value !== "string") return value ?? null;
    const trimmed = value.trim();
    return trimSlashes ? trimmed.replace(/\/+$/, "") : trimmed;
  };
  // catalogStore normalizes an omitted providerKind to the effective default
  // before returning a live state. Compare effective values on both sides so
  // a freshly seeded APIMart row remains eligible after Settings persists it.
  const vendorProviderKind = vendor.providerKind ?? "openai-compatible";
  const seedProviderKind = seed.providerKind ?? "openai-compatible";
  return normalize(vendor.baseUrlHint, true) === normalize(seed.baseUrl, true)
    && normalize(vendor.authType) === normalize(seed.authType)
    && normalize(vendor.authHeader) === normalize(seed.authHeader)
    && normalize(vendor.authQueryParam) === normalize(seed.authQueryParam)
    && normalize(vendorProviderKind) === normalize(seedProviderKind)
    && JSON.stringify(vendor.assetIngestion ?? null) === JSON.stringify(seed.assetIngestion ?? null);
}

/**
 * 已知 host → 内置 vendorKey。
 *
 * 为什么要它：`deriveVendorKeyFromBaseUrl` 只按 hostname 造 key，于是走「添加供应商」向导接入
 * 火山方舟（地址 `https://ark.cn-beijing.volces.com/api/v3`）会造出 `ark-cn-beijing-volces-com`，
 * 而内置种子的 key 是 `volcengine` —— **同一家被劈成两个供应商**，向导那半个一条内置 mapping
 * 都拿不到（实测该 key 名下 mapping 数 = 0），于是全部 Seedream/Seedance 都退回通用最小模板。
 * 用户看到的是「接了火山但没有图生图 / 参数对不上」。
 *
 * 只收 http(s) 且带真实 hostname 的种子：本地回环种子（ComfyUI 127.0.0.1:8188、Codex `local://`）
 * 走 `local-<port>` 约定，是刻意的（同一台机上多个本地后端要按端口分家），不参与别名。
 */
const HOST_TO_BUILTIN_VENDOR_KEY: ReadonlyMap<string, string> = new Map(
  BUILTIN_VENDOR_SEEDS.flatMap((seed) => {
    if (!/^https?:\/\//i.test(seed.baseUrl)) return [];
    let hostname: string;
    try {
      hostname = new URL(seed.baseUrl).hostname.toLowerCase();
    } catch {
      return [];
    }
    // 回环种子不参与别名（见上）。
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") return [];
    return [[hostname, seed.key] as const];
  }),
);

/** 该 hostname 是否是我们内置认得的供应商；是则返回内置 vendorKey，否则 null。 */
export function builtinVendorKeyForHostname(hostname: string): string | null {
  return HOST_TO_BUILTIN_VENDOR_KEY.get(String(hostname || "").trim().toLowerCase()) ?? null;
}
