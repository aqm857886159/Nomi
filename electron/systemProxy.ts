/**
 * 主进程出站代理（自动探测 + 应用内三态设置）。
 *
 * 病根：Electron 主进程的全局 `fetch`（undici）默认**不读系统代理**——`session.setProxy()`
 * 只管 Chromium 渲染层，救不了主进程 fetch。于是中国用户即便开了 Clash，应用里"测试连接 / 调
 * AI API / 拉模型"仍直连超时，报笼统的 `fetch failed`。
 *
 * 解法（undici 官方 + Cherry Studio 实战）：
 *  - `setGlobalDispatcher(dispatcher)` 的 dispatcher 会被 Node 内置 `fetch` 共享
 *    （镜像到 `Symbol.for('undici.globalDispatcher.1')`）→ 全局 fetch 即走该 dispatcher。
 *  - 代理地址来源：① 环境变量 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY；② Electron `session.resolveProxy()`
 *    读系统网络设置/PAC（macOS 从 Finder 启动拿不到 env 时的兜底）。
 *  - 用 `SelectiveProxyDispatcher` 包一层：origin 命中私网/回环（本地模型服务器 127.0.0.1 等）→ 走
 *    原始直连，绝不把本地流量也代理掉。私网判定复用 `hardenedFetch` 的 `isPrivateHost`（单一真相源）。
 *  - 渲染层同源（修「主进程能下载、预览区放不出远端视频」的撕裂）：env 来源的代理另用
 *    `session.setProxy()` 喂给 Chromium 网络栈——渲染层默认只读系统设置、不读环境变量。系统来源
 *    无需处理（session 默认 mode:'system' 已在用它）。私网/回环经 proxyBypassRules 直连。
 *
 * Phase 2（2026-08-01，见 docs/plan/2026-08-01-in-app-proxy-setting.md）：
 *  - 三态偏好（跟随系统 / 自定义 / 不用代理）由 `proxySettings.ts` 持久化，**用户偏好先于探测**。
 *  - `applySystemProxy` 可重复调用 = 改完设置即时生效，不用重启（见 directDispatcher 的套娃注释）。
 *  - `getProxyStatus()` 把「选了什么 × 实际生效什么」暴露给设置面板。
 *
 * Phase 3（2026-08-01）：SOCKS 支持。Electron 31 内置 undici 6.19.8（内置 `Socks5ProxyAgent`
 * 要 undici ≥7.25，升不得——理由见 socksDispatcher 头注释），故用 `socks` 包自接
 * `Agent({ connect })`。三档偏好与 http 完全同构，UI 无需分叉。
 */
import { URL } from "node:url";
import type { Session } from "electron";
import {
  Dispatcher,
  ProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from "undici";
import { isPrivateHost } from "./hardenedFetch";
import { createSocksDispatcher, parseSocksProxyUrl } from "./socksDispatcher";
// **只引类型**：proxySettings → runtimePaths → electron 有运行时依赖，引进来会让本模块
// 没法在纯 Node 下单测（既有 systemProxy.test.ts 正是靠"不碰 electron 运行时"跑起来的）。
// 故偏好由调用方（main.ts / proxyIpc.ts，它们本来就在 electron 里）读好了注入。
import type { ProxyMode, ProxyPrefs } from "./proxySettings";

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

/** 面板要显示的「当前网络状态」（用户选了什么 × 实际生效什么，两者可能不同）。 */
export type ProxyStatus = {
  mode: ProxyMode;
  customUrl: string;
  /** 实际生效的代理地址；直连时为空串。 */
  activeUrl: string;
  /** 探到了但本版用不了（SOCKS 等）的人话详情；否则空串。 */
  unsupported: string;
  source: ProxySource | "";
};

const LOG = "[nomi:proxy]";

/**
 * 原始直连 dispatcher，**只捕获一次**。
 * 没有它的话，第二次 applySystemProxy 会把上一次装的 SelectiveProxyDispatcher 当成「直连档」
 * 套进新的 Selective 里 —— 每改一次设置就多套一层，私网直连那条路会经过 N 层代理判断。
 * 热切换是本次新增能力（以前只在启动跑一次），这个洞是它带来的，必须在这里堵死。
 */
let baseDispatcher: Dispatcher | null = null;
function directDispatcher(): Dispatcher {
  if (!baseDispatcher) baseDispatcher = getGlobalDispatcher();
  return baseDispatcher;
}

/** 最近一次探测结果（供 getProxyStatus 拼状态；与 rememberProxyState 同步写）。 */
let lastResolution: ProxyResolution = { kind: "none" };

/**
 * 本地/私网直连规则：回环 + 私网网段 + 无点主机名（`<local>`）。别把本地模型服务器
 *（Ollama 11434 / ComfyUI 8188）也代理掉，与 SelectiveProxyDispatcher 的 isPrivateHost 同义。
 */
const LOCAL_BYPASS_RULES = "localhost,127.0.0.1,[::1],10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,<local>";

/** 当前生效代理的人类可读标签（供 describeNetworkError 的诊断提示用）；无代理/未生效为 null。 */
let activeProxyLabel: string | null = null;
/**
 * 探到「配了代理、但这个地址用不了」（解析不出的 SOCKS 地址 / QUIC 等未知协议）时的人话详情。
 * 与 activeProxyLabel 互斥：unsupported 时按直连跑，但用户其实**配了**代理——诊断必须如实说
 * 地址有问题，绝不误说「当前未启用代理」（P2·别误导）。SOCKS 本身自 2026-08-01 起已支持。
 */
let unsupportedProxyDetail: string | null = null;

/**
 * 把一次探测结果记进模块级诊断状态（唯一写入口；applySystemProxy 与测试都经它，避免两份真相源）。
 *  - http/socks  → 记生效标签，清 unsupported。
 *  - unsupported → 记 unsupported 详情，清生效标签（按直连跑但用户开了代理）。
 *  - none        → 两者皆清（确无代理）。
 */
function sourceLabel(source: ProxySource): string {
  if (source === "env") return "环境变量";
  if (source === "custom") return "应用内设置";
  return "系统设置";
}

function rememberProxyState(resolution: ProxyResolution): void {
  lastResolution = resolution;
  if (isActiveProxy(resolution)) {
    activeProxyLabel = `${resolution.url}（来源：${sourceLabel(resolution.source)}）`;
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
 * 取第一条非 DIRECT 项。PROXY/HTTPS → http(s)；SOCKS → unsupported。
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
  try {
    // 用一个代表性 https 目标探测（PAC 可能按目标返回不同代理；Phase 1 取通用值）。
    const raw = await session.resolveProxy("https://api.openai.com");
    return parseResolveProxyString(raw);
  } catch (error) {
    console.error(`${LOG} session.resolveProxy 失败:`, error);
    return { kind: "none" };
  }
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
    const originStr =
      typeof origin === "string" ? origin : origin instanceof URL ? origin.toString() : "";
    if (!originStr) return false;
    try {
      return isPrivateHost(new URL(originStr).hostname);
    } catch {
      return false;
    }
  }

  dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandlers,
  ): boolean {
    const target = this.bypass(options.origin) ? this.direct : this.proxy;
    return target.dispatch(options, handler);
  }

  // close/destroy 实际很少被 setGlobalDispatcher 的全局实例调用，但需匹配 undici
  // Dispatcher 的重载签名（同时支持 Promise 与 callback 两种调用形态），否则类型不兼容。
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

/**
 * 探测并应用系统代理到全局 fetch。启动时调一次。
 * 整体 try/catch：任何异常只记日志、不抛——探测失败绝不能拖垮启动（最坏退化回直连）。
 */
export async function applySystemProxy(session: Session, prefs?: ProxyPrefs): Promise<ProxyResolution> {
  try {
    const effectivePrefs = prefs ?? FOLLOW_SYSTEM;
    // ⚠️ 顺序有讲究：mode=system 要**先**把 session 还原成 'system' 再去问它。
    // 「不用代理」那一档会把 session 钉成 `mode:'direct'`，而 resolveProxy 正是问这个 session
    // 要系统代理 —— 不先还原，它就恒答 DIRECT，用户切回「跟随系统」后代理再也回不来
    //（2026-08-01 真机走查抓到：off → system 之后 tmpfiles 仍不可达）。自己污染了自己的探测源。
    if (effectivePrefs.mode === "system") await session.setProxy({ mode: "system" });
    const resolution = await resolveProxy(session, effectivePrefs);
    rememberProxyState(resolution);
    if (isActiveProxy(resolution)) {
      const direct = directDispatcher();
      // socks 与 http 只差"造哪个 dispatcher"，外面那层选择性代理（私网直连）完全共用。
      const socks = resolution.kind === "socks" ? parseSocksProxyUrl(resolution.url) : null;
      const proxy = socks ? createSocksDispatcher(socks) : new ProxyAgent(resolution.url);
      setGlobalDispatcher(new SelectiveProxyDispatcher(proxy, direct));
      console.log(`${LOG} 已启用代理 ${activeProxyLabel}；本地/私网地址直连`);
      // 渲染层同源修复：主进程 undici 走代理后，渲染层的 Chromium 网络栈（<video>/<img>/
      // renderer fetch）默认只读「系统设置」代理、**不读环境变量**。env 来源的代理（Clash/终端
      // export HTTPS_PROXY 的典型场景）会出现「主进程能下载、渲染层放不出远端视频」的撕裂——
      // 表现为预览区「视频加载失败」。这里把 env 代理也显式喂给 session，让两层同一真相源。
      // 系统来源的代理无需处理：session 默认 mode:'system' 已在用它（且可能是 PAC，别用 fixed 覆盖）。
      // custom 同 env：用户填的地址系统并不知道，不喂给 session 就会撕裂（主进程走代理、预览区直连）。
      if (resolution.source === "env" || resolution.source === "custom") {
        await session.setProxy({
          proxyRules: resolution.url,
          // 本地/私网直连：回环 + 私网网段 + 无点主机名（<local>），别把本地模型服务器
          //（Ollama 11434 / ComfyUI 8188）也代理掉，与 SelectiveProxyDispatcher 的 isPrivateHost 同义。
          proxyBypassRules: LOCAL_BYPASS_RULES,
        });
        console.log(`${LOG} 已把代理同步到渲染层 session（远端视频/图片预览同源走代理）`);
      }
    } else {
      // 直连档（none / unsupported）**必须把 dispatcher 还原**——热切换才成立：
      // 用户从「自定义」切到「不用代理」，不还原的话 undici 仍挂着上一个 ProxyAgent，
      // 设置界面说直连、实际还在走代理（比不给设置更糟）。
      setGlobalDispatcher(directDispatcher());
      // 渲染层同理：之前若被 setProxy 钉过（env/custom），得改回去，否则 Chromium 那侧还走代理。
      // 但改成什么有讲究：只有用户**明确选了「不用代理」**才钉 direct；其余情况（跟随系统但当前
      // 没探到代理 / 探到 SOCKS 用不了）要还原成 session 默认的 'system'——钉死 direct 会让用户
      // 中途打开系统代理后渲染层再也跟不上（而主进程下次 apply 就跟上了，又是一次两层撕裂）。
      await session.setProxy(effectivePrefs.mode === "off" ? { mode: "direct" } : { mode: "system" });
      if (resolution.kind === "unsupported") {
        // 按直连跑，但记下 unsupported 详情 → describeNetworkError 与设置面板都会如实说
        //「地址无效/协议不认识，已按直连」，绝不误说「未启用代理」（用户其实配了）。
        console.warn(`${LOG} 探测到${resolution.detail}，用不了；当前按直连处理。`);
      } else {
        console.log(`${LOG} 按直连处理`);
      }
    }
    return resolution;
  } catch (error) {
    console.error(`${LOG} applySystemProxy 失败（已忽略，退回直连）:`, error);
    return { kind: "none" };
  }
}

/**
 * 面板要显示的当前网络状态 = 用户选了什么（prefs）× 实际生效什么（lastResolution）。
 * 两者会不一致，而**这种不一致正是用户最需要看见的**：选了跟随系统但系统压根没代理、
 * 探到 SOCKS 本版用不了（以前只在 console warn，界面零暴露）、自定义地址填错。
 */
export function getProxyStatus(prefs: ProxyPrefs = FOLLOW_SYSTEM): ProxyStatus {
  return {
    mode: prefs.mode,
    customUrl: prefs.customUrl,
    activeUrl: isActiveProxy(lastResolution) ? lastResolution.url : "",
    unsupported: lastResolution.kind === "unsupported" ? lastResolution.detail : "",
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
      ? `（检测到 ${unsupportedProxyDetail}，这个地址用不了、已按直连处理；请在「模型设置 → 网络」里改成有效的 http:// 或 socks5:// 地址）`
      : "（当前未启用代理；若该地址需科学上网，请开启系统代理后重启应用）";

  if (error instanceof Error && error.name === "AbortError") {
    return `请求超时：12 秒内未响应。可能网络不通，或该地址需要代理才能访问。${proxyHint}`;
  }

  // undici fetch 把底层错误塞在 error.cause.code
  const code = extractErrorCode(error);
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
  return message;
}

function extractErrorCode(error: unknown): string | undefined {
  let cur: unknown = error;
  for (let depth = 0; depth < 5 && cur; depth += 1) {
    if (typeof cur === "object" && cur !== null) {
      const code = (cur as { code?: unknown }).code;
      if (typeof code === "string") return code;
      cur = (cur as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return undefined;
}

/**
 * 测试钩子：直接喂一个 ProxyResolution 进诊断状态，免去真起 Electron Session 探测。
 * 仅测试用——走的是与 applySystemProxy 同一个 rememberProxyState 写入口（单一真相源）。
 */
export function rememberProxyStateForTests(resolution: ProxyResolution): void {
  rememberProxyState(resolution);
}

/** 测试钩子：清空模块级代理诊断状态（生效标签 + unsupported 详情）。 */
export function resetProxyStateForTests(): void {
  activeProxyLabel = null;
  unsupportedProxyDetail = null;
}
