// TikHub 双域名全球化 —— 候选域 + 实测选路（赛跑）+ sticky + 失败自动切换。
//
// 为什么存在（用户实战研究事实）：TikHub 官方两域——api.tikhub.io（主）与 api.tikhub.dev
// （大陆加速，主域在大陆被墙）。全球化 = 让所有人都好用、按最优线路**自动**选，而不是按语言猜。
// 机制（编排定稿）：
//   1) 候选域清单进 connector，allowedOrigins 覆盖两者；
//   2) 连接时对两域各发一次**免费健康探测**（/api/v1/health/check，无鉴权、不计费），谁先健康用谁；
//   3) 结果 sticky 存 connector 偏好层，后续直接用；主选域失败→自动换备域重试一次并更新 sticky；
//   4) locale 只影响**探测顺序**（zh 系先探 .dev），绝不决定结果；
//   5) 高级设置可手动锁定线路（auto=默认 / 强制 .io / 强制 .dev）。
//
// R5 对账（一手 api.tikhub.io/openapi.json，V5.3.2，checkedAt 2026-09-01）：
//   · 健康端点 GET /api/v1/health/check —— liveness probe，无鉴权、无计费依赖，返回 {"status":"ok"}。
//   · .dev 域 spec 明写「🇨🇳 大陆用户请使用 https://api.tikhub.dev（无需代理，直接可用）」。
import { hardenedFetch } from "../hardenedFetch";
import { getDesktopLocale } from "../desktopLocale";
import { isJsonRecord, trim } from "../jsonUtils";
import { TIKHUB_ROUTE_MODES, type TikhubRouteMode } from "../shared/contracts/tikhubRoute";
import { readConnectorPrefs, writeConnectorPrefs } from "./connectorPrefsStore";
import { TIKHUB_CONNECTOR_ID, TIKHUB_HOST_PRIMARY, TIKHUB_HOST_ACCELERATED, TIKHUB_HOSTS } from "./tikhubHosts";

// 手动线路模式的单一 owner 在中立契约层（跨进程共用）；这里只 re-export 给同目录消费者。
export { TIKHUB_ROUTE_MODES, type TikhubRouteMode };

/** 免费健康探测路径（无鉴权、不计费；见文件头 R5 对账）。 */
const HEALTH_PATH = "/api/v1/health/check";
/** 探测超时：健康请求要快；慢/挂当作不可达，别拖住连接体验。 */
const PROBE_TIMEOUT_MS = 6_000;

/** connector 偏好里存线路的键。 */
const PREF_KEY_MODE = "routeMode";
const PREF_KEY_STICKY = "stickyHost";

function hostForForcedMode(mode: TikhubRouteMode): string | null {
  if (mode === "io") return TIKHUB_HOST_PRIMARY;
  if (mode === "dev") return TIKHUB_HOST_ACCELERATED;
  return null;
}

/** 归一存盘的 mode（脏值/缺失回落 auto）。 */
function normalizeMode(value: unknown): TikhubRouteMode {
  const raw = trim(value);
  return (TIKHUB_ROUTE_MODES as readonly string[]).includes(raw) ? (raw as TikhubRouteMode) : "auto";
}

/** 归一存盘的 stickyHost（只认候选域之一，否则视作无 sticky）。 */
function normalizeStickyHost(value: unknown): string | null {
  const raw = trim(value);
  return (TIKHUB_HOSTS as readonly string[]).includes(raw) ? raw : null;
}

/** 读当前线路偏好（mode + sticky）。 */
export function readTikhubRoutePrefs(): { mode: TikhubRouteMode; stickyHost: string | null } {
  const prefs = readConnectorPrefs(TIKHUB_CONNECTOR_ID);
  return { mode: normalizeMode(prefs[PREF_KEY_MODE]), stickyHost: normalizeStickyHost(prefs[PREF_KEY_STICKY]) };
}

/**
 * locale 感知的候选域排序（**只影响探测顺序，不决定结果**）：中文系统先探加速域 .dev，
 * 其它先探主域 .io。返回去重后的完整候选序列（两域都在，只是顺序不同）。
 */
export function orderedCandidateHosts(locale = getDesktopLocale()): string[] {
  const preferDev = locale === "zh-CN";
  const head = preferDev ? TIKHUB_HOST_ACCELERATED : TIKHUB_HOST_PRIMARY;
  return [head, ...TIKHUB_HOSTS.filter((h) => h !== head)];
}

export type TikhubRouteDeps = {
  /** 探测器（默认真实健康探测）。测试注入。 */
  probe?: (host: string) => Promise<boolean>;
  /** 当前 locale（默认 getDesktopLocale）。测试注入。 */
  locale?: () => "zh-CN" | "en";
};

/**
 * 对单个候选域发一次免费健康探测：GET https://{host}/api/v1/health/check，无鉴权、禁重定向出域、
 * 短超时。2xx 且信封 status==='ok'（或至少 2xx）判健康。任何异常/非 2xx = 不可达（吞掉，返回 false）。
 */
export async function probeTikhubHost(host: string): Promise<boolean> {
  const target = `https://${host}${HEALTH_PATH}`;
  try {
    const res = await hardenedFetch(target, {
      method: "GET",
      headers: { Accept: "application/json" },
      allowRedirect: false,
      maxBytes: 64 * 1024,
      timeoutMs: PROBE_TIMEOUT_MS,
      throwOnNon2xx: false,
    });
    if (res.status < 200 || res.status >= 300) return false;
    // 信封 status 若存在，认 'ok'；解析不出但 http 2xx 也算通（liveness 已成立）。
    try {
      const body = JSON.parse(res.bytes.toString("utf8"));
      if (isJsonRecord(body) && typeof body.status === "string") return body.status === "ok";
    } catch {
      /* 非 JSON 但 2xx：健康端点可达即视作通 */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析本次出站该用哪个 host（连接时/首次调用前调用一次）。
 *   · 手动 io/dev：直接返回该域，不探测（用户显式锁定）。
 *   · auto + 有 sticky：直接用 sticky（连接时已实测过，别每次都探）。
 *   · auto + 无 sticky：按 locale 顺序探两域，第一个健康的用它并写 sticky；
 *                        两域全不健康 → 返回 null（上层报「两域全失败」三段式）。
 */
export async function resolveTikhubHost(deps: TikhubRouteDeps = {}): Promise<string | null> {
  const probe = deps.probe ?? probeTikhubHost;
  const locale = deps.locale ? deps.locale() : getDesktopLocale();
  const { mode, stickyHost } = readTikhubRoutePrefs();

  const forced = hostForForcedMode(mode);
  if (forced) return forced;

  if (stickyHost) return stickyHost;

  for (const host of orderedCandidateHosts(locale)) {
    if (await probe(host)) {
      writeConnectorPrefs(TIKHUB_CONNECTOR_ID, { [PREF_KEY_STICKY]: host });
      return host;
    }
  }
  return null;
}

/**
 * 失败自动切换：主选 host 出站失败后，换**另一个**候选域，探测其健康度；健康则更新 sticky 并返回它。
 * 手动 io/dev 模式下不切换（用户显式锁定，切换会违背意图）——返回 null。
 * 另一域也不健康 → 返回 null（上层据此报两域全失败）。
 */
export async function failoverTikhubHost(failedHost: string, deps: TikhubRouteDeps = {}): Promise<string | null> {
  const probe = deps.probe ?? probeTikhubHost;
  const { mode } = readTikhubRoutePrefs();
  if (hostForForcedMode(mode)) return null; // 手动锁定不切换

  const alternate = TIKHUB_HOSTS.find((h) => h !== failedHost);
  if (!alternate) return null;
  if (await probe(alternate)) {
    writeConnectorPrefs(TIKHUB_CONNECTOR_ID, { [PREF_KEY_STICKY]: alternate });
    return alternate;
  }
  return null;
}

/** 存手动线路模式（用户在高级设置里切）。切到 auto 时清掉 sticky，让下次连接重新实测。 */
export function setTikhubRouteMode(mode: unknown): TikhubRouteMode {
  const next = normalizeMode(mode);
  const patch: Record<string, unknown> = { [PREF_KEY_MODE]: next };
  if (next === "auto") patch[PREF_KEY_STICKY] = undefined; // 回自动：忘掉上次结果，重新赛跑
  writeConnectorPrefs(TIKHUB_CONNECTOR_ID, patch);
  return next;
}

export type TikhubRouteStatus = {
  mode: TikhubRouteMode;
  /** 当前生效线路（auto 下 = sticky 结果；手动下 = 锁定域）。未连接过且 auto 时为空串。 */
  activeHost: string;
  hosts: readonly string[];
};

/** 线路状态（供高级设置「线路」行显示：当前 mode + 生效域 + 候选域）。永不触网。 */
export function getTikhubRouteStatus(): TikhubRouteStatus {
  const { mode, stickyHost } = readTikhubRoutePrefs();
  const forced = hostForForcedMode(mode);
  return { mode, activeHost: forced ?? stickyHost ?? "", hosts: TIKHUB_HOSTS };
}
