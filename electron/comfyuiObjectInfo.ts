// 本地 ComfyUI /object_info 能力索引（节点类清单 + combo 枚举值）。两处消费：
//   ① 导入 workflow 时对账「缺自定义节点 / 引用了本机没有的模型文件」（comfyuiWorkflowImportStore.reconcile）；
//   ② 内置文生图 ckpt_name 留空时 derive 本机第一个 checkpoint（comfyuiLocal 的 "comfyui-prompt" 请求变换）。
// 与 comfyuiProbe 同一直连纪律：全局 fetch（undici 不认系统代理 → 直连本机/局域网，不被 Clash 绕开）。
// 形状实查 ComfyUI server.py：/object_info 返回 { <class_type>: { input: { required/optional: { <key>: [spec, opts?] } } } }，
// combo 输入的 spec 是字符串数组（如 checkpoints 文件名列表）；/object_info/{class} 只返回该类同构子集。
import { comfyuiEndpoint, normalizeComfyuiBaseUrl } from "./comfyui/endpointResolver";
import { appFetch } from "./appFetch";

export type ComfyObjectInfoIndex = {
  /** 本机已装的全部节点 class_type。 */
  classNames: Set<string>;
  /** class_type → (inputKey → combo 可选值)。只收「字符串数组」spec（文件名/采样器这类枚举）。 */
  enumsByClass: Map<string, Map<string, string[]>>;
};

function isRec(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 单个 combo 选项列表上限（防某些索引型自定义节点带百万级列表撑爆内存）。超限当「无枚举」跳过。 */
const MAX_ENUM_OPTIONS = 20_000;

/** 纯解析（可单测）：/object_info 全量或 /object_info/{class} 子集 → 能力索引。任何异形都跳过、不抛。 */
export function parseObjectInfoIndex(json: unknown): ComfyObjectInfoIndex {
  const classNames = new Set<string>();
  const enumsByClass = new Map<string, Map<string, string[]>>();
  if (!isRec(json)) return { classNames, enumsByClass };
  for (const [classType, def] of Object.entries(json)) {
    if (!isRec(def)) continue;
    classNames.add(classType);
    const input = isRec(def.input) ? def.input : {};
    const enums = new Map<string, string[]>();
    for (const group of [input.required, input.optional]) {
      if (!isRec(group)) continue;
      for (const [inputKey, spec] of Object.entries(group)) {
        // combo spec = [options[], config?]；options 必须是纯字符串数组才算枚举。
        // ⚠️ **空数组也是枚举**（= 这是个 combo，只是本机一个文件都没装）——真服务器实测：
        // 空 models 目录下 CheckpointLoaderSimple.ckpt_name 就是 []。早先把它当「不是枚举」跳过，
        // 导致「一个模型都没装」这个最常见首跑场景下缺件对账**整个沉默**，恰在最该报警时失灵。
        // 下游各自把关：缺件对账要它（任何值都不在空列表里 → 如实全报缺）；combo 下拉烤入侧
        // 已判 options.length > 0，不会烤出空下拉。
        const options = Array.isArray(spec) ? spec[0] : undefined;
        if (!Array.isArray(options) || options.length > MAX_ENUM_OPTIONS) continue;
        if (!options.every((o) => typeof o === "string")) continue;
        enums.set(inputKey, options as string[]);
      }
    }
    if (enums.size > 0) enumsByClass.set(classType, enums);
  }
  return { classNames, enumsByClass };
}

function normalizeBase(baseUrl: string): string {
  return normalizeComfyuiBaseUrl(baseUrl);
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const res = await appFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // 连不上/超时/非 JSON —— 调用方按「无法核对」处理（不阻断导入/提交）。
  }
}

// 60s TTL 缓存（按 URL）：一次导入面板里的多次分析 / 一批提交共享，不反复拉几 MB 的全量 object_info。
const cache = new Map<string, { at: number; value: ComfyObjectInfoIndex }>();
/** 同一个 ComfyUI origin 的并发读取共享一条网络请求，避免设置页批量加载时击穿缓存。 */
const inFlight = new Map<string, Promise<ComfyObjectInfoIndex | null>>();
const CACHE_TTL_MS = 60_000;

function cached(url: string): ComfyObjectInfoIndex | null {
  const hit = cache.get(url);
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.value : null;
}

export function _resetComfyObjectInfoCacheForTest(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * 按 baseUrl 爆缓存。用户动作驱动的对账（导入分析 / 预置模板「重新检测」）必须拿新鲜事实——
 * 用户刚把模型放进目录、点重检还看到 60s 前的「缺」是假话（走查实锤过）。提交路径的 checkpoints
 * 缓存不受影响（那边 60s 内多次提交共享一份没问题）。
 */
export function bustComfyObjectInfoCache(baseUrl: string): void {
  const prefix = normalizeBase(baseUrl);
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** 全量能力索引（导入对账用）。null = 服务器不可达/异常（调用方跳过核对，别当「没装任何节点」）。 */
export async function fetchComfyuiObjectInfoIndex(baseUrl: string): Promise<ComfyObjectInfoIndex | null> {
  const url = comfyuiEndpoint(baseUrl, "objectInfo");
  const hit = cached(url);
  if (hit) return hit;
  const pending = inFlight.get(url);
  if (pending) return pending;
  const request = (async (): Promise<ComfyObjectInfoIndex | null> => {
    const json = await fetchJson(url, 15_000); // 全量含全部自定义节点，可到几 MB —— 给足时间
    if (json === null) return null;
    const index = parseObjectInfoIndex(json);
    // 空 classNames = 形状不认识（真 ComfyUI 至少有内置节点），按不可核对处理，别误报「全缺」。
    if (index.classNames.size === 0) return null;
    cache.set(url, { at: Date.now(), value: index });
    return index;
  })();
  inFlight.set(url, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(url) === request) inFlight.delete(url);
  }
}

/** 本机已装 checkpoint 文件名（内置文生图 ckpt_name 留空时 derive 用）。null = 不可达。 */
export async function fetchComfyuiCheckpoints(baseUrl: string): Promise<string[] | null> {
  const url = comfyuiEndpoint(baseUrl, "objectInfo", "CheckpointLoaderSimple");
  const hit = cached(url);
  if (hit) return hit.enumsByClass.get("CheckpointLoaderSimple")?.get("ckpt_name") ?? [];
  const pending = inFlight.get(url);
  if (pending) {
    const index = await pending;
    return index?.enumsByClass.get("CheckpointLoaderSimple")?.get("ckpt_name") ?? (index ? [] : null);
  }
  const request = (async (): Promise<ComfyObjectInfoIndex | null> => {
    const json = await fetchJson(url, 5_000);
    if (json === null) return null;
    const index = parseObjectInfoIndex(json);
    if (index.classNames.size === 0) return null;
    cache.set(url, { at: Date.now(), value: index });
    return index;
  })();
  inFlight.set(url, request);
  try {
    const index = await request;
    return index?.enumsByClass.get("CheckpointLoaderSimple")?.get("ckpt_name") ?? (index ? [] : null);
  } finally {
    if (inFlight.get(url) === request) inFlight.delete(url);
  }
}
