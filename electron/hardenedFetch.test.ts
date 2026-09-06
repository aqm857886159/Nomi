import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hardenedFetch, type ResolvedHostAddress } from "./hardenedFetch";
import { OutboundDestinationRefusedError, type OutboundEnvironment } from "./networkOutboundPolicy";
import { matchNomiErrorCode } from "./shared/nomiErrorCodes";

const NO_LOCAL_PROXY: OutboundEnvironment = { syntheticResolver: false, syntheticSample: "" };
const FAKE_IP_PROXY: OutboundEnvironment = { syntheticResolver: true, syntheticSample: "198.18.0.7" };

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
      createPinnedDispatcher: () => ({ close: async () => {} }) as never,
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
      createPinnedDispatcher: () => ({ close: async () => {} }) as never,
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
    const dispatcher = { close: vi.fn(async () => {}) };
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
    const dispatcher = { close: vi.fn(async () => {}) };
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
    const dispatcher = { close: vi.fn(async () => {}) };
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
    expect(dispatcher.close).toHaveBeenCalledTimes(1);
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
      createPinnedDispatcher: () => ({ close: async () => {} }) as never,
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
      createPinnedDispatcher: () => ({ close: async () => {} }) as never,
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
      createPinnedDispatcher: () => ({ close: async () => {} }) as never,
      fetch: fetchImpl,
    })).rejects.toThrow(/redirect/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
