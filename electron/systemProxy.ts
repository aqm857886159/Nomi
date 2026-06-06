/**
 * 主进程出站代理（Phase 1：自动探测，零界面）。
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
 *
 * Phase 1 不做（留 Phase 2）：设置界面（系统/自定义/关闭三态）、SOCKS（undici ProxyAgent 不支持，
 * 需 fetch-socks）、系统代理热更新、渲染层 session.setProxy。探到 SOCKS-only 会明确 log 告知，不静默。
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

export type ProxyResolution =
  | { kind: "none" }
  | { kind: "http"; url: string; source: "env" | "system" }
  | { kind: "unsupported"; detail: string; source: "env" | "system" };

const LOG = "[nomi:proxy]";

/** 当前生效代理的人类可读标签（供 describeNetworkError 的诊断提示用）；无代理为 null。 */
let activeProxyLabel: string | null = null;

/**
 * 把一个原始代理串规范成 ProxyResolution。
 *  - 接受 `http://h:p` / `https://h:p` / 裸 `h:p`（补 http://）。
 *  - SOCKS 标记为 unsupported（Phase 1 不支持）。
 */
function classifyProxyString(raw: string, source: "env" | "system"): ProxyResolution {
  const value = raw.trim();
  if (!value) return { kind: "none" };
  if (/^socks/i.test(value)) {
    return { kind: "unsupported", detail: `SOCKS 代理（${value}）`, source };
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
    if (/^socks/i.test(type)) {
      return { kind: "unsupported", detail: `系统代理是 SOCKS（${entry}）`, source: "system" };
    }
    if (/^https$/i.test(type)) return classifyProxyString(`https://${hostPort}`, "system");
    if (/^proxy$/i.test(type)) return classifyProxyString(`http://${hostPort}`, "system");
    // 其它类型（QUIC 等）当前不支持
    return { kind: "unsupported", detail: `不支持的系统代理类型（${entry}）`, source: "system" };
  }
  return { kind: "none" };
}

/** 综合探测：env 优先（用户显式设置），否则问系统。返回首个有效结果。 */
export async function resolveProxy(session: Session): Promise<ProxyResolution> {
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
export async function applySystemProxy(session: Session): Promise<ProxyResolution> {
  try {
    const resolution = await resolveProxy(session);
    if (resolution.kind === "http") {
      const direct = getGlobalDispatcher();
      const proxy = new ProxyAgent(resolution.url);
      setGlobalDispatcher(new SelectiveProxyDispatcher(proxy, direct));
      activeProxyLabel = `${resolution.url}（来源：${resolution.source === "env" ? "环境变量" : "系统设置"}）`;
      console.log(`${LOG} 已启用代理 ${activeProxyLabel}；本地/私网地址直连`);
    } else if (resolution.kind === "unsupported") {
      console.warn(
        `${LOG} 探测到${resolution.detail}，Phase 1 暂不支持；请改用 HTTP 代理端口。当前按直连处理。`,
      );
    } else {
      console.log(`${LOG} 未探测到代理，按直连处理`);
    }
    return resolution;
  } catch (error) {
    console.error(`${LOG} applySystemProxy 失败（已忽略，退回直连）:`, error);
    return { kind: "none" };
  }
}

/**
 * 把 undici/网络层的原始报错翻成人话，替换掉无信息量的 "fetch failed"。
 * 供 IPC handler 的 catch 用。
 */
export function describeNetworkError(error: unknown): string {
  const proxyHint = activeProxyLabel
    ? `（当前代理：${activeProxyLabel}）`
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
