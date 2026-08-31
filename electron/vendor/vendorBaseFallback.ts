/**
 * Vendor 官方候选域自愈（治「主域被墙 = 变现主通道全断」，2026-07-29 群反馈实锤）。
 *
 * 病根：策展 vendor 的 base URL 编译进包（如 apimart 的 https://api.apimart.ai），该域在
 * 大陆被墙后，无梯子用户所有请求 connect 超时——「画布第一个 api 不能用了」。APIMart 官方
 * 公告过国内直连备用域（X @APIMart_：apib.ai / aiuxu.com / aishuch.com，2026-07-29 逐一实测
 * 0.1s 通、错误体为 apimart 网关形状、apib.ai 首页即 APIMart 官网）。
 *
 * 机制（单点，覆盖生成/轮询/上传全部出站——它们都从这里过或调 rewriteVendorUrl）：
 *  1. 请求在「连接从未建立」层失败（SAFE_RETRY 码）→ 触发零额度探测梯子：按序 GET
 *     {候选域}/v1/models（无鉴权，5s 超时），任何 HTTP 响应 + 响应体带 family 特征串才算数
 *     （防 captive portal / 错站冒充；无鉴权必 401，不花一分钱）。
 *  2. 命中即记 override（内存 + 落盘），后续请求经 rewriteVendorUrl 换 origin 直达。
 *  3. 重试安全性：只有 SAFE_RETRY 码（DNS 失败/连接拒绝/连接超时——TCP 从未建立，请求从未
 *     离开本机）才允许调用方换线重发一次；响应阶段超时/HTTP 错误一律不重试——严守
 *     「重试绝不包住付费提交」铁律（连接未建立 ⇒ 不可能已计费）。
 *  4. 主域恢复自动回切：启动后若有 override，延迟后台探测主域，健康则清除（回归канonical）。
 *
 * 不 import electron（可在纯 Node 单测直接导入）；落盘路径由 main.ts 启动时注入。
 */
import fs from "node:fs";
import path from "node:path";

type VendorBaseFamily = {
  vendorKey: string;
  primary: string;
  /** 官方公告的备用域（顺序即优先级）。 */
  alternates: string[];
  /** 响应体特征串——网关错误体/首页必含，防捕获门户与错站。 */
  marker: RegExp;
};

const FAMILIES: VendorBaseFamily[] = [
  {
    vendorKey: "apimart",
    primary: "https://api.apimart.ai",
    alternates: ["https://api.apib.ai", "https://api.aiuxu.com", "https://api.aishuch.com"],
    marker: /apimart/i,
  },
];

/** 连接从未建立的错误码全集（可安全重发，含付费 POST）。 */
const SAFE_RETRY_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const PROBE_TIMEOUT_MS = 5_000;
const STATE_VERSION = 1;

let stateFilePath: string | null = null;
let overrides: Record<string, string> = {};
let ladderInFlight: Promise<void> | null = null;

function familyOfOrigin(origin: string): VendorBaseFamily | null {
  return (
    FAMILIES.find(
      (f) => normalizeOrigin(f.primary) === origin || f.alternates.some((a) => normalizeOrigin(a) === origin),
    ) ?? null
  );
}

function normalizeOrigin(url: string): string {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return "";
  }
}

/** 沿 cause 链 + AggregateError.errors（happy-eyeballs 双栈失败的形态）收集错误码。 */
function collectErrorCodes(error: unknown, depth = 0): string[] {
  if (depth > 5 || !error || typeof error !== "object") return [];
  const codes: string[] = [];
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") codes.push(code);
  const aggregate = (error as { errors?: unknown }).errors;
  if (Array.isArray(aggregate)) for (const item of aggregate) codes.push(...collectErrorCodes(item, depth + 1));
  codes.push(...collectErrorCodes((error as { cause?: unknown }).cause, depth + 1));
  return codes;
}

/** 连接从未建立（请求从未离开本机）→ 换线重发对任何方法都安全。 */
export function isConnectPhaseError(error: unknown): boolean {
  return collectErrorCodes(error).some((code) => SAFE_RETRY_CODES.has(code));
}

function persist(): void {
  if (!stateFilePath) return;
  try {
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(stateFilePath, JSON.stringify({ version: STATE_VERSION, overrides }, null, 2), "utf8");
  } catch (error) {
    console.error("[nomi:vendor-base] 持久化 override 失败（忽略，内存态仍生效）:", error);
  }
}

function loadPersisted(): void {
  if (!stateFilePath) return;
  try {
    const raw = JSON.parse(fs.readFileSync(stateFilePath, "utf8")) as { overrides?: Record<string, unknown> };
    const loaded: Record<string, string> = {};
    for (const [vendorKey, base] of Object.entries(raw.overrides ?? {})) {
      const family = FAMILIES.find((f) => f.vendorKey === vendorKey);
      // 只接受本 family 名单内的域——落盘文件被手改成任意站也不会把 key 发过去。
      if (family && typeof base === "string" && familyOfOrigin(normalizeOrigin(base)) === family) {
        loaded[vendorKey] = normalizeOrigin(base);
      }
    }
    overrides = loaded;
  } catch {
    overrides = {};
  }
}

/**
 * 启动注入：落盘路径 + 加载既有 override + （若有 override）延迟后台探测主域自动回切。
 */
export function configureVendorBaseFallback(filePath: string, opts: { restoreDelayMs?: number } = {}): void {
  stateFilePath = filePath;
  loadPersisted();
  if (Object.keys(overrides).length === 0) return;
  const timer = setTimeout(() => {
    for (const vendorKey of Object.keys(overrides)) void restorePrimaryIfHealthy(vendorKey);
  }, opts.restoreDelayMs ?? 12_000);
  (timer as { unref?: () => void }).unref?.();
}

/** override 生效时把 family 内任意 origin 的 URL 换到 override origin；其余 URL 原样返回。 */
export function rewriteVendorUrl(url: string): string {
  const origin = normalizeOrigin(url);
  if (!origin) return url;
  const family = familyOfOrigin(origin);
  const target = family ? overrides[family.vendorKey] : undefined;
  if (!family || !target || target === origin) return url;
  const parsed = new URL(url);
  const targetUrl = new URL(target);
  parsed.protocol = targetUrl.protocol;
  parsed.host = targetUrl.host;
  return parsed.toString();
}

async function probeCandidate(base: string, marker: RegExp): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // 无鉴权 GET /v1/models：可达则任何网关都会回（apimart 回 401 + apimart_error 体），零费用。
    const response = await fetch(`${base}/v1/models`, { method: "GET", signal: controller.signal });
    const text = await response.text();
    return marker.test(text);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function runLadder(family: VendorBaseFamily, failedOrigin: string): Promise<void> {
  const candidates = [family.primary, ...family.alternates]
    .map(normalizeOrigin)
    .filter((origin) => origin && origin !== failedOrigin); // 刚失败的不用再试这一轮
  for (const candidate of candidates) {
    if (await probeCandidate(candidate, family.marker)) {
      if (candidate === normalizeOrigin(family.primary)) {
        delete overrides[family.vendorKey];
        console.log(`[nomi:vendor-base] ${family.vendorKey} 主域可达，清除 override`);
      } else {
        overrides[family.vendorKey] = candidate;
        console.log(`[nomi:vendor-base] ${family.vendorKey} 主域不可达，已切官方备用域 ${candidate}`);
      }
      persist();
      return;
    }
  }
  console.log(`[nomi:vendor-base] ${family.vendorKey} 全部候选域不可达，维持现状`);
}

/**
 * 连接层失败后的自愈入口。返回 true = 该 family 现在映射到与刚失败 origin 不同的 base，
 * 调用方可安全重发一次；false = 不换线（非 family / 非连接层错误 / 探测全挂）。
 * 单飞：并发失败共享同一轮探测。
 */
export async function maybeResolveVendorBase(url: string, error: unknown): Promise<boolean> {
  const origin = normalizeOrigin(url);
  const family = familyOfOrigin(origin);
  if (!family || !isConnectPhaseError(error)) return false;
  if (!ladderInFlight) {
    ladderInFlight = runLadder(family, origin).finally(() => {
      ladderInFlight = null;
    });
  }
  await ladderInFlight;
  const target = overrides[family.vendorKey] ?? normalizeOrigin(family.primary);
  return target !== origin;
}

/** 主域恢复即回切（清 override）。启动后台调；亦可供测试直调。 */
export async function restorePrimaryIfHealthy(vendorKey: string): Promise<void> {
  const family = FAMILIES.find((f) => f.vendorKey === vendorKey);
  if (!family || !overrides[vendorKey]) return;
  if (await probeCandidate(normalizeOrigin(family.primary), family.marker)) {
    delete overrides[vendorKey];
    persist();
    console.log(`[nomi:vendor-base] ${vendorKey} 主域已恢复，回切主域`);
  }
}

/**
 * 带自愈的 vendor fetch：正常路径零开销（rewrite 未生效即原 URL）；连接层失败且梯子给出
 * 新 base 时重发一次。仅 SAFE_RETRY 码走到重发（见文件头 3），付费提交同样安全。
 */
export async function fetchVendorWithBaseFallback(url: string, init: RequestInit): Promise<Response> {
  const first = rewriteVendorUrl(url);
  try {
    return await fetch(first, init);
  } catch (error) {
    if (!(await maybeResolveVendorBase(first, error))) throw error;
    const second = rewriteVendorUrl(url);
    if (second === first) throw error;
    return await fetch(second, init);
  }
}

/** 当前生效的 override（无则 null）——供诊断/后续管理卡展示线路。 */
export function activeVendorBaseOverride(vendorKey: string): string | null {
  return overrides[vendorKey] ?? null;
}

/** 测试钩子：清空模块态（与 systemProxy 的 reset 习惯一致）。 */
export function resetVendorBaseFallbackForTests(): void {
  stateFilePath = null;
  overrides = {};
  ladderInFlight = null;
}
