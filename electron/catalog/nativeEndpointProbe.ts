import { hostRootBase, hostRootJoin } from "../ai/requestPipeline";
import { appFetch } from "../appFetch";

// ---------------------------------------------------------------------------
// 「这家中转能不能按某个原生合同查任务」探测。零成本：只发 GET、不建任务、不计费。
//
// 两步，缺一不可：
//   ① 先打一条**必然不存在**的同级哨兵路径，学到这家的「查无此路由签名」；目标签名与它相同 → 没这条路由。
//   ② 签名不同**还不够**（#1213）：那只证明「回了点不一样的东西」。中转对不带 model 的 GET 回 503「无可用
//      渠道」、对坏 key 回 401、网关自己的通用错误——都和哨兵不一样，却恰恰说明**真查任务也会这样失败**。
//      旧判据把它们一律当「端点存在」，开机就把用户能用的通道静默切成原生报文：提交照扣钱、查询永远失败。
//      所以目标路径对假任务号的回答，必须是**该原生合同自己的「任务不存在」回答**（由档案声明，见
//      nativeWireProfiles 的 probeEvidence）——这才是「这条路由会按原生合同回答查询」的证据。
// ---------------------------------------------------------------------------

/** 一次 GET 的回答：状态码 + 归一化轮廓（比哨兵用）+ 解析出的 JSON（判合同证据用）。 */
export type ProbeAnswer = { status: number; shape: string; json: unknown };

/** 原生合同对「假任务号」的回答长什么样——由原生档案声明（nativeWireProfiles.probeEvidence）。 */
export type ProbeContractEvidence = (answer: Pick<ProbeAnswer, "status" | "json">) => boolean;

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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function probeOnce(url: string, headers: Record<string, string>): Promise<ProbeAnswer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await appFetch(url, { method: "GET", headers, signal: controller.signal });
    const text = await res.text().catch(() => "");
    return { status: res.status, shape: bodyShape(text), json: parseJson(text) };
  } catch {
    return null; // 网络层失败：探不出结论（调用方据 verdict 决定，不据此改任何通道）
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 探测结论。三态必须分开：「探不到」不是「没有」——网络抖一下就把用户的通道降级，同样是静默改坏。
 * - `contract`：路由在，且对假任务号给出了原生合同自己的回答 → 可以按原生合同查任务。
 * - `no-contract`：路由不存在，或回答不是原生合同的回答（503 无可用渠道 / 401 / 网关通用错误…）。
 * - `unreachable`：网络失败 / 超时 / 地址不是 http(s)，没有结论。
 */
export type NativeEndpointVerdict = "contract" | "no-contract" | "unreachable";

export type NativeEndpointProbeResult = {
  /** true = 这家能按原生合同回答任务查询（= verdict === "contract"）。 */
  exists: boolean;
  verdict: NativeEndpointVerdict;
  /** 探测过程说明（落日志/给用户看，不编造）。 */
  detail: string;
};

/**
 * 探一个原生查询端点能不能按原生合同回答。
 * @param baseUrl 用户填的接入地址（可能带 /v1；原生路径从主机根拼，这里自己剥）
 * @param probePath 目标端点路径（如 /api/v3/contents/generations/tasks）
 * @param evidence 原生合同对假任务号的回答长什么样（档案声明）
 * @param apiKey 有就带上（真 key 下，原生合同才会回「任务不存在」而不是 401）
 */
export async function probeNativeEndpoint(
  baseUrl: string,
  probePath: string,
  evidence: ProbeContractEvidence,
  apiKey?: string,
): Promise<NativeEndpointProbeResult> {
  if (!/^https?:\/\//i.test(hostRootBase(baseUrl))) {
    return { exists: false, verdict: "unreachable", detail: "接入地址不是 http(s)，跳过原生端点探测" };
  }
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  // 探测 URL 必须与真正发送时**同一套拼接**（hostRootJoin），否则探针探的是另一个地址：
  // 曾经这里直接 `${hostRootBase(base)}${probePath}` 拼，遇到 baseUrl 带 /api/v3 就拼出 /api/api/v3/…，
  // 与哨兵同样 404 → 恒判「这家没有原生端点」，原生报文全线失联。
  // 哨兵与目标同深度、同父路径 → 走同一套路由/中间件，签名可比。
  const sentinel = await probeOnce(hostRootJoin(baseUrl, `${siblingSentinelPath(probePath)}/${BOGUS_ID}`), headers);
  if (!sentinel) return { exists: false, verdict: "unreachable", detail: "探测请求失败（网络或超时），没有结论" };
  const target = await probeOnce(hostRootJoin(baseUrl, `${probePath}/${BOGUS_ID}`), headers);
  if (!target) return { exists: false, verdict: "unreachable", detail: "探测请求失败（网络或超时），没有结论" };
  if (target.status === sentinel.status && target.shape === sentinel.shape) {
    return { exists: false, verdict: "no-contract", detail: `这家没有 ${probePath}（响应与「查无此路由」完全一致：HTTP ${target.status}）` };
  }
  if (!evidence(target)) {
    return {
      exists: false,
      verdict: "no-contract",
      // detail 只进日志（用户看不到），英文即可，不占界面文案的 i18n 名额。
      detail: `${probePath} answered a bogus task id with HTTP ${target.status}, which is not the native contract's own task-not-found answer; real task queries would fail the same way`,
    };
  }
  return { exists: true, verdict: "contract", detail: `${probePath} answers in the native contract (bogus task id -> HTTP ${target.status} native error envelope)` };
}
