import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { Dispatcher } from "undici";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPinnedDispatcher,
  hardenedFetch,
  hardenedFetchDiagnostics,
  type HardenedFetchDependencies,
  type HardenedFetchOptions,
  type HardenedFetchResult,
  type ResolvedHostAddress,
} from "./hardenedFetch";
import { OutboundDestinationRefusedError, type OutboundEnvironment } from "./networkOutboundPolicy";
import { matchNomiErrorCode } from "./shared/nomiErrorCodes";
import { TestNetworkBlockedError } from "./testNetworkGuard";

const NO_LOCAL_PROXY: OutboundEnvironment = { syntheticResolver: false, syntheticSample: "" };
const FAKE_IP_PROXY: OutboundEnvironment = { syntheticResolver: true, syntheticSample: "198.18.0.7" };

/** DNS pinning 为单次请求建的连接池的替身：两种收尾都记下来，断言用的是哪一种。 */
function fakePinnedDispatcher() {
  return { close: vi.fn(async () => {}), destroy: vi.fn(async () => {}) };
}

/**
 * 断言「被我们自己的出站策略拒绝」时**只认结构与稳定码**，不认那句人话。
 * 旧断言写的是英文子串 `private/loopback` —— 那正是 nomiErrorCodes.ts 开篇批判的反模式：
 * 两端拿同一句人话当协议，人话一 i18n 化分类就断，而单测多半还绿。
 */
async function expectOutboundRefusal(
  run: Promise<unknown>,
  reason: OutboundDestinationRefusedError["reason"],
): Promise<void> {
  await expect(run).rejects.toBeInstanceOf(OutboundDestinationRefusedError);
  await run.catch((error: unknown) => {
    const refusal = error as OutboundDestinationRefusedError;
    expect(refusal.reason).toBe(reason);
    // 码必须随 message 穿透 IPC，渲染层才分得出「我们拒的」与「上游挂的」。
    expect(matchNomiErrorCode(refusal.message)).toBe("outbound-blocked");
  });
}

let server: http.Server;
let baseUrl = "";
let redirectedTargetRequests = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/view" });
      res.end();
      return;
    }
    if (req.url === "/view") redirectedTargetRequests += 1;
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(Buffer.from([1, 2, 3]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server?.close());

describe("hardenedFetch 私网边界", () => {
  it("test network mode blocks hardenedFetch before proxy or DNS dispatch", async () => {
    const previous = process.env.NOMI_TEST_NETWORK_GUARD;
    process.env.NOMI_TEST_NETWORK_GUARD = "1";
    const fetchImpl = vi.fn();
    try {
      await expect(hardenedFetch("https://raw.githubusercontent.com/example/prompts", {}, {
        fetch: fetchImpl,
        resolveHost: vi.fn(),
      })).rejects.toBeInstanceOf(TestNetworkBlockedError);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.NOMI_TEST_NETWORK_GUARD;
      else process.env.NOMI_TEST_NETWORK_GUARD = previous;
    }
  });

  it("默认继续拒绝 loopback", async () => {
    await expectOutboundRefusal(hardenedFetch(`${baseUrl}/view`), "private-host");
  });

  it("只允许显式配置的精确 origin", async () => {
    await expect(hardenedFetch(`${baseUrl}/view`, { allowedPrivateOrigins: [baseUrl] })).resolves.toMatchObject({
      status: 200,
      contentType: "image/png",
    });
    await expectOutboundRefusal(
      hardenedFetch(`${baseUrl}/view`, { allowedPrivateOrigins: ["http://127.0.0.1:1"] }),
      "private-host",
    );
  });

  it("私网显式授权仍在第一跳拒绝重定向，不访问跳转目标", async () => {
    redirectedTargetRequests = 0;
    await expect(
      hardenedFetch(`${baseUrl}/redirect`, { allowedPrivateOrigins: [baseUrl] }),
    ).rejects.toThrow(/redirect/i);
    expect(redirectedTargetRequests).toBe(0);
  });

  it("fake-ip 代理下取片走得通：解析进 198.18/15 也照常下载（这正是 2026-09-06 取不回成片的那一格）", async () => {
    const resolveHost = vi.fn(async () => [{ address: "198.18.0.140", family: 4 as const }]);
    const fetchImpl = vi.fn(async () => new Response(Buffer.from([7, 7, 7]), {
      status: 200,
      headers: { "Content-Type": "video/mp4" },
    }));
    await expect(hardenedFetch("https://api.apimart.ai/result.mp4", {}, {
      resolveHost,
      createPinnedDispatcher: () => fakePinnedDispatcher() as never,
      fetch: fetchImpl,
      isApplicationProxyActive: () => false,
      readOutboundEnvironment: async () => FAKE_IP_PROXY,
    })).resolves.toMatchObject({ status: 200, contentType: "video/mp4" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("【阴性对照】没有本地代理证据时，同一次取片仍被拒——放宽必须有阳性证据", async () => {
    const fetchImpl = vi.fn();
    await expectOutboundRefusal(hardenedFetch("https://api.apimart.ai/result.mp4", {}, {
      resolveHost: async () => [{ address: "198.18.0.140", family: 4 }],
      createPinnedDispatcher: () => fakePinnedDispatcher() as never,
      fetch: fetchImpl,
      isApplicationProxyActive: () => false,
      readOutboundEnvironment: async () => NO_LOCAL_PROXY,
    }), "private-address");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects DNS resolutions that include metadata/private addresses", async () => {
    const fetchImpl = vi.fn();
    await expectOutboundRefusal(hardenedFetch("https://media.example.test/a.png", {}, {
      resolveHost: async () => [{ address: "169.254.169.254", family: 4 }],
      fetch: fetchImpl,
      readOutboundEnvironment: async () => FAKE_IP_PROXY,
    }), "private-address");
    // fake-ip 放宽**没有**顺手放开云元数据段：这一条是那次放宽的安全边界，翻红即回归。
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("已确认应用代理时不在本机解析公网 CDN，让代理侧解析 fake-IP", async () => {
    const resolveHost = vi.fn(async () => [{ address: "198.18.0.93", family: 4 as const }]);
    const dispatcher = fakePinnedDispatcher();
    const fetchImpl = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeUndefined();
      return new Response(Buffer.from([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });

    await expect(hardenedFetch("https://media.example.test/a.png", {}, {
      resolveHost,
      createPinnedDispatcher: vi.fn(() => dispatcher as never),
      fetch: fetchImpl,
      isApplicationProxyActive: () => true,
    })).resolves.toMatchObject({ status: 200 });
    expect(resolveHost).not.toHaveBeenCalled();
    expect(dispatcher.close).not.toHaveBeenCalled();
    expect(dispatcher.destroy).not.toHaveBeenCalled();
  });

  // 上面那条证明的是「代理生效时不拿本机解析结果当判据」。下面两条钉住它**不等于「不判」**。
  // 说准一点：上一轮名字层也是判的，只是判据长在 hardenedFetch 自己身上（第二个 owner），
  // 而「代理生效」这个条件写在调用点。判据搬进 policy 之后，这两条守的是**搬家没搬丢**——
  // 谁要是把 `if (route === "proxy") return allowed` 写进 owner，这里就该红。
  it("应用代理生效时**仍然**问策略：私网字面量照拦（代理不是绕过分类的通行证）", async () => {
    const resolveHost = vi.fn();
    const fetchImpl = vi.fn();
    await expectOutboundRefusal(hardenedFetch("http://169.254.169.254/latest/meta-data/", {}, {
      resolveHost: resolveHost as never,
      fetch: fetchImpl,
      isApplicationProxyActive: () => true,
    }), "private-host");
    // 名字层就定案了：既没有解析，也没有发请求。
    expect(resolveHost).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("单供应商显式 dispatcher 同样不是通行证：私网字面量照拦", async () => {
    const fetchImpl = vi.fn();
    await expectOutboundRefusal(hardenedFetch("http://10.0.0.5/result.mp4", {
      dispatcher: { close: async () => {} } as never,
    }, {
      fetch: fetchImpl,
      isApplicationProxyActive: () => false,
    }), "private-host");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("等待应用代理提交完成后才决定 DNS 路径，避免启动竞态把代理 fake-IP 当私网", async () => {
    let routeReady = false;
    const waitForApplicationRoute = vi.fn(async () => { routeReady = true; });
    const resolveHost = vi.fn(async () => [{ address: "198.18.0.93", family: 4 as const }]);
    const fetchImpl = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(routeReady).toBe(true);
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeUndefined();
      return new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } });
    });

    await expect(hardenedFetch("https://media.example.test/boot.png", {}, {
      resolveHost,
      fetch: fetchImpl,
      isApplicationProxyActive: () => routeReady,
      waitForApplicationRoute,
    })).resolves.toMatchObject({ status: 200 });
    expect(waitForApplicationRoute).toHaveBeenCalledOnce();
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it("应用代理切换回直连后重新启用 DNS pinning", async () => {
    const useApplicationProxy = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const resolveHost = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const dispatcher = fakePinnedDispatcher();
    const fetchImpl = vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname === "/a.png") {
        expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeUndefined();
        return new Response(null, { status: 302, headers: { Location: "/final.png" } });
      }
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBe(dispatcher);
      return new Response(Buffer.from([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });

    await expect(hardenedFetch("https://media.example.test/a.png", {}, {
      resolveHost,
      createPinnedDispatcher: vi.fn(() => dispatcher as never),
      fetch: fetchImpl,
      isApplicationProxyActive: useApplicationProxy,
    })).resolves.toMatchObject({ status: 200 });
    expect(resolveHost).toHaveBeenCalledTimes(1);
  });

  it("pins the validated DNS answer so fetch cannot resolve the hostname a second time", async () => {
    const resolveHost = vi.fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const dispatcher = fakePinnedDispatcher();
    const createPinnedDispatcher = vi.fn(() => dispatcher as never);
    const fetchImpl = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBe(dispatcher);
      return new Response(Buffer.from([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });

    await expect(hardenedFetch("https://media.example.test/a.png", {}, {
      resolveHost,
      createPinnedDispatcher,
      fetch: fetchImpl,
    })).resolves.toMatchObject({ status: 200 });
    expect(resolveHost).toHaveBeenCalledTimes(1);
    expect(createPinnedDispatcher).toHaveBeenCalledWith("media.example.test", [{ address: "93.184.216.34", family: 4 }]);
    // 这次请求专用的连接池用 destroy 收尾（不等任何在途 body），绝不走「优雅关闭」——
    // close() 会等一个被拒掉、没人读的 body 读完，那正是 2026-09-28 节点永远停在「正在存到你电脑上」的挂点。
    expect(dispatcher.destroy).toHaveBeenCalledTimes(1);
    expect(dispatcher.close).not.toHaveBeenCalled();
  });

  it("revalidates and repins every public redirect hop", async () => {
    const resolveHost = vi.fn(async (hostname: string): Promise<ResolvedHostAddress[]> => hostname === "one.example.test"
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "169.254.169.254", family: 4 }]);
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://two.example.test/secret" },
    }));

    await expectOutboundRefusal(hardenedFetch("https://one.example.test/start", {}, {
      resolveHost,
      createPinnedDispatcher: () => fakePinnedDispatcher() as never,
      fetch: fetchImpl,
    }), "private-address");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolveHost).toHaveBeenCalledTimes(2);
  });

  it("strips standard and declared secret headers before an explicitly allowed cross-origin redirect", async () => {
    const seenHeaders: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (url: URL, init?: RequestInit) => {
      seenHeaders.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return url.hostname === "one.example.test"
        ? new Response(null, { status: 302, headers: { Location: "https://two.example.test/final" } })
        : new Response(Buffer.from([1]), { status: 200, headers: { "Content-Type": "image/png" } });
    });
    await hardenedFetch("https://one.example.test/start", {
      allowRedirect: true,
      headers: {
        Authorization: "Bearer secret",
        "Proxy-Authorization": "Basic secret",
        Cookie: "session=secret",
        "X-Provider-Secret": "secret",
        "X-Public": "keep",
      },
      sensitiveHeaders: ["X-Provider-Secret"],
    }, {
      resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
      createPinnedDispatcher: () => fakePinnedDispatcher() as never,
      fetch: fetchImpl,
    });
    expect(seenHeaders[0]).toMatchObject({ authorization: "Bearer secret", cookie: "session=secret", "x-provider-secret": "secret" });
    expect(seenHeaders[1]).toEqual({ "x-public": "keep" });
  });

  it("rejects redirects by default when a request carries credentials", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://two.example.test/final" } }));
    await expect(hardenedFetch("https://one.example.test/start", {
      headers: { Authorization: "Bearer secret" },
    }, {
      resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
      createPinnedDispatcher: () => fakePinnedDispatcher() as never,
      fetch: fetchImpl,
    })).rejects.toThrow(/redirect/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 存活性契约矩阵（2026-09-28「生成完了却一直停在『正在存到你电脑上』」）。
//
// 真因：直连路由上，响应头一到就被我们自己拒掉（状态码 ≥400 / 类型不在白名单 / 声明超上限）时，
// 以前不丢 body 就抛错，收尾又 `await` 这次请求专用连接池的「优雅关闭」——它要等那个没人读的 body 读完，
// 永远等不到。上面那些单测全是几字节的 body，小于流缓冲、会被一口气收进来，所以挂死从来测不出。
//
// 这里是真 socket、真 undici、2MiB 的 body（调查实测 12KB 不挂、16KB 起挂），三种路由 × 六种响应，
// 每一格断两件事：① 在「本次时限 + 余量」内落定（成功或报错），不许悬着；② 被拒的响应把连接还回去
// （服务端看得见 socket 关了）——共享线路（系统代理）与供应商单配线路的连接池不归 hardenedFetch 拆，
// 那两条路上唯一能释放连接的就是「丢掉 body」。把修复改回原样，直连那几格会挂成 hung、另两条路那几格会漏连接。
// ─────────────────────────────────────────────────────────────────────────────

const MATRIX_HOST = "media.liveness.test";
const MATRIX_PUBLIC_ADDRESS: ResolvedHostAddress = { address: "93.184.216.34", family: 4 };
const LOOPBACK: ResolvedHostAddress[] = [{ address: "127.0.0.1", family: 4 }];
/** 远大于流缓冲：比缓冲小的 body 会被一口气收进来，那种夹具永远测不出挂死。 */
const MATRIX_BODY = Buffer.alloc(2 * 1024 * 1024, 0x41);
const MATRIX_MAX_BYTES = 4 * 1024 * 1024;
/** 本次请求自己的总时限。每一格都必须在它 + 余量之内落定。 */
const MATRIX_TIMEOUT_MS = 1_500;
/** 余量留给满载的 CI：修好之后，被拒的响应是毫秒级报错；放宽只为不在忙机器上假红。 */
const MATRIX_MARGIN_MS = 4_000;
const MEDIA_TYPES = ["image/", "video/", "audio/", "application/octet-stream"];

type Settled =
  | { kind: "resolved"; value: HardenedFetchResult }
  | { kind: "rejected"; error: Error }
  | { kind: "hung" };

/** 在观察窗内看它有没有落定；窗口到了还悬着 = hung（这正是要抓的那种失败）。 */
function settleOrHang(run: Promise<HardenedFetchResult>, windowMs: number): Promise<Settled> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<Settled>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "hung" }), windowMs);
  });
  return Promise.race<Settled>([
    run.then((value) => ({ kind: "resolved", value }), (error: Error) => ({ kind: "rejected", error })),
    hung,
  ]).finally(() => clearTimeout(timer));
}

function closedWithin(socketClosed: Promise<void>, windowMs: number): Promise<"closed" | "still-open"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = new Promise<"still-open">((resolve) => {
    timer = setTimeout(() => resolve("still-open"), windowMs);
  });
  return Promise.race([socketClosed.then(() => "closed" as const), open]).finally(() => clearTimeout(timer));
}

const OPAQUE_BODY = Buffer.alloc(2 * 1024 * 1024, 0x42);
const TRICKLE_CHUNK = 64 * 1024;
const served = new Map<string, { socketClosed: Promise<void> }>();
const serverTimers = new Set<ReturnType<typeof setInterval>>();
let matrixServer: http.Server;
let matrixPort = 0;
let applicationRoute: Dispatcher;

function trackSocket(cell: string, socket: Socket): void {
  served.set(cell, {
    socketClosed: new Promise<void>((resolve) => {
      if (socket.destroyed) resolve();
      else socket.once("close", () => resolve());
    }),
  });
}

function serveMatrix(req: http.IncomingMessage, res: http.ServerResponse): void {
  const target = new URL(req.url || "/", "http://matrix.invalid");
  trackSocket(target.searchParams.get("cell") || target.pathname, req.socket);
  const media = { "Content-Type": "image/png", "Content-Length": MATRIX_BODY.length };
  switch (target.pathname) {
    case "/ok":
      res.writeHead(200, media).end(MATRIX_BODY);
      return;
    case "/http-403":
      res.writeHead(403, { "Content-Type": "application/xml", "Content-Length": MATRIX_BODY.length }).end(MATRIX_BODY);
      return;
    case "/bad-type":
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": MATRIX_BODY.length }).end(MATRIX_BODY);
      return;
    case "/declared-too-large":
      // 声明超上限，body 给到一部分就不再给（也不收尾）：拒绝发生在读 body 之前。
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": MATRIX_MAX_BYTES * 2 });
      res.write(MATRIX_BODY);
      return;
    case "/stalled-body":
      // 头和第一块 body 到了，然后连接开着、一个字节都不再来（CDN 在客户端零窗口时常这样挂着）。
      res.writeHead(200, media);
      res.write(MATRIX_BODY.subarray(0, TRICKLE_CHUNK));
      return;
    case "/server-disconnect":
      res.writeHead(200, media);
      res.write(MATRIX_BODY.subarray(0, TRICKLE_CHUNK));
      setTimeout(() => req.socket.destroy(), 20);
      return;
    case "/binary-octet":
      res.writeHead(200, { "Content-Type": "binary/octet-stream", "Content-Length": OPAQUE_BODY.length }).end(OPAQUE_BODY);
      return;
    case "/no-type":
      res.writeHead(200, { "Content-Length": OPAQUE_BODY.length }).end(OPAQUE_BODY);
      return;
    case "/chunked":
      // 不给 Content-Length：先 write 再 end，Node 走分块传输。
      res.writeHead(200, { "Content-Type": "image/png" });
      res.write(MATRIX_BODY.subarray(0, TRICKLE_CHUNK));
      res.end();
      return;
    case "/trickle": {
      // 线路活着但很慢：每 100ms 一小块，空闲时限永远不触发，只有总上限拦得住。
      res.writeHead(200, media);
      let offset = 0;
      const timer = setInterval(() => {
        if (res.destroyed || offset >= MATRIX_BODY.length) {
          clearInterval(timer);
          serverTimers.delete(timer);
          if (!res.destroyed) res.end();
          return;
        }
        res.write(MATRIX_BODY.subarray(offset, offset + TRICKLE_CHUNK));
        offset += TRICKLE_CHUNK;
      }, 100);
      serverTimers.add(timer);
      return;
    }
    default:
      res.writeHead(404).end();
  }
}

beforeAll(async () => {
  matrixServer = http.createServer(serveMatrix);
  // 服务端自己不掐连接：挂死要靠客户端自己走出来，不能让服务端的超时替它收场。
  matrixServer.keepAliveTimeout = 0;
  matrixServer.requestTimeout = 0;
  matrixServer.headersTimeout = 0;
  matrixServer.timeout = 0;
  await new Promise<void>((resolve) => matrixServer.listen(0, "127.0.0.1", resolve));
  matrixPort = (matrixServer.address() as AddressInfo).port;
  // 「系统代理」这条路的连接池属于整个应用、被所有请求共用——hardenedFetch 不能也不该拆它。
  applicationRoute = createPinnedDispatcher(MATRIX_HOST, LOOPBACK);
});

afterAll(async () => {
  for (const timer of serverTimers) clearInterval(timer);
  matrixServer?.closeAllConnections();
  matrixServer?.close();
  await applicationRoute?.destroy().catch(() => undefined);
});

type MatrixRoute = "direct" | "system-proxy" | "provider-route";
type RouteFixture = { options: HardenedFetchOptions; dependencies: HardenedFetchDependencies; release: () => void };

function directDependencies(): HardenedFetchDependencies {
  return {
    // 公网形态的名字，经注入解析成公网地址 → 出站策略放行并按解析结果建「这次请求专用」的连接池，
    // 连接池再被钉到本机夹具上。与生产直连路由同一段代码，只是 DNS 与落点换成了本机。
    resolveHost: async () => [MATRIX_PUBLIC_ADDRESS],
    createPinnedDispatcher: (hostname) => createPinnedDispatcher(hostname, LOOPBACK),
    readOutboundEnvironment: async () => NO_LOCAL_PROXY,
    isApplicationProxyActive: () => false,
  };
}

const ROUTES: Record<MatrixRoute, () => RouteFixture> = {
  direct: () => ({ options: {}, dependencies: directDependencies(), release: () => {} }),
  "system-proxy": () => ({
    options: {},
    dependencies: {
      resolveHost: async () => {
        throw new Error("系统代理生效时不该在本机解析");
      },
      readOutboundEnvironment: async () => NO_LOCAL_PROXY,
      isApplicationProxyActive: () => true,
      fetch: (input, init) => globalThis.fetch(input, { ...init, dispatcher: applicationRoute } as RequestInit),
    },
    release: () => {},
  }),
  "provider-route": () => {
    // 调用方为这一次取回建的供应商线路（providerMediaFetch 的形状）：用完它自己 close，不归 hardenedFetch 拆。
    const providerRoute = createPinnedDispatcher(MATRIX_HOST, LOOPBACK);
    return {
      options: { dispatcher: providerRoute },
      dependencies: { readOutboundEnvironment: async () => NO_LOCAL_PROXY, isApplicationProxyActive: () => false },
      release: () => {
        void providerRoute.close().catch(() => undefined);
      },
    };
  },
};

type MatrixResponse = "ok" | "http-403" | "bad-type" | "declared-too-large" | "stalled-body" | "server-disconnect";
const EXPECTED: Record<MatrixResponse, { settles: "resolved" | "rejected"; message?: RegExp; releasesConnection: boolean }> = {
  ok: { settles: "resolved", releasesConnection: false },
  "http-403": { settles: "rejected", message: /HTTP 403/, releasesConnection: true },
  "bad-type": { settles: "rejected", message: /Unsupported content type/, releasesConnection: true },
  "declared-too-large": { settles: "rejected", message: /too large/, releasesConnection: true },
  "stalled-body": { settles: "rejected", message: /timed out/, releasesConnection: true },
  "server-disconnect": { settles: "rejected", releasesConnection: true },
};

const MATRIX_CELLS = (Object.keys(ROUTES) as MatrixRoute[]).flatMap((route) =>
  (Object.keys(EXPECTED) as MatrixResponse[]).map((response) => [route, response] as const));

function matrixUrl(pathname: string, cell: string): string {
  return `http://${MATRIX_HOST}:${matrixPort}${pathname}?cell=${encodeURIComponent(cell)}`;
}

describe("hardenedFetch 存活性契约矩阵：三种路由 × 六种响应，每一格都在「时限 + 余量」内落定", () => {
  it.each(MATRIX_CELLS)("%s × %s", async (route, response) => {
    const fixture = ROUTES[route]();
    const cell = `${route}:${response}`;
    try {
      const outcome = await settleOrHang(
        hardenedFetch(matrixUrl(`/${response}`, cell), {
          timeoutMs: MATRIX_TIMEOUT_MS,
          maxBytes: MATRIX_MAX_BYTES,
          allowContentTypes: MEDIA_TYPES,
          ...fixture.options,
        }, fixture.dependencies),
        MATRIX_TIMEOUT_MS + MATRIX_MARGIN_MS,
      );
      const expected = EXPECTED[response];
      expect(outcome.kind).toBe(expected.settles);
      if (outcome.kind === "resolved") expect(outcome.value.bytes.length).toBe(MATRIX_BODY.length);
      if (outcome.kind === "rejected" && expected.message) expect(outcome.error.message).toMatch(expected.message);
      if (expected.releasesConnection) {
        const request = served.get(cell);
        expect(request, "服务端没有收到这一格的请求").toBeDefined();
        expect(await closedWithin(request!.socketClosed, MATRIX_MARGIN_MS)).toBe("closed");
      }
    } finally {
      fixture.release();
    }
  });
});

describe("hardenedFetch 类型白名单：「没说是什么」的字节不在类型这一步拒，交给落盘边界按字节判", () => {
  it.each([
    ["binary/octet-stream（S3 缺省类型）", "/binary-octet", "application/octet-stream"],
    ["缺 Content-Type", "/no-type", ""],
  ])("%s：收 application/octet-stream 的调用方照收", async (_label, pathname, reported) => {
    const result = await hardenedFetch(matrixUrl(pathname, `opaque${pathname}`), {
      timeoutMs: MATRIX_TIMEOUT_MS + MATRIX_MARGIN_MS,
      maxBytes: MATRIX_MAX_BYTES,
      allowContentTypes: MEDIA_TYPES,
    }, directDependencies());
    // binary/octet-stream 统一报成下游只认的那一种写法；缺类型仍是空串（下游各自按「没有声明」处理）。
    expect(result.contentType).toBe(reported);
    expect(result.bytes.length).toBe(OPAQUE_BODY.length);
  });

  it("白名单里没有 application/octet-stream 的调用方照旧拒，而且把连接还回去", async () => {
    const cell = "opaque-strict";
    const outcome = await settleOrHang(hardenedFetch(matrixUrl("/binary-octet", cell), {
      timeoutMs: MATRIX_TIMEOUT_MS,
      maxBytes: MATRIX_MAX_BYTES,
      allowContentTypes: ["image/png"],
    }, directDependencies()), MATRIX_TIMEOUT_MS + MATRIX_MARGIN_MS);
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") expect(outcome.error.message).toMatch(/Unsupported content type: binary\/octet-stream/);
    expect(await closedWithin(served.get(cell)!.socketClosed, MATRIX_MARGIN_MS)).toBe("closed");
  });
});

describe("hardenedFetch 时限：空闲时限管「线路断了」，总上限随声明的大小放宽", () => {
  it("响应头之后一个字节都不再来 → 按空闲时限报「停住了」，不陪到总时限", async () => {
    const outcome = await settleOrHang(hardenedFetch(matrixUrl("/stalled-body", "idle"), {
      timeoutMs: 60_000,
      idleTimeoutMs: 400,
      maxBytes: MATRIX_MAX_BYTES,
      allowContentTypes: MEDIA_TYPES,
    }, directDependencies()), 400 + MATRIX_MARGIN_MS);
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") expect(outcome.error.message).toMatch(/stalled: no data for 400ms/);
  });

  it("总上限按响应头声明的大小重算：线路一直在出字节（空闲时限不触发），到重算后的上限就停", async () => {
    const declaredSizes: Array<number | null> = [];
    const outcome = await settleOrHang(hardenedFetch(matrixUrl("/trickle", "size-scaled"), {
      timeoutMs: 60_000,
      idleTimeoutMs: 2_000,
      timeoutForDeclaredSize: (declaredBytes) => {
        declaredSizes.push(declaredBytes);
        return 700;
      },
      maxBytes: MATRIX_MAX_BYTES,
      allowContentTypes: MEDIA_TYPES,
    }, directDependencies()), 700 + MATRIX_MARGIN_MS);
    expect(declaredSizes).toEqual([MATRIX_BODY.length]);
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") expect(outcome.error.message).toMatch(/timed out after 700ms/);
  });

  it("分块传输没有声明大小 → 重算收到 null（由预算按字节上限那一档给）", async () => {
    const declaredSizes: Array<number | null> = [];
    const result = await hardenedFetch(matrixUrl("/chunked", "chunked"), {
      timeoutMs: MATRIX_TIMEOUT_MS + MATRIX_MARGIN_MS,
      timeoutForDeclaredSize: (declaredBytes) => {
        declaredSizes.push(declaredBytes);
        return MATRIX_TIMEOUT_MS + MATRIX_MARGIN_MS;
      },
      maxBytes: MATRIX_MAX_BYTES,
      allowContentTypes: MEDIA_TYPES,
    }, directDependencies());
    expect(declaredSizes).toEqual([null]);
    expect(result.bytes.length).toBe(TRICKLE_CHUNK);
  });
});

describe("hardenedFetch 失败诊断：取回失败日志要的形状挂在错误上", () => {
  it("被拒的响应带上主机 / 路由 / 状态码 / 类型 / 声明大小 / 已收字节 / 耗时（不含 URL 与查询串）", async () => {
    const error = await hardenedFetch(matrixUrl("/http-403", "diagnostics"), {
      timeoutMs: MATRIX_TIMEOUT_MS + MATRIX_MARGIN_MS,
      maxBytes: MATRIX_MAX_BYTES,
      allowContentTypes: MEDIA_TYPES,
    }, directDependencies()).catch((caught: unknown) => caught);
    const diagnostics = hardenedFetchDiagnostics(error);
    expect(diagnostics).toMatchObject({
      host: MATRIX_HOST,
      route: "direct",
      status: 403,
      contentType: "application/xml",
      declaredBytes: MATRIX_BODY.length,
      receivedBytes: 0,
    });
    expect(diagnostics?.elapsedMs).toEqual(expect.any(Number));
    expect(JSON.stringify(diagnostics)).not.toContain("cell=");
  });

  it("走系统代理与供应商单配线路时，路由如实记成那一条", async () => {
    const viaProxy = ROUTES["system-proxy"]();
    const proxyError = await hardenedFetch(matrixUrl("/http-403", "diagnostics-proxy"), {
      timeoutMs: MATRIX_TIMEOUT_MS + MATRIX_MARGIN_MS, allowContentTypes: MEDIA_TYPES, ...viaProxy.options,
    }, viaProxy.dependencies).catch((caught: unknown) => caught);
    expect(hardenedFetchDiagnostics(proxyError)?.route).toBe("system-proxy");
    const viaProvider = ROUTES["provider-route"]();
    try {
      const providerError = await hardenedFetch(matrixUrl("/http-403", "diagnostics-provider"), {
        timeoutMs: MATRIX_TIMEOUT_MS + MATRIX_MARGIN_MS, allowContentTypes: MEDIA_TYPES, ...viaProvider.options,
      }, viaProvider.dependencies).catch((caught: unknown) => caught);
      expect(hardenedFetchDiagnostics(providerError)?.route).toBe("provider-route");
    } finally {
      viaProvider.release();
    }
  });
});
