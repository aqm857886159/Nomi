import { hostRootBase, hostRootJoin } from "../ai/requestPipeline";
import { appFetch } from "../appFetch";

// ---------------------------------------------------------------------------
// 「这家中转有没有某个原生端点」探测。零成本：只发 GET、不建任务、不计费，连有效 key 都不需要。
//
// 判据是 **derive 出来的，不是 hardcode 的**：各家网关对「查无此路由」的回答千差万别
//   - new-api：404 + {"error":{"message":"Invalid URL (GET /x)","type":"invalid_request_error"}}
//   - 别家可能：404 HTML / 405 / 502 / 200 SPA 首页（!）
// 所以先打一条**必然不存在**的哨兵路径，学到这家的「查无此路由签名」，再打目标路径比对：
//   签名相同 → 端点不存在；签名不同（401 鉴权 / 200 / 404-任务不存在…）→ 端点存在。
// 这样换一家网关照样成立，不用为每家写 if。
// ---------------------------------------------------------------------------

/** 响应签名：状态码 + 归一化后的响应体轮廓。够区分「查无此路由」与「路由在但拒了你」。 */
type ResponseSignature = { status: number; shape: string };

const PROBE_TIMEOUT_MS = 8_000;
/** 显眼到不可能与真实路由撞名。 */
const SENTINEL_SEGMENT = "__nomi_route_probe__";
const BOGUS_ID = "__nomi_probe__";

/**
 * 哨兵 = 目标的**同级兄弟路径**（替换最后一段），不是随便一条顶层假路径。
 * 这条至关重要：new-api / one-api 的后台是 SPA，**顶层**未知路径会被 200 + index.html 接走，
 * 拿它当哨兵就会学到「查无此路由 = 200 网页」这个错签名，于是任何真 404/401 都显得"不一样"
 * → 全判成端点存在（实测踩到）。同级兄弟才走同一套路由/中间件，比较才成立。
 */
function siblingSentinelPath(probePath: string): string {
  const clean = probePath.replace(/\/+$/, "");
  const cut = clean.lastIndexOf("/");
  return cut <= 0 ? `/${SENTINEL_SEGMENT}` : `${clean.slice(0, cut)}/${SENTINEL_SEGMENT}`;
}

/**
 * 把响应体归一成「轮廓」：只留结构与稳定措辞，抹掉每次都变的东西（request id、路径回显、
 * 时间戳、数字）。否则 new-api 把请求路径回显进 message，两次探测的 message 必然不同 → 误判。
 */
function bodyShape(text: string): string {
  return text
    .slice(0, 400)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\/[a-z0-9_\-/.]*/g, "<path>") // 路径回显（Invalid URL (GET /x) 里的 /x）
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

async function probeOnce(url: string, headers: Record<string, string>): Promise<ResponseSignature | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await appFetch(url, { method: "GET", headers, signal: controller.signal });
    const text = await res.text().catch(() => "");
    return { status: res.status, shape: bodyShape(text) };
  } catch {
    return null; // 网络层失败：探不出结论，按「不存在」保守处理（调用方决定）
  } finally {
    clearTimeout(timer);
  }
}

export type NativeEndpointProbeResult = {
  /** true = 这家确实提供该端点。 */
  exists: boolean;
  /** 探测过程说明（落日志/给用户看，不编造）。 */
  detail: string;
};

/**
 * 探一个原生端点在不在。
 * @param baseUrl 用户填的接入地址（可能带 /v1；原生路径从主机根拼，这里自己剥）
 * @param probePath 目标端点路径（如 /api/v3/contents/generations/tasks）
 * @param apiKey 有就带上（带了更准：真 key 下路由存在通常回 404-任务不存在而非 401）
 */
export async function probeNativeEndpoint(
  baseUrl: string,
  probePath: string,
  apiKey?: string,
): Promise<NativeEndpointProbeResult> {
  if (!/^https?:\/\//i.test(hostRootBase(baseUrl))) {
    return { exists: false, detail: "接入地址不是 http(s)，跳过原生端点探测" };
  }
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  // 探测 URL 必须与真正发送时**同一套拼接**（hostRootJoin），否则探针探的是另一个地址：
  // 曾经这里直接 `${hostRootBase(base)}${probePath}` 拼，遇到 baseUrl 带 /api/v3 就拼出 /api/api/v3/…，
  // 与哨兵同样 404 → 恒判「这家没有原生端点」，原生报文全线失联。
  // 哨兵与目标同深度、同父路径 → 走同一套路由/中间件，签名可比。
  const sentinel = await probeOnce(hostRootJoin(baseUrl, `${siblingSentinelPath(probePath)}/${BOGUS_ID}`), headers);
  if (!sentinel) return { exists: false, detail: "探测请求失败（网络或超时），按不支持处理" };
  const target = await probeOnce(hostRootJoin(baseUrl, `${probePath}/${BOGUS_ID}`), headers);
  if (!target) return { exists: false, detail: "探测请求失败（网络或超时），按不支持处理" };
  const same = target.status === sentinel.status && target.shape === sentinel.shape;
  return same
    ? { exists: false, detail: `这家没有 ${probePath}（响应与「查无此路由」完全一致：HTTP ${target.status}）` }
    : { exists: true, detail: `这家提供 ${probePath}（HTTP ${target.status}，区别于查无此路由的 ${sentinel.status}）` };
}
