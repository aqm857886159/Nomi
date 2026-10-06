/**
 * 「这次出站请求，到底有没有发出去过？」——**唯一**回答它的地方。
 *
 * 一次付费提交失败有三种性质完全不同的可能（第三种 2026-10-05 用户拍板加入，见文件尾 `providerExplicitlyRejected`）：**一个字节都没写出去**（DNS 解不出、连不上、
 * TLS 握手没完成）——供应商那边什么都没发生；
 * 或者**写出去了但结果不知道**（写完才断、响应头等超时）——可能已经收下并扣费。
 * 两者在 `fetch()` 抛出来时长得一模一样（`TypeError: fetch failed`），真相全在 `error.cause` 里。
 *
 * 判据**只许拿得出证据才说没写出去**，其余一律 `unknown`：判错成「没写出去」的代价是重复扣一次钱，
 * 反过来只是多一次人工对账。两边不对称，所以闸门偏向不重发。
 *
 * 只用在 `fetch()` **自己抛出**的那条路上（此时根本没有 Response，也就不可能收到过响应头）；
 * 读响应体读到一半失败已经收到过响应头，永远是 `unknown`。
 *
 * 由来与现场证据见 `docs/fixes/2026-09-18-submission-not-dispatched.root-cause.json`。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { requestCarriesCredentials } from "./credentialRedirectPolicy";

type ErrorLike = {
  code?: unknown;
  providerAnswer?: unknown;
  syscall?: unknown;
  cause?: unknown;
  message?: unknown;
  name?: unknown;
};

/** DNS 解析失败：连接从未建立，请求不可能写出去。 */
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

/** undici 建连阶段就超时/失败：同上。 */
const CONNECT_CODES = new Set(["UND_ERR_CONNECT_TIMEOUT", "ERR_SOCKET_CONNECTION_TIMEOUT"]);

function asErrorLike(value: unknown): ErrorLike | null {
  return value && typeof value === "object" ? (value as ErrorLike) : null;
}

/** 把 `error.cause` 链摊平（最多 5 层，防自引用成环）。 */
function causeChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  let current = asErrorLike(error);
  while (current && !chain.includes(current) && chain.length < 5) {
    chain.push(current);
    current = asErrorLike(current.cause);
  }
  return chain;
}

/** TLS 握手阶段就失败（证书不被信任、主机名对不上）：握手没完成，应用层请求一个字节都没发。 */
const TLS_HANDSHAKE_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** 对面在 TLS 握手完成前就把连接复位：同上，请求还没写。 */
const PRE_TLS_RESET = /before secure TLS connection was established|disconnected before secure TLS/i;

/**
 * 只有「连上之前」的错误才算证明没写出去：DNS、建连（connect 系统调用 / 连接超时）、TLS 握手前。
 *
 * **`UND_ERR_SOCKET` / `ECONNRESET` / `socket hang up` / 头或体超时 / 发出后 abort 一律不在这里**——
 * 它们既可能是「复用的 keep-alive 连接被对面关了」（没写出去），也可能是「请求已经写出去、
 * 响应没回来连接就被重置」（供应商可能已经收下并扣费），两者抛出来的码一模一样，判据分不开。
 * 2026-10-02 真应用复现（D:\tmp\breaker-947 E9）：APIMart 不支持幂等，旧判据把后一种当成前一种
 * 自动重发，供应商收到的张数多于用户点过的张数。「旧连接」这一种由付费提交每次用新连接
 * 从构造上消掉（见 `systemProxy.ts` 的 `createFreshConnectionDispatcher`），不再靠猜。
 */
function provesNotWritten(node: ErrorLike): boolean {
  const code = typeof node.code === "string" ? node.code : "";
  // 建连阶段失败（`syscall: "connect"` 覆盖 ECONNREFUSED / EHOSTUNREACH / ENETUNREACH / 连接 ETIMEDOUT）。
  if (node.syscall === "connect") return true;
  if (DNS_CODES.has(code) || CONNECT_CODES.has(code) || TLS_HANDSHAKE_CODES.has(code)) return true;
  return code === "ECONNRESET" && typeof node.message === "string" && PRE_TLS_RESET.test(node.message);
}

/**
 * 这次 `fetch()` 的失败，能不能**证明**请求一个字节都没写出去？证明不了就是 false。
 */
export function outboundRequestWasNeverWritten(error: unknown): boolean {
  return causeChain(error).some(provesNotWritten);
}

const TRANSPORT_CODES = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNABORTED"]);

/**
 * 这次失败是不是**连接层**失败（连接被重置 / 对面关闭 / 头体超时）——而不是供应商给了一个 HTTP 回复。
 * 只有这种「结果未知」才值得用同一个幂等键重发（且仅限供应商真支持幂等）；供应商明确回了 4xx/5xx
 * 就是它的答复，重发不会换来不同结果。用户主动取消（AbortError）不算。
 */
export function isTransportLevelFailure(error: unknown): boolean {
  return causeChain(error).some((node) => {
    const code = typeof node.code === "string" ? node.code : "";
    if (code.startsWith("UND_ERR_") || TRANSPORT_CODES.has(code)) return true;
    return typeof node.message === "string" && /socket hang up|other side closed/i.test(node.message);
  });
}

/**
 * 把 cause 链摊成一句可记日志的话。
 *
 * 为什么非有不可：undici 外壳永远只说 `fetch failed`，真正的原因全在 cause 里。
 * 用户看到的、日志里留下的、我们排查时唯一能拿到的那句话，此前就是这四个字——
 * 2026-09-18 那条红烧掉了整整三轮 CI 才把 cause 挖出来。
 *
 * 只取 `name` / `code` / `message`：cause 上还挂着 socket 地址端口这类东西，
 * 不该进日志（日志脱敏的规矩见 `logging/redact.ts`）。
 */
export function describeOutboundFailure(error: unknown): string {
  return causeChain(error)
    .map((node) => {
      const name = typeof node.name === "string" && node.name ? node.name : "Error";
      const code = typeof node.code === "string" && node.code ? ` ${node.code}` : "";
      const message = typeof node.message === "string" ? node.message : "";
      return `${name}${code}${message ? `: ${message}` : ""}`;
    })
    .join(" ← ");
}

/**
 * 供应商对这次提交的**回复**。执行器只在**真的收到了响应**之后才把它挂到错误上（两台发动机各一处：
 * 引擎 A `vendor/vendorHttp.ts` 的 `VendorRequestError`，引擎 B 的 `ApimartGenerationProviderError`）。
 * 没收到响应的失败永远没有它，于是永远到不了下面那一档。
 */
export type ProviderAnswer = {
  /** 收到的 HTTP 状态码。 */
  httpStatus: number;
  /** 响应体是不是「失败信封」（HTTP 200 + 非成功 `code` 这一类）。 */
  envelopeFailure: boolean;
  /** 响应里有没有任务号。有任务号就可能已经受理，不算拒绝。 */
  taskIdReturned: boolean;
};

function readProviderAnswer(value: unknown): ProviderAnswer | null {
  if (!value || typeof value !== "object") return null;
  const answer = value as Partial<ProviderAnswer>;
  if (typeof answer.httpStatus !== "number" || !Number.isInteger(answer.httpStatus)) return null;
  if (typeof answer.envelopeFailure !== "boolean" || typeof answer.taskIdReturned !== "boolean") return null;
  return answer as ProviderAnswer;
}

/**
 * 「当场明确拒绝」的状态码名单——**只写这一处**。名单里每个码都是「对方看完请求、亲口说不、没建任务」：
 * - 400 参数不对 / 内容审核不过；401 密钥无效；402 余额不足；403 无权限 / 被风控拒；404 模型或路径不存在；
 * - 422 语义校验不过；429 限流（请求在入口被挡，没进队列、不扣费）。
 * **刻意不在名单里**：408（上游可能收下之后才超时）、409（常见于「同一幂等键已受理」，即已经有一笔）、
 * 425（Too Early，重放语义不明）以及其他 4xx——判错的代价是重复扣钱，一律按「结果未知」锁住。
 */
export const REJECTION_STATUS_CODES: ReadonlySet<number> = new Set([400, 401, 402, 403, 404, 422, 429]);

/**
 * 第三档：「供应商当场明确拒绝了这次提交」——**确定没受理、没扣钱**（2026-10-05 用户拍板，发动机收敛第一刀 F3）。
 *
 * 只认一种证据：**收到了响应**，状态在 `REJECTION_STATUS_CODES` 名单里，或是 2xx 但响应体是失败信封，并且响应里没有任务号。
 * 5xx、名单外的 4xx（408 / 409 / 425 等）、没收到响应、读响应读到一半断了，一律不在这里——它们仍是「结果未知」（判错成「拒绝」的代价是
 * 用户再点一次就是第二笔，所以只认对方亲口说了「不」的那一种）。
 *
 * 两台发动机、提交出口都只问这一个函数。设计卡：docs/plan/2026-10-05-engine-convergence-cut1-step12-design-card.md §4 F3。
 */
export function providerExplicitlyRejected(error: unknown): boolean {
  return causeChain(error).some((node) => {
    const answer = readProviderAnswer(node.providerAnswer);
    if (!answer || answer.taskIdReturned) return false;
    if (REJECTION_STATUS_CODES.has(answer.httpStatus)) return true;
    return answer.httpStatus >= 200 && answer.httpStatus < 300 && answer.envelopeFailure;
  });
}

// ── 「这次付费提交有没有一个请求离开过本机」：按**派发**记账（2026-10-06，L-claim） ─────────────────────
//
// 上面三个函数只看**最后抛出来的那一个错误**。可「没发出去」最常见的几种根本不在网络层：出网策略拒、请求头不合法、
// 参考素材读不到、密钥缺失、网络设置没就绪、合同哈希对不上……它们都在请求交给网络之前就抛了，错误里没有任何
// 连接证据，于是一律落进「结果未知」，镜头被冻在对账里，用户换了模型点重试也被拒（V-1042 第 22 张截图）。
//
// 能**确定**回答的那一层是网络出口本身：主进程的 Node HTTP 只有 `appFetch` 一个口（`check:network-entry` 守着），
// 一个请求要离开本机必须先经过它。所以由提交出口给这一次派发开一本账，`appFetch` 每交出一个请求记一笔、
// 这个请求在连上之前就失败了（上面那条 cause 链判据）再把那一笔划掉。派发失败时：
//   · 这本账上一笔「可能写出去了」都没有 → **确定没发出**（`never_reached_network` 或 `connect_failed`）；
//   · 有任何一笔可能写出去了 → 不下结论，交回「结果未知」（宁可多对一次账）。
// 只有执行器**声明**自己的每个请求都走 `appFetch`（`GenerationProvider.networkTransport === "app-fetch"`）时才信这本账；
// 没声明的（测试替身、未来接进来的别的传输）只认 cause 链证据，与以前一样。
//
// 不计入「可能写出去」的只有一种：**不带任何凭据、没有 query、没有请求体的 GET / HEAD**（例如官方备用域探测
// `GET /v1/models`）。不带用户的 key，就不可能记到用户账上。带了凭据（任何非标准头，判据在 credentialRedirectPolicy）、
// 带 query（query 式鉴权）或带请求体的，一律算可能花钱。

export type NotDispatchedReason =
  /** 这次派发一个请求都没交给网络层：在本机就被拦下（出网策略、本机检查、密钥缺失、网络设置没就绪……）。 */
  | "never_reached_network"
  /** 交给网络层的请求全都在连上之前就失败了（DNS / 建连 / TLS 握手前）。 */
  | "connect_failed";

type HandoffLedger = {
  /** 交给网络层、可能花钱的请求，还没被证明「没写出去」的那几笔。 */
  readonly open: Set<symbol>;
  /** 交给网络层、可能花钱的请求总数（含后来被证明没写出去的）。 */
  spendCapableHandoffs: number;
  readonly parent: HandoffLedger | undefined;
};

const ledgerStorage = new AsyncLocalStorage<HandoffLedger>();

function ledgerChain(): HandoffLedger[] {
  const chain: HandoffLedger[] = [];
  for (let ledger = ledgerStorage.getStore(); ledger; ledger = ledger.parent) chain.push(ledger);
  return chain;
}

type FetchInput = Parameters<typeof globalThis.fetch>[0];

/** 不带凭据、没有 query、没有请求体的 GET / HEAD 不可能记到用户账上；其余一律当可能花钱。 */
function mayChargeAccount(input: FetchInput, init: RequestInit | undefined): boolean {
  const request = typeof Request !== "undefined" && input instanceof Request ? input : undefined;
  const method = String(init?.method ?? request?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return true;
  if (init?.body != null || requestCarriesCredentials(input, init)) return true;
  try {
    return new URL(request ? request.url : String(input)).search !== "";
  } catch {
    return true;
  }
}

/**
 * 网络出口（`appFetch`）把一个请求交给原生 fetch 的那一下，经这里：记进当前付费派发的账（不在任何派发里就不记），
 * 原生 fetch 在连上之前就失败了再划掉。不包错误、不重试，原样返回 / 原样抛出。
 */
export async function handOffToNetwork<T>(input: FetchInput, init: RequestInit | undefined, send: () => Promise<T>): Promise<T> {
  const chain = ledgerChain();
  const token = chain.length > 0 && mayChargeAccount(input, init) ? Symbol("handoff") : undefined;
  if (token) {
    for (const ledger of chain) {
      ledger.open.add(token);
      ledger.spendCapableHandoffs += 1;
    }
  }
  try {
    return await send();
  } catch (error) {
    if (token && outboundRequestWasNeverWritten(error)) for (const ledger of chain) ledger.open.delete(token);
    throw error;
  }
}

export type ObservedSubmission<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown; notDispatched: NotDispatchedReason | null };

/**
 * 跑一次付费提交（`submit` 里可以有任意多层：画布那台的 runTask、目录执行器、自定义调用脚本……），
 * 失败时回答「能不能证明这一次一个字节都没离开本机」。证明不了 → `notDispatched: null`（结果未知）。
 *
 * `transport` 是执行器的声明（见上）；只有 `"app-fetch"` 才读这本账，否则退回 cause 链判据。
 */
export async function observeSubmissionHandoffs<T>(transport: "app-fetch" | undefined, submit: () => Promise<T>): Promise<ObservedSubmission<T>> {
  const ledger: HandoffLedger = { open: new Set(), spendCapableHandoffs: 0, parent: ledgerStorage.getStore() };
  try {
    return { ok: true, value: await ledgerStorage.run(ledger, submit) };
  } catch (error) {
    if (transport !== "app-fetch") {
      return { ok: false, error, notDispatched: outboundRequestWasNeverWritten(error) ? "connect_failed" : null };
    }
    if (ledger.open.size > 0) return { ok: false, error, notDispatched: null };
    return { ok: false, error, notDispatched: ledger.spendCapableHandoffs === 0 ? "never_reached_network" : "connect_failed" };
  }
}
