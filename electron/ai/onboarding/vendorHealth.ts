/**
 * 供应商连接健康：打开模型面板时自动检查「这家现在能不能用」。
 *
 * 为什么在主进程（硬约束）：自动检查时 renderer 手上只有 `hasApiKey` 布尔，明文 key 在
 * `apiKeysByVendor` 里加密存着。只有主进程能自取凭证，所以探测整体挪到这一层——
 * renderer 不再各自持有「刚输入的 key」才能测（那正是旧实现只在解锁那一刻能测的原因）。
 *
 * 为什么没有「哪家支持探测」的白名单（derive 不 hardcode）：旧实现靠
 * `knownVendors.connectionTest === 'models'` 人工点名 3 家，其余显示「暂不支持自动测试」——
 * 新增一家就要记得加一笔，漏了就是死路。现在改成**从探测结果本身 derive**：
 *   - 2xx 且解析得出模型列表        → reachable（地址和 key 都对）
 *   - 任一候选回 401/403            → unreachable（凭证不对——最有价值的信号）
 *   - 候选全回 404/405              → unsupported（这家压根没有 /models 端点，不能据此说「连不上」）
 *   - fetch 抛错 / 超时 / 其它       → unreachable（真连不上，含代理问题）
 * 代价是对「本就没有 /models」的家每轮多发一个必然 404 的请求：零额度（就是 GET /models）、
 * 有缓存、无害。换来的是新增供应商零维护（P4 通用第一）。
 */
import { createHash } from "node:crypto";
import type { AiSdkProviderKind } from "../../catalog/types";
import { readCatalog, normalizeProviderKind } from "../../catalog/catalogStore";
import { decryptApiKeyRecord } from "../../catalog/secrets";
import { isJsonRecord, mergeHeadersCaseInsensitive } from "../../jsonUtils";
import { authHeaders, authQueryParams } from "../requestPipeline";
import { fetchModelList, readExtraHeaders, type ModelListFailureKind } from "./modelListProbe";
import { modelListErrorRedactor } from "./modelListSafety";

export type VendorHealthState = "reachable" | "unreachable" | "unsupported";

export type VendorHealth = {
  vendorKey: string;
  state: VendorHealthState;
  /** 非 reachable 时的人话原因（上游那句话 / 网络错描述）；reachable 时省略。 */
  reason?: string;
  /** 探测完成时刻（epoch ms）。renderer 只用来显示「几分钟前检查过」，不做判断。 */
  checkedAt: number;
};

/** 探测超时，与接入向导「测试连接」同口径。 */
const PROBE_TIMEOUT_MS = 12_000;
/** 结果新鲜期：期内重复打开面板直接命中缓存，不再打上游。 */
const TTL_MS = 10 * 60_000;

type Entry = {
  /** 凭证/地址/协议的指纹——任一变化即缓存失效（不碰明文 key，用 key 记录的 updatedAt 代表）。 */
  fingerprint: string;
  result?: VendorHealth;
  inflight?: Promise<VendorHealth>;
};

const cache = new Map<string, Entry>();

/** 测试用：清空缓存。 */
export function resetVendorHealthCache(): void {
  cache.clear();
}

type Target = {
  baseUrl: string;
  providerKind: AiSdkProviderKind;
  headers: Record<string, string>;
  query: Record<string, string>;
  proxyUrl?: string;
  fingerprint: string;
};

/**
 * 取这家的探测目标；返回 null = **不该发请求**（无 key / 本地后端 / 没填地址）。
 * 这也是 derive 而非名单：本地后端（comfyui-local、codex-local）authType 恒为 none 且各有专属卡。
 */
function resolveTarget(vendorKey: string): Target | null {
  const state = readCatalog();
  const vendor = state.vendors.find((v) => v.key === vendorKey);
  if (!vendor) return null;
  if (vendor.authType === "none") return null;
  // hasApiKey 由 readCatalog 统一算（存在 + 未禁用），别在这儿另立一套判据。
  if (!vendor.hasApiKey) return null;
  const baseUrl = String(vendor.baseUrlHint || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) return null;
  const record = state.apiKeysByVendor[vendorKey];
  const apiKey = decryptApiKeyRecord(record) || "";
  if (!apiKey) return null;
  const providerKind = normalizeProviderKind(vendor.providerKind);
  const authType = vendor.authType || (providerKind === "anthropic" ? "x-api-key" : "bearer");
  const headers = mergeHeadersCaseInsensitive(
    providerKind === "anthropic" ? { "anthropic-version": "2023-06-01" } : {},
    authHeaders(authType, apiKey, vendor.authHeader ?? undefined),
    readExtraHeaders(isJsonRecord(vendor.meta) ? vendor.meta.extraHeaders : undefined),
  );
  const query = authQueryParams(authType, apiKey, vendor.authQueryParam ?? undefined);
  return {
    baseUrl,
    providerKind,
    headers,
    query,
    ...(vendor.network?.proxyUrl ? { proxyUrl: vendor.network.proxyUrl } : {}),
    fingerprint: createHash("sha256").update(JSON.stringify({
      baseUrl, updatedAt: record?.updatedAt, providerKind, authType, proxyUrl: vendor.network?.proxyUrl || null,
      authHeader: vendor.authHeader, authQueryParam: vendor.authQueryParam, headers, query,
    })).digest("hex"),
  };
}

/** 探测结果 → 四态判定。抽成纯函数，好让单测直接钉住这张映射表。 */
export function classifyProbe(
  vendorKey: string,
  probe: { ok: boolean; error?: string; statuses: number[]; failureKind?: ModelListFailureKind },
  checkedAt: number,
): VendorHealth {
  if (probe.ok) return { vendorKey, state: "reachable", checkedAt };
  // The shared probe includes business and network failures that HTTP statuses alone cannot show.
  // A non-list response cannot establish whether the provider's generation API works.
  if (probe.failureKind === "unsupported" || probe.failureKind === "invalid_response") {
    return { vendorKey, state: "unsupported", checkedAt };
  }
  return { vendorKey, state: "unreachable", reason: probe.error, checkedAt };
}

async function probe(vendorKey: string, target: Target): Promise<VendorHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetchModelList(target.providerKind, target.baseUrl, target.headers, controller.signal, {
      query: target.query,
      ...(target.proxyUrl ? { proxyUrl: target.proxyUrl } : {}),
    });
    return classifyProbe(
      vendorKey,
      { ok: res.ok, error: res.ok ? undefined : res.error, statuses: res.statuses, failureKind: res.ok ? undefined : res.failureKind },
      Date.now(),
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 检查一家的连接健康。命中新鲜缓存直接返回；同一家的并发请求共用一个 in-flight（去重）。
 * `force` = 用户点了「重新检查」，跳过缓存但仍与 in-flight 合流。
 */
export async function checkVendorHealth(vendorKey: string, force = false): Promise<VendorHealth> {
  const target = resolveTarget(vendorKey);
  const now = Date.now();
  if (!target) {
    // 没 key / 本地后端 / 没地址：不发请求，如实说「没法预检」。
    return { vendorKey, state: "unsupported", checkedAt: now };
  }
  const entry = cache.get(vendorKey);
  if (entry && entry.fingerprint === target.fingerprint) {
    if (entry.inflight) return entry.inflight;
    if (!force && entry.result && now - entry.result.checkedAt < TTL_MS) return entry.result;
  }
  const inflight = probe(vendorKey, target)
    .catch((e): VendorHealth => ({
      vendorKey,
      state: "unreachable",
      reason: modelListErrorRedactor(target.baseUrl, target.headers, target.query)(e instanceof Error ? e.message : String(e)),
      checkedAt: Date.now(),
    }))
    .then((result) => {
      const current = cache.get(vendorKey);
      // 探测期间用户又改了 key/地址 → 这次结果已过时，丢弃不写缓存（避免旧结论盖住新配置）。
      if (current?.fingerprint === target.fingerprint) {
        cache.set(vendorKey, { fingerprint: target.fingerprint, result });
      }
      return result;
    });
  cache.set(vendorKey, { fingerprint: target.fingerprint, result: entry?.result, inflight });
  return inflight;
}
