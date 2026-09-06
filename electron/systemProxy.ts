/**
 * App-owned HTTP route: preferences -> serialized Chromium application ->
 * committed dispatcher + resolution. SDK imports may replace undici's global
 * dispatcher, so appFetch always passes our private dispatcher explicitly.
 * Existing system/env/custom/off, SOCKS and private-host policies stay here.
 */
import { URL } from "node:url";
import type { Session } from "electron";
import {
  Dispatcher,
  Agent,
  ProxyAgent,
} from "undici";
import { isPrivateHost } from "./networkHostPolicy";
import { createSocksDispatcher, parseSocksProxyUrl } from "./socksDispatcher";
import { networkFailureDetails, redactNetworkMessage, safeNetworkUrl } from "./networkErrorDetails";
// **只引类型**：proxySettings → runtimePaths → electron 有运行时依赖，引进来会让本模块
// 没法在纯 Node 下单测（既有 systemProxy.test.ts 正是靠"不碰 electron 运行时"跑起来的）。
// 故偏好由调用方（main.ts / proxyIpc.ts，它们本来就在 electron 里）读好了注入。
import type { ProxyMode, ProxyPrefs } from "./proxySettings";
import { logError } from "./logging/logger";

/** 没有偏好文件时的行为 = 上线本设置前的唯一行为（跟随系统探测）。 */
const FOLLOW_SYSTEM: ProxyPrefs = { mode: "system", customUrl: "" };

export type ProxySource = "env" | "system" | "custom";

export type ProxyResolution =
  | { kind: "none" }
  | { kind: "http"; url: string; source: ProxySource }
  | { kind: "socks"; url: string; source: ProxySource }
  | { kind: "unsupported"; detail: string; source: ProxySource };

/** http / socks 都算"真的在走代理"；判据收在这里，别让调用方各写一份。 */
function isActiveProxy(r: ProxyResolution): r is Extract<ProxyResolution, { kind: "http" | "socks" }> {
  return r.kind === "http" || r.kind === "socks";
}

/** Whether the app has a committed HTTP/SOCKS route for public destinations. */
export function isApplicationProxyActive(): boolean {
  return Boolean(activeRoute && isActiveProxy(activeRoute.resolution));
}

/** 面板要显示的「当前网络状态」（用户选了什么 × 实际生效什么，两者可能不同）。 */
export type ProxyStatus = {
  mode: ProxyMode;
  customUrl: string;
  /** 实际生效的代理地址；直连时为空串。 */
  activeUrl: string;
  /** 当前偏好未能生效的原因；实际已提交线路仍由 activeUrl/source 描述。 */
  unsupported: string;
  source: ProxySource | "";
};


type CommittedRoute = {
  dispatcher: Dispatcher;
  resolution: ProxyResolution;
  chromiumConfig: Electron.ProxyConfig;
};
let activeRoute: CommittedRoute | undefined;
let applicationError: Error | undefined;
let applyQueue: Promise<void> = Promise.resolve();
let requestedGeneration = 0;
// Local RPC / configured private services always bypass public proxy settings,
// including before boot or when those settings could not be applied.
const privateDispatcher = new Agent();

function isPrivateTarget(target: unknown): boolean {
  if (typeof target !== 'string' && !(target instanceof URL)) return false;
  try { return isPrivateHost(new URL(target).hostname); } catch { return false; }
}

// Stable only as a forwarder: resolve the real route at dispatch time, so a
// config commit between fetch's microtasks cannot strand it on a closed agent.
const appDispatcher = new class extends Dispatcher {
  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers): boolean {
    // Check each dispatch, not just fetch's first URL: a private URL redirecting
    // to the public internet must not inherit an unconditional direct route.
    if (isPrivateTarget(options.origin)) return privateDispatcher.dispatch(options, handler);
    if (!activeRoute) throw applicationError ?? new Error('Application network settings are not ready');
    return activeRoute.dispatcher.dispatch(options, handler);
  }
}();

/** Public targets await boot/latest preferences; explicit private targets do not. */
export async function getAppDispatcher(signal?: AbortSignal, target?: string | URL): Promise<Dispatcher> {
  signal?.throwIfAborted();
  if (isPrivateTarget(target)) return appDispatcher;
  let pending: Promise<void>;
  do {
    signal?.throwIfAborted();
    pending = applyQueue;
    if (!signal) await pending;
    else await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      void pending.then(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      });
    });
  } while (pending !== applyQueue);
  signal?.throwIfAborted();
  if (!activeRoute) throw applicationError ?? new Error('Application network settings are not ready');
  return appDispatcher;
}

/**
 * Chromium 的既有本地/私网直连规则，含无点主机名（`<local>`）。Node 继续按
 * isPrivateHost 的显式私网/回环分类，不另行扩大无点主机名或 DNS 解析策略。
 */
const LOCAL_BYPASS_RULES = "localhost,127.0.0.1,[::1],10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,<local>";

/** 当前生效代理的人类可读标签（供 describeNetworkError 的诊断提示用）；无代理/未生效为 null。 */
let activeProxyLabel: string | null = null;
/**
 * 探到「配了代理、但这个地址用不了」（解析不出的 SOCKS 地址 / QUIC 等未知协议）时的人话详情。
 * 诊断必须如实说地址未生效，不能把配置失败说成已确认直连。
 * 正常提交只接受已支持的线路；此分支也供既有诊断测试夹具使用。
 */
let unsupportedProxyDetail: string | null = null;

/**
 * 把一次探测结果记进模块级诊断状态（唯一写入口；applySystemProxy 与测试都经它，避免两份真相源）。
 *  - http/socks  → 记生效标签，清 unsupported。
 *  - unsupported → 记未生效详情（诊断夹具，不等于允许直连）。
 *  - none        → 两者皆清（确无代理）。
 */
function sourceLabel(source: ProxySource): string {
  if (source === "env") return "环境变量";
  if (source === "custom") return "应用内设置";
  return "系统设置";
}

function rememberProxyState(route: CommittedRoute): void {
  activeRoute = route;
  const { resolution } = route;
  if (isActiveProxy(resolution)) {
    activeProxyLabel = `${safeNetworkUrl(resolution.url)}（来源：${sourceLabel(resolution.source)}）`;
    unsupportedProxyDetail = null;
  } else if (resolution.kind === "unsupported") {
    activeProxyLabel = null;
    unsupportedProxyDetail = `${resolution.detail}，来源：${sourceLabel(resolution.source)}`;
  } else {
    activeProxyLabel = null;
    unsupportedProxyDetail = null;
  }
}

/**
 * 把一个原始代理串规范成 ProxyResolution。
 *  - 接受 `http://h:p` / `https://h:p` / 裸 `h:p`（补 http://）。
 *  - `socks5://` / `socks4://` / `socks://` 走 SOCKS 隧道（见 socksDispatcher）。
 */
function classifyProxyString(raw: string, source: ProxySource): ProxyResolution {
  const value = raw.trim();
  if (!value) return { kind: "none" };
  const explicitScheme = value.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
  if (explicitScheme && !["http", "https", "socks", "socks4", "socks5"].includes(explicitScheme)) {
    // 内部不变量：这条 detail 只喂 normalizeExplicitProxyUrl 抛出的英文前缀
    // "Invalid provider proxy URL:"（renderer 的 ProviderProxyField 先用自己的 i18n
    // invalidProxyUrl 兜住，用户读不到这条），故不进 desktopT，用英文保持内部错误码风格。
    return { kind: "unsupported", detail: `unsupported scheme ${explicitScheme}`, source };
  }
  if (/^socks/i.test(value)) {
    // socks 从 2026-08-01 起真支持（见 socksDispatcher）。解析不出主机/端口才算 unsupported——
    // 绝不静默按直连跑，那会让用户以为代理生效了。
    return parseSocksProxyUrl(value)
      ? { kind: "socks", url: value, source }
      : { kind: "unsupported", detail: `解析不了的 SOCKS 地址（${value}）`, source };
  }
  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { kind: "unsupported", detail: `不支持的协议 ${u.protocol}`, source };
    }
    return { kind: "http", url: u.toString().replace(/\/$/, ""), source };
  } catch {
    return { kind: "unsupported", detail: `无法解析的代理地址（${value}）`, source };
  }
}

/** 为单个供应商创建显式出口，复用应用级代理对 http/https/SOCKS 的同一解析语义。 */
export function normalizeExplicitProxyUrl(raw: string | null | undefined): string {
  const resolution = classifyProxyString(String(raw ?? ""), "custom");
  if (resolution.kind === "none") return "";
  if (resolution.kind === "unsupported") throw new Error(`Invalid provider proxy URL: ${resolution.detail}`);
  return resolution.url;
}

/**
 * 单连接显式代理的 dispatcher。**与应用级 dispatcher 同一私网语义**：包一层
 * SelectiveProxyDispatcher，私网/回环 origin 每次 dispatch 都走直连、公网才走代理。
 * 否则裸 ProxyAgent 作为 suppliedDispatcher 传给 appFetch 会绕过 appDispatcher 的
 * isPrivateTarget 检查（见 appFetch.ts），让私网 URL 302 跳公网继承代理/被代理掉本地服务。
 */
export function createExplicitProxyDispatcher(raw: string): Dispatcher {
  const normalized = normalizeExplicitProxyUrl(raw);
  if (!normalized) throw new Error("Provider proxy URL is empty");
  const resolution = classifyProxyString(normalized, "custom");
  if (resolution.kind === "http") return new SelectiveProxyDispatcher(new ProxyAgent(resolution.url), new Agent());
  if (resolution.kind === "socks") {
    const socks = parseSocksProxyUrl(resolution.url);
    if (socks) return new SelectiveProxyDispatcher(createSocksDispatcher(socks), new Agent());
  }
  throw new Error("Invalid provider proxy URL");
}

/** 从环境变量读代理（HTTPS 优先，其次 HTTP，再 ALL）。GUI 从 Finder 启动时这些通常为空。 */
export function parseEnvProxy(env: NodeJS.ProcessEnv): ProxyResolution {
  const raw =
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.HTTP_PROXY ||
    env.http_proxy ||
    env.ALL_PROXY ||
    env.all_proxy ||
    "";
  if (!raw.trim()) return { kind: "none" };
  return classifyProxyString(raw, "env");
}

/**
 * 解析 Electron `session.resolveProxy()` 的返回串。
 * 形如 `"DIRECT"` / `"PROXY 127.0.0.1:7897"` / `"PROXY h:p;DIRECT"` / `"SOCKS5 h:p"`。
 * 取第一条非 DIRECT 项。PROXY/HTTPS → http(s)；SOCKS/SOCKS5 → socks。
 */
export function parseResolveProxyString(result: string): ProxyResolution {
  const entries = result
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (/^DIRECT$/i.test(entry)) continue;
    const [type, hostPort] = entry.split(/\s+/);
    if (!hostPort) continue;
    // Chromium/PAC 约定：裸 `SOCKS` = SOCKS4，`SOCKS5` = SOCKS5。别把 4 当 5 发（握手不同，会连不上）。
    if (/^socks5$/i.test(type)) return classifyProxyString(`socks5://${hostPort}`, "system");
    if (/^socks4?$/i.test(type)) return classifyProxyString(`socks4://${hostPort}`, "system");
    if (/^https$/i.test(type)) return classifyProxyString(`https://${hostPort}`, "system");
    if (/^proxy$/i.test(type)) return classifyProxyString(`http://${hostPort}`, "system");
    // 其它类型（QUIC 等）当前不支持
    return { kind: "unsupported", detail: `不支持的系统代理类型（${entry}）`, source: "system" };
  }
  return { kind: "none" };
}

/**
 * 综合探测。**用户偏好先于一切**（应用内设置的意义就在这）：
 *  - off    → 直连，即便系统开着代理（国内厂商走代理反而慢/被拒时用得上）。
 *  - custom → 只用用户填的那个，不再回落系统（回落会让「我明明关了系统代理」变得不可预期）。
 *  - system → 原有链路：env 优先（用户显式设置），否则问系统。
 * prefs 由调用方读盘后注入；不传 = 跟随系统（= 本设置上线前的行为）。
 */
export async function resolveProxy(session: Session, prefs: ProxyPrefs = FOLLOW_SYSTEM): Promise<ProxyResolution> {
  if (prefs.mode === "off") return { kind: "none" };
  if (prefs.mode === "custom") return classifyProxyString(prefs.customUrl, "custom");
  const fromEnv = parseEnvProxy(process.env);
  if (fromEnv.kind !== "none") return fromEnv;
  // Preserve the existing representative-target policy; a failed lookup is
  // not evidence of DIRECT and must never silently confirm a direct route.
  const raw = await session.resolveProxy("https://api.openai.com");
  return parseResolveProxyString(raw);
}

/**
 * 选择性 dispatcher：私网/回环 origin 走直连，其余走代理。
 * 避免把本地模型服务器（127.0.0.1 / localhost）也代理掉。
 */
export class SelectiveProxyDispatcher extends Dispatcher {
  constructor(
    private readonly proxy: Dispatcher,
    private readonly direct: Dispatcher,
  ) {
    super();
  }

  private bypass(origin: unknown): boolean {
    return isPrivateTarget(origin);
  }

  dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandlers,
  ): boolean {
    const target = this.bypass(options.origin) ? this.direct : this.proxy;
    return target.dispatch(options, handler);
  }

  // 配置热切换时优雅退休旧路由；匹配 undici Dispatcher 的 Promise / callback 重载。
  close(): Promise<void>;
  close(callback: () => void): void;
  close(callback?: () => void): Promise<void> | void {
    const done = Promise.all([this.proxy.close(), this.direct.close()]).then(() => undefined);
    if (callback) {
      done.then(() => callback(), () => callback());
      return;
    }
    return done;
  }

  destroy(): Promise<void>;
  destroy(err: Error | null): Promise<void>;
  destroy(callback: () => void): void;
  destroy(err: Error | null, callback: () => void): void;
  destroy(
    errOrCallback?: Error | null | (() => void),
    callback?: () => void,
  ): Promise<void> | void {
    const err = typeof errOrCallback === "function" ? null : errOrCallback ?? null;
    const cb = typeof errOrCallback === "function" ? errOrCallback : callback;
    const done = Promise.all([this.proxy.destroy(err), this.direct.destroy(err)]).then(
      () => undefined,
    );
    if (cb) {
      done.then(() => cb(), () => cb());
      return;
    }
    return done;
  }
}

/** Serialize both stacks. Superseded work never publishes a stale resolution. */
export function applySystemProxy(session: Session, prefs: ProxyPrefs = FOLLOW_SYSTEM): Promise<ProxyResolution> {
  const generation = ++requestedGeneration;
  const selected = { ...prefs };
  const previousResolution = (): ProxyResolution => activeRoute?.resolution ?? { kind: 'none' };
  const applying = applyQueue.then(async () => {
    if (generation !== requestedGeneration) return previousResolution();
    let candidate: CommittedRoute | undefined;
    try {
      // Restore the system discovery source before resolving, otherwise an old
      // off/custom session answers its own override instead of the OS setting.
      if (selected.mode === 'system') await session.setProxy({ mode: 'system' });
      const resolution = await resolveProxy(session, selected);
      if (generation !== requestedGeneration) return previousResolution();
      if (resolution.kind === 'unsupported') throw new Error(resolution.detail);
      const chromiumConfig: Electron.ProxyConfig = isActiveProxy(resolution)
        && resolution.source !== 'system'
        ? { proxyRules: resolution.url, proxyBypassRules: LOCAL_BYPASS_RULES }
        : { mode: selected.mode === 'off' ? 'direct' : 'system' };
      const direct = new Agent();
      const socks = resolution.kind === 'socks' ? parseSocksProxyUrl(resolution.url) : null;
      const dispatcher = isActiveProxy(resolution)
        ? new SelectiveProxyDispatcher(socks ? createSocksDispatcher(socks) : new ProxyAgent(resolution.url), direct)
        : direct;
      candidate = { dispatcher, resolution, chromiumConfig };
      await session.setProxy(chromiumConfig);
      if (generation !== requestedGeneration) {
        void dispatcher.close().catch(() => {});
        return previousResolution();
      }
      const retired = activeRoute;
      rememberProxyState(candidate);
      applicationError = undefined;
      // Each route owns its direct agent too. Graceful close lets already
      // dispatched streams finish and never closes the replacement's pool.
      void retired?.dispatcher.close().catch(() => {});
      return resolution;
    } catch (error) {
      void candidate?.dispatcher.close().catch(() => {});
      if (activeRoute) {
        try { await session.setProxy(activeRoute.chromiumConfig); } catch { /* report the failed application below */ }
      }
      if (generation === requestedGeneration) {
        applicationError = error instanceof Error ? error : new Error(String(error));
        logError("proxy", "apply-failed-kept-confirmed-route", undefined, {
          reason: redactNetworkMessage(applicationError.message),
        });
      }
      return previousResolution();
    }
  });
  applyQueue = applying.then(() => undefined);
  return applying;
}

/**
 * 面板要显示的当前网络状态 = 用户选了什么（prefs）× 实际已提交什么（activeRoute）。
 * 两者会不一致，而**这种不一致正是用户最需要看见的**：选了跟随系统但系统压根没代理、
 * 系统探测失败、自定义地址填错或 Chromium 拒绝应用新配置。
 */
export function getProxyStatus(prefs: ProxyPrefs = FOLLOW_SYSTEM): ProxyStatus {
  const lastResolution = activeRoute?.resolution ?? { kind: 'none' };
  return {
    mode: prefs.mode,
    customUrl: prefs.customUrl,
    activeUrl: isActiveProxy(lastResolution) ? lastResolution.url : "",
    unsupported: applicationError ? redactNetworkMessage(applicationError.message)
      : lastResolution.kind === "unsupported" ? redactNetworkMessage(lastResolution.detail) : "",
    source: lastResolution.kind === "none" ? "" : lastResolution.source,
  };
}

/**
 * 把 undici/网络层的原始报错翻成人话，替换掉无信息量的 "fetch failed"。
 * 供 IPC handler 的 catch 用。
 */
export function describeNetworkError(error: unknown): string {
  const proxyHint = activeProxyLabel
    ? `（当前代理：${activeProxyLabel}）`
    : unsupportedProxyDetail
      ? `（检测到 ${unsupportedProxyDetail}，这个地址未生效；请在「模型设置 → 网络」里改成有效的 http:// 或 socks5:// 地址）`
      : "（当前未启用代理；若该地址需科学上网，请开启系统代理后重启应用）";

  if (error instanceof Error && error.name === "AbortError") {
    return `请求已中止或超时。请检查任务是否已取消，或网络是否可达。${proxyHint}`;
  }

  // undici fetch 把底层错误塞在 error.cause.code
  const code = networkFailureDetails(error)?.code;
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "DNS 解析失败：找不到该接入地址的服务器，请检查 BaseURL 是否拼写正确。";
    case "ECONNREFUSED":
      return `连接被拒绝：目标地址/端口未开放或不可达。${proxyHint}`;
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
      return `连接超时：网络不通，或该地址需要代理才能访问。${proxyHint}`;
    case "ECONNRESET":
      return `连接被重置：可能被网络中间设备/防火墙阻断。${proxyHint}`;
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "TLS 证书校验失败：该地址的 HTTPS 证书无效或不被信任。";
    default:
      break;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed/i.test(message)) {
    return `网络请求失败：无法连接到该地址。${proxyHint}`;
  }
  return redactNetworkMessage(message);
}

/**
 * 测试钩子：直接喂一个 ProxyResolution 进诊断状态，免去真起 Electron Session 探测。
 * 仅测试用——走的是与 applySystemProxy 同一个 rememberProxyState 写入口（单一真相源）。
 */
export function rememberProxyStateForTests(resolution: ProxyResolution): void {
  rememberProxyState({ dispatcher: activeRoute?.dispatcher ?? new Agent(), resolution,
    chromiumConfig: activeRoute?.chromiumConfig ?? { mode: 'system' } });
}

/** 测试钩子：清空模块级代理诊断状态（生效标签 + unsupported 详情）。 */
export function resetProxyStateForTests(): void {
  activeProxyLabel = null;
  unsupportedProxyDetail = null;
  applicationError = undefined;
}
