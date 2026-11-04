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
import { LOCAL_SPEECH_VENDOR_SEED } from "./localSpeech";
import { MESHY_VENDOR_SEED } from "./meshyOfficial";
import { HIGGSFIELD_VENDOR_SEED } from "./higgsfieldVendor";
import { FAL_VENDOR_SEED } from "./falOfficial";
import { RUNWAY_VENDOR_SEED } from "./runwayOfficial";
import { codeDeclaredFallbackOrigins } from "../vendor/vendorBaseFallback";
import type { HttpOperation, Vendor } from "./types";

// ---------------------------------------------------------------------------
// 内置供应商种子的**单一清单**。此前这份名单只以「seedBuiltins 里 11 行 seedVendor 调用」
// 的形式存在，别处想知道「哪些 host 是我们内置认得的」就只能再抄一份 —— 抄一份就会漂。
// 这里集中一次，seedBuiltins 与 deriveVendorKeyFromBaseUrl 共用（P1）。
// ---------------------------------------------------------------------------

export type CredentialMode = "direct-key" | "certification";

/** 一条代码拥有的探测端点声明（端点 + 成功判据 + 出处）。两种探针共用这个形状。 */
export type ProbeDeclaration = {
  request: Pick<HttpOperation, "method" | "path" | "body">;
  successPath: string;
  source: { url: string; checkedAt: string };
};

export type VendorSeed = {
  key: string;
  name: string;
  baseUrl: string;
  /** 官方 host 迁移时仅修复仍指向旧内置 host 的存量记录；用户自定义 relay 永不覆盖。 */
  legacyBaseUrls?: readonly string[];
  authType: Vendor["authType"];
  authHeader?: string | null;
  /** Authorization 方案词（缺省 Bearer）；见 catalog/types.ts 的 Vendor.authScheme。 */
  authScheme?: Vendor["authScheme"];
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
  /**
   * **每周雷达**的逐模型存活探针：「这个模型这周还活着吗」。
   *
   * 它按定义是一次**真实的最小生成**（apimart: `POST /api/v1/chat/completions`，`max_tokens:1`），
   * 也只该由 `scripts/model-liveness.ts` 那条每周任务付钱 —— 一个模型一次，刻意的、有预算的。
   *
   * ⚠️ 它**不是**「这把 key 能不能用」的判据，那是下面的 `credentialProbe`。两个问题不同：
   * 逐模型存活必须真发一次生成才答得了，凭据有效性不必；合用一个声明位，就等于让后者继承
   * 前者的价格——2026-09-22 之前正是如此（原委见 `credentialProbePolicy.ts` 文件头）。
   */
  livenessProbe?: ProbeDeclaration;
  /**
   * 「这把 key 现在能不能用」的代码拥有的探测端点（2026-09-22 T-MO-10 新增）。
   *
   * `cost` 是这条声明的一部分，由 `credentialProbePolicy.ts` **单点**消费（为什么、以及缺省
   * 为什么是 `paid`，见那个文件的文件头）：
   *   · `cost: 'free'`  —— 有出处地证明过零费用（`source` 必须指得到官方文档原文）；
   *   · `cost: 'paid'`（也是**缺省**）—— 它会花钱，发之前必须先经确认面问一句。
   */
  credentialProbe?: ProbeDeclaration & { cost?: "free" | "paid" };
  /**
   * 该家的 key 该拿什么当判据（**种子声明，不是按路由猜**）。
   *
   * ⚠️ 种子带 `credentialProbe` 的（apimart / higgsfield）按那条声明走，根本不读本字段。
   *
   * 为什么需要它：`GET /v1/models` 既不充分也不必要，两个方向的反例都在我们自己的证据里——
   * apimart 对合法 key 恒 401（electron/vendor/vendorBaseFallback.ts 实测注释），minimax 回 200
   * 却连最小生成 canary 都跑不通（认证账本 blocker 原文）。详见
   * docs/research/2026-09-10-vendor-key-publish-class/prior-art.md 第 ④ 节。
   *
   *  · `model-list`    ：上游确有 OpenAI 兼容模型列表端点，且它对合法 key 会放行。
   *                      ⚠️ 现役无人声明这一档。第一个声明它的人请连带补上
   *                      `electron/ai/onboarding/vendorHealth.ts` 的清标记分支：那里探测成功后
   *                      只 `delete verificationPending`，不发布 vendor，于是这一档的 pending 凭据
   *                      转正后会卡在「验证过了但模型还是不出现」的半截状态。今天它不可达
   *                      （唯一会 pending 的内置家是 apimart，而它的 /v1/models 恒 401、res.ok 永假），
   *                      所以刻意不预先写那段代码（P1：不留投机路径），把提醒留在声明处。
   *  · `first-use`     ：没有便宜且可信的预检——最小真实请求 = 一次付费生成，不能替用户花钱。
   *                      存 key 即发布 + 标「待首次使用验证」，首次生成的鉴权失败走现有诚实报错。
   *
   * 缺省 = `first-use`：内置家的执行契约是代码拥有、且逐条验证过才进种子的（认证账本
   * docs/integration-certification/model-certification-ledger.json + 各契约文件的实测注释），
   * 发布它们不需要再向上游多要一次许可。
   */
  keyValidation?: KeyValidationStrategy;
  /**
   * 代码拥有的执行契约**不走 mapping 运行时**、而住在主进程专用路径时，在这里指出去。
   * 现役唯一一例：Replicate 元素拆解是多输出（一次返回 N 张图层），刻意不套单结果 runtime
   * （electron/catalog/replicate.ts 顶注、docs/plan/2026-06-28-element-decomposition-feature.md §3.1），
   * 因此它没有 curated mapping —— 但它同样是「代码拥有、已真生成实测固化」的契约，发布判据必须认它，
   * 否则「元素拆解」永远点不亮。为它编一条没人消费的假 mapping 才是不诚实的那条路。
   */
  bespokeExecution?: { capability: string; path: string };
};

/** key 判据的两种形态（详见 `VendorSeed.keyValidation`）。种子带 `credentialProbe` 时按它走，不经这里。 */
export type KeyValidationStrategy = "model-list" | "first-use";

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
  LOCAL_SPEECH_VENDOR_SEED, // 本地转写（离线 whisper.cpp sidecar；无鉴权、不花钱，首次用时才下引擎与权重）
  HIGGSFIELD_VENDOR_SEED, // Higgsfield 官方直连（Soul 2 / Soul Cinema / DoP；74 个转售模型不接）
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
 * 这家的凭据判据是不是**代码拥有**的（= 有内置种子）。
 *
 * 2026-09-22（T-MO-10）：原来这里叫 `credentialValidationStrategy`，既回答「怎么验」也被
 * 当成「有没有内置判据」用。「怎么验、验它花不花钱」已经收进唯一 owner
 * `credentialProbePolicy.ts`——判据只该在那一处成立，这里如果再派发一次就是第二份判断，
 * 而两份判断里会漂的那一份正好是**钱**。所以这里只剩下发布侧真正要问的那个是非题。
 */
export function hasBuiltinCredentialJudgement(vendorKey: string): boolean {
  return Boolean(builtinVendorSeed(vendorKey));
}

/**
 * 该 catalog 行的传输面是否仍等于它的代码种子。渲染层写入、运行时 bootstrap 与凭据发布共用
 * 这一份判据，于是「一次旧的 catalog 编辑把已存凭据改指别的 host」在任何一条路上都拦得住。
 *
 * 2026-09-10 去掉了「仅 direct-key」的前置：三个既有调用点本就分别被 `isBuiltinDirectKeyVendor`
 * 早退（generationProviderBootstrap.ts 的 hasSafeDirectKeyScope、apimartGenerationProvider.ts 的
 * direct-key 契约断言）或写死 apimart，行为不变；而凭据发布要对**所有**内置家问同一个问题，
 * 前置留在这里就成了第二条 vendor 白名单。
 */
export function builtinVendorScopeMatches(vendor: Vendor): boolean {
  const seed = builtinVendorSeed(vendor.key);
  if (!seed) return false;
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
  // 换到这家代码里登记的官方备用域（APIMart 的国内线路）仍是同一条内置连接：
  // 名单只有一份，就是凭据守卫认的那张（vendorBaseFallback 的 FAMILIES）。
  let baseOrigin = "";
  try { baseOrigin = new URL(String(vendor.baseUrlHint ?? "")).origin; } catch { /* 解析不出来 = 不是官方线路 */ }
  return (normalize(vendor.baseUrlHint, true) === normalize(seed.baseUrl, true)
      || codeDeclaredFallbackOrigins(seed.key).includes(baseOrigin))
    && normalize(vendor.authType) === normalize(seed.authType)
    && normalize(vendor.authHeader) === normalize(seed.authHeader)
    && normalize(vendor.authScheme) === normalize(seed.authScheme)
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
    const hostname = seedHostname(seed);
    // 回环种子不参与别名（见上）。
    return hostname === null || isLocalSeed(seed) ? [] : [[hostname, seed.key] as const];
  }),
);

function seedHostname(seed: VendorSeed): string | null {
  if (!/^https?:\/\//i.test(seed.baseUrl)) return null;
  try {
    return new URL(seed.baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** 种子地址就在这台机器上：回环（ComfyUI 127.0.0.1:8188）或不走网络的 `local://`（Codex、本地语音）。 */
export function isLocalSeed(seed: VendorSeed): boolean {
  const hostname = seedHostname(seed);
  return /^local:\/\//i.test(seed.baseUrl) || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

/** 该 hostname 是否是我们内置认得的供应商；是则返回内置 vendorKey，否则 null。 */
export function builtinVendorKeyForHostname(hostname: string): string | null {
  return HOST_TO_BUILTIN_VENDOR_KEY.get(String(hostname || "").trim().toLowerCase()) ?? null;
}
