import { afterEach, describe, expect, it } from "vitest";
import { getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";
// 从纯模块导入，避免触发 electron 运行时（CI 纯 Node 会失败）。Session 仅类型引用，已被擦除。
// ⚠️ 本模块**刻意不引 proxySettings**（那条链 → runtimePaths → electron），偏好由调用方注入。
import {
  applySystemProxy,
  describeNetworkError,
  getProxyStatus,
  parseEnvProxy,
  parseResolveProxyString,
  rememberProxyStateForTests,
  resetProxyStateForTests,
  resolveProxy,
  SelectiveProxyDispatcher,
} from "./systemProxy";

afterEach(() => {
  // 代理诊断状态是模块级单例（生效代理标签 / SOCKS 不支持详情），逐用例清场避免串味。
  resetProxyStateForTests();
});

describe("parseEnvProxy", () => {
  it("HTTPS_PROXY 优先于 HTTP_PROXY", () => {
    const r = parseEnvProxy({ HTTPS_PROXY: "http://127.0.0.1:7897", HTTP_PROXY: "http://127.0.0.1:1111" });
    expect(r).toEqual({ kind: "http", url: "http://127.0.0.1:7897", source: "env" });
  });

  it("裸 host:port 自动补 http://", () => {
    expect(parseEnvProxy({ HTTP_PROXY: "127.0.0.1:7897" })).toEqual({
      kind: "http",
      url: "http://127.0.0.1:7897",
      source: "env",
    });
  });

  it("小写 https_proxy 也认", () => {
    expect(parseEnvProxy({ https_proxy: "http://10.0.0.1:8080" })).toMatchObject({ kind: "http" });
  });

  it("SOCKS 代理 → socks（2026-08-01 起真支持，不再是 unsupported）", () => {
    expect(parseEnvProxy({ ALL_PROXY: "socks5://127.0.0.1:7891" })).toEqual({
      kind: "socks",
      url: "socks5://127.0.0.1:7891",
      source: "env",
    });
  });

  it("无任何代理环境变量 → none", () => {
    expect(parseEnvProxy({})).toEqual({ kind: "none" });
  });
});

describe("parseResolveProxyString（Electron session.resolveProxy 返回串）", () => {
  it("DIRECT → none", () => {
    expect(parseResolveProxyString("DIRECT")).toEqual({ kind: "none" });
  });

  it("PROXY host:port → http 代理", () => {
    expect(parseResolveProxyString("PROXY 127.0.0.1:7897")).toEqual({
      kind: "http",
      url: "http://127.0.0.1:7897",
      source: "system",
    });
  });

  it("取第一条非 DIRECT 项（PROXY h:p;DIRECT）", () => {
    expect(parseResolveProxyString("PROXY 192.168.1.2:8888;DIRECT")).toMatchObject({
      kind: "http",
      url: "http://192.168.1.2:8888",
    });
  });

  it("HTTPS 类型 → https 代理（非默认端口保留）", () => {
    expect(parseResolveProxyString("HTTPS proxy.corp:8443")).toMatchObject({
      kind: "http",
      url: "https://proxy.corp:8443",
    });
  });

  it("SOCKS5 → socks5 隧道", () => {
    expect(parseResolveProxyString("SOCKS5 127.0.0.1:7891")).toEqual({
      kind: "socks",
      url: "socks5://127.0.0.1:7891",
      source: "system",
    });
  });

  // Chromium/PAC 约定：裸 SOCKS = SOCKS4。当成 5 发握手就不对，会连不上。
  it("裸 SOCKS → socks4（不是 socks5）", () => {
    expect(parseResolveProxyString("SOCKS 127.0.0.1:1080")).toMatchObject({
      kind: "socks",
      url: "socks4://127.0.0.1:1080",
    });
  });
});

describe("SelectiveProxyDispatcher（私网走直连，其余走代理）", () => {
  function makeFakeDispatcher(tag: string, sink: string[]): Dispatcher {
    return {
      dispatch(opts: Dispatcher.DispatchOptions) {
        sink.push(`${tag}:${String(opts.origin)}`);
        return true;
      },
      close: async () => {},
      destroy: async () => {},
    } as unknown as Dispatcher;
  }

  it("公网 origin → 走代理", () => {
    const calls: string[] = [];
    const d = new SelectiveProxyDispatcher(
      makeFakeDispatcher("proxy", calls),
      makeFakeDispatcher("direct", calls),
    );
    d.dispatch({ origin: "https://api.apimart.ai", path: "/", method: "GET" }, {} as never);
    expect(calls).toEqual(["proxy:https://api.apimart.ai"]);
  });

  it("localhost / 127.0.0.1 / 私网 → 走直连（不代理本地模型服务器）", () => {
    const calls: string[] = [];
    const d = new SelectiveProxyDispatcher(
      makeFakeDispatcher("proxy", calls),
      makeFakeDispatcher("direct", calls),
    );
    d.dispatch({ origin: "http://127.0.0.1:11434", path: "/", method: "GET" }, {} as never);
    d.dispatch({ origin: "http://localhost:1234", path: "/", method: "GET" }, {} as never);
    d.dispatch({ origin: "http://192.168.1.50:8080", path: "/", method: "GET" }, {} as never);
    expect(calls).toEqual([
      "direct:http://127.0.0.1:11434",
      "direct:http://localhost:1234",
      "direct:http://192.168.1.50:8080",
    ]);
  });
});

describe("describeNetworkError（把 fetch failed 翻成人话）", () => {
  function withCause(code: string): Error {
    const e = new TypeError("fetch failed");
    (e as Error & { cause?: unknown }).cause = { code };
    return e;
  }

  it("ETIMEDOUT → 连接超时 + 代理提示", () => {
    expect(describeNetworkError(withCause("ETIMEDOUT"))).toMatch(/连接超时/);
  });

  it("ENOTFOUND → DNS 解析失败", () => {
    expect(describeNetworkError(withCause("ENOTFOUND"))).toMatch(/DNS 解析失败/);
  });

  it("ECONNREFUSED → 连接被拒绝", () => {
    expect(describeNetworkError(withCause("ECONNREFUSED"))).toMatch(/连接被拒绝/);
  });

  it("AbortError → 请求超时", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(describeNetworkError(e)).toMatch(/请求超时/);
  });

  it("裸 fetch failed（无 code）→ 兜底人话，不再露出 'fetch failed'", () => {
    const out = describeNetworkError(new TypeError("fetch failed"));
    expect(out).toMatch(/网络请求失败/);
    expect(out).not.toBe("fetch failed");
  });

  it("探到「配了但用不了的地址」后 → 诊断如实说地址有问题，不误说「未启用代理」", () => {
    rememberProxyStateForTests({ kind: "unsupported", detail: "解析不了的 SOCKS 地址（socks5://）", source: "system" });
    const out = describeNetworkError(withCause("ETIMEDOUT"));
    expect(out).toMatch(/SOCKS/);
    expect(out).toMatch(/用不了|地址/);
    // 关键：不再误导用户「当前未启用代理」（他明明配了）。
    expect(out).not.toMatch(/未启用代理/);
  });

  it("生效 HTTP 代理后 → 诊断带出代理标签（回归既有行为）", () => {
    rememberProxyStateForTests({ kind: "http", url: "http://127.0.0.1:7897", source: "system" });
    expect(describeNetworkError(withCause("ETIMEDOUT"))).toMatch(/当前代理/);
  });
});

// ── 应用内三态设置（2026-08-01，见 docs/plan/2026-08-01-in-app-proxy-setting.md）──────────
// 用户偏好必须**先于**探测：这正是「给 Nomi 单独设代理」这个需求成立的地方。
describe("resolveProxy — 用户偏好先于系统探测", () => {
  const askedSession = (answer: string, calls: string[]) =>
    ({
      resolveProxy: async (url: string) => {
        calls.push(url);
        return answer;
      },
    }) as never;

  it("不用代理 → 直连，且**根本不问系统**（问了就说明偏好没生效）", async () => {
    const calls: string[] = [];
    const r = await resolveProxy(askedSession("PROXY 127.0.0.1:7897", calls), { mode: "off", customUrl: "" });
    expect(r).toEqual({ kind: "none" });
    expect(calls).toEqual([]);
  });

  it("自定义 → 用用户填的，不回落系统（回落会让「我明明关了系统代理」变得不可预期）", async () => {
    const calls: string[] = [];
    const r = await resolveProxy(askedSession("PROXY 10.0.0.1:1080", calls), {
      mode: "custom",
      customUrl: "127.0.0.1:7897",
    });
    expect(r).toEqual({ kind: "http", url: "http://127.0.0.1:7897", source: "custom" });
    expect(calls).toEqual([]);
  });

  it("自定义填 SOCKS → socks 隧道，来源标 custom", async () => {
    const r = await resolveProxy(askedSession("DIRECT", []), { mode: "custom", customUrl: "socks5://127.0.0.1:7897" });
    expect(r).toEqual({ kind: "socks", url: "socks5://127.0.0.1:7897", source: "custom" });
  });

  it("自定义填了残缺的 socks 地址 → unsupported，绝不静默按直连跑", async () => {
    const r = await resolveProxy(askedSession("DIRECT", []), { mode: "custom", customUrl: "socks5://:::" });
    expect(r.kind).toBe("unsupported");
  });

  // ⚠️ resolveProxy 直读 process.env，而开发机/CI 上很可能真的导出着 HTTPS_PROXY。
  // 不清场的话这条会随环境变绿变红（我第一版就被自己机器上的 Clash 变量弄挂了）。
  const PROXY_ENV_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
  function withoutProxyEnv<T>(run: () => T): T {
    const saved = new Map(PROXY_ENV_KEYS.map((k) => [k, process.env[k]] as const));
    for (const k of PROXY_ENV_KEYS) delete process.env[k];
    try {
      return run();
    } finally {
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
    }
  }

  it("跟随系统 · env 为空 → 问 session", async () => {
    const calls: string[] = [];
    const r = await withoutProxyEnv(() =>
      resolveProxy(askedSession("PROXY 127.0.0.1:7897", calls), { mode: "system", customUrl: "" }),
    );
    expect(r).toEqual({ kind: "http", url: "http://127.0.0.1:7897", source: "system" });
    expect(calls).toEqual(["https://api.openai.com"]);
  });

  it("跟随系统 · env 有值 → env 优先，不再问 session（用户显式设置压过系统）", async () => {
    const calls: string[] = [];
    const saved = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = "http://10.1.1.1:8080";
    try {
      const r = await resolveProxy(askedSession("PROXY 127.0.0.1:7897", calls), { mode: "system", customUrl: "" });
      expect(r).toEqual({ kind: "http", url: "http://10.1.1.1:8080", source: "env" });
      expect(calls).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = saved;
    }
  });
});

describe("getProxyStatus — 选了什么 × 实际生效什么", () => {
  it("地址用不了时说「未生效」而不是「直连」——用户其实配了代理，说直连是误导", () => {
    rememberProxyStateForTests({ kind: "unsupported", detail: "解析不了的 SOCKS 地址（socks5://）", source: "system" });
    const s = getProxyStatus({ mode: "system", customUrl: "" });
    expect(s.unsupported).toMatch(/SOCKS/);
    expect(s.activeUrl).toBe("");
  });

  it("socks 生效时 activeUrl 要带出来（和 http 同构，面板不分叉）", () => {
    rememberProxyStateForTests({ kind: "socks", url: "socks5://127.0.0.1:7897", source: "custom" });
    expect(getProxyStatus({ mode: "custom", customUrl: "socks5://127.0.0.1:7897" })).toMatchObject({
      activeUrl: "socks5://127.0.0.1:7897",
      unsupported: "",
      source: "custom",
    });
  });

  it("生效时带出实际地址与来源", () => {
    rememberProxyStateForTests({ kind: "http", url: "http://127.0.0.1:7897", source: "custom" });
    const s = getProxyStatus({ mode: "custom", customUrl: "http://127.0.0.1:7897" });
    expect(s).toMatchObject({ mode: "custom", activeUrl: "http://127.0.0.1:7897", source: "custom", unsupported: "" });
  });
});

describe("applySystemProxy 可重复调用（热切换是本设置的前提）", () => {
  const fakeSession = { resolveProxy: async () => "DIRECT", setProxy: async () => {} } as never;

  it("二次调用不套娃：第二次的「直连档」仍是原始 dispatcher，不是上一次装的 Selective", async () => {
    const original = getGlobalDispatcher();
    try {
      await applySystemProxy(fakeSession, { mode: "custom", customUrl: "http://127.0.0.1:7897" });
      const first = getGlobalDispatcher() as unknown as { direct: unknown };
      await applySystemProxy(fakeSession, { mode: "custom", customUrl: "http://127.0.0.1:7898" });
      const second = getGlobalDispatcher() as unknown as { direct: unknown };
      expect(second.direct).toBe(first.direct);
      expect(second.direct).not.toBeInstanceOf(SelectiveProxyDispatcher);
    } finally {
      setGlobalDispatcher(original);
    }
  });

  it("切到「不用代理」必须把 dispatcher 还原——否则界面说直连、实际还在走代理（比不给设置更糟）", async () => {
    const original = getGlobalDispatcher();
    try {
      await applySystemProxy(fakeSession, { mode: "custom", customUrl: "http://127.0.0.1:7897" });
      expect(getGlobalDispatcher()).toBeInstanceOf(SelectiveProxyDispatcher);
      await applySystemProxy(fakeSession, { mode: "off", customUrl: "http://127.0.0.1:7897" });
      expect(getGlobalDispatcher()).not.toBeInstanceOf(SelectiveProxyDispatcher);
    } finally {
      setGlobalDispatcher(original);
    }
  });
});
