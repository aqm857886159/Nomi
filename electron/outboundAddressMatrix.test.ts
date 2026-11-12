/**
 * 出站策略的**类测试矩阵**（2026-11-12，方向复盘 docs/engineering/direction-checks/2026-11-12-outbound-guard.md）。
 *
 * 这一类问题反复回来，是因为每次只修「撞到的那一格」：先是 v4 198.18、后来是 v6 合成段、再后来是
 * 「先开 Nomi 后开代理」探测缓存过期、再后来是局域网接入地址提交能过取回不过。这里把整类写成格子：
 *
 *   ① 取回侧：解析结果（v4 合成 / v6 合成 / 混合 / 真内网 / 真公网）× 探测状态（确认 / 没确认 / 先没确认、重探后确认）
 *   ② 不变量：**提交放行了某个目的地，取回同一家的产物必须过**（否则就是「扣了钱取不回」）。
 *      接入地址覆盖公网 https、http 自建中转、内网 IP、局域网主机名、本机 ComfyUI、链路本地。
 *   ③ 跳转：私网字面量声明的那一跳不跟跳转；公网接入地址照常能跳到 CDN，跳转后不再享受声明例外。
 *
 * 零网络：DNS、探针、传输全部注入；探针走真的 `readOutboundEnvironment`（只换掉底下那次 DNS 查询），
 * 所以「重探」「v6 证据」这两件事是真代码在跑，不是夹具替它答。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { hardenedFetch, type ResolvedHostAddress } from "./hardenedFetch";
import {
  authorizeOutboundDestination,
  readOutboundEnvironment,
  setSyntheticResolverProbeForTests,
} from "./networkOutboundPolicy";
import { authorizeSubmitDestination, setSubmitOutboundDepsForTests, trustedRetrievalOrigin } from "./vendor/vendorOutboundGuard";

type Family = 4 | 6;
const RESOLUTIONS: Record<string, { addresses: ResolvedHostAddress[]; probeFamily: Family; reserved: boolean }> = {
  "v4 合成（198.18/15）": { addresses: [{ address: "198.18.0.140", family: 4 }], probeFamily: 4, reserved: true },
  "v6 合成（2001:2::/48）": { addresses: [{ address: "2001:2::1:8c", family: 6 }], probeFamily: 6, reserved: true },
  "v6 合成（fc00::/7）": { addresses: [{ address: "fdfe:dcba:9876::2", family: 6 }], probeFamily: 6, reserved: true },
  "混合（公网 + 合成）": {
    addresses: [{ address: "93.184.216.34", family: 4 }, { address: "198.18.0.5", family: 4 }],
    probeFamily: 4,
    reserved: true,
  },
  "真内网（192.168）": { addresses: [{ address: "192.168.1.20", family: 4 }], probeFamily: 4, reserved: true },
  "真公网": { addresses: [{ address: "93.184.216.34", family: 4 }], probeFamily: 4, reserved: false },
};

type ProbeState = "确认" | "没确认" | "先没确认、重探后确认";
const PROBE_STATES: readonly ProbeState[] = ["确认", "没确认", "先没确认、重探后确认"];

/** 驱动真探针底下那次 DNS 查询；代理答的合成地址与这一行同一个地址族（只开 v6 的代理只给 v6 证据）。 */
function seedProbe(state: ProbeState, family: Family): { calls: () => number } {
  let calls = 0;
  const synthetic = family === 6 ? { address: "2001:2::5", family: 6 as const } : { address: "198.18.0.7", family: 4 as const };
  setSyntheticResolverProbeForTests(async () => {
    calls += 1;
    const proxyOn = state === "确认" || (state === "先没确认、重探后确认" && calls > PROBE_TLD_COUNT);
    if (!proxyOn) throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    return [synthetic];
  });
  return { calls: () => calls };
}
/** 一次探测最多问两个 TLD（.com / .net）：第一轮两个都 NXDOMAIN 才算「没确认」。 */
const PROBE_TLD_COUNT = 2;

function okResponse(): Response {
  return new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { "Content-Type": "video/mp4" } });
}
function fakeDispatcher() {
  return { close: vi.fn(async () => {}), destroy: vi.fn(async () => {}) } as never;
}

afterEach(() => {
  setSyntheticResolverProbeForTests(null);
  setSubmitOutboundDepsForTests(null);
});

describe("① 取回侧：解析结果 × 探测状态（直连，供应商响应里带回来的 CDN 名字）", () => {
  for (const [label, row] of Object.entries(RESOLUTIONS)) {
    for (const state of PROBE_STATES) {
      const expectAllowed = !row.reserved || state !== "没确认";
      it(`${label} × ${state} → ${expectAllowed ? "放行" : "拒（private-address）"}`, async () => {
        seedProbe(state, row.probeFamily);
        const authorization = await authorizeOutboundDestination({
          url: new URL("https://cdn.vendor-media.example.com/out/v.mp4"),
          route: "direct",
          stage: "retrieval",
          readEnvironment: readOutboundEnvironment,
          resolve: async () => row.addresses,
        });
        if (expectAllowed) {
          expect(authorization.allowed).toBe(true);
        } else {
          expect(authorization).toMatchObject({ allowed: false, reason: "private-address" });
        }
      });
    }
  }

  it("先没确认、重探后确认：重探结论写回缓存，下一次不用再探", async () => {
    const probe = seedProbe("先没确认、重探后确认", 4);
    const ask = () => authorizeOutboundDestination({
      url: new URL("https://cdn.vendor-media.example.com/out/v.mp4"),
      route: "direct",
      stage: "retrieval",
      readEnvironment: readOutboundEnvironment,
      resolve: async () => [{ address: "198.18.0.140", family: 4 }],
    });
    await expect(ask()).resolves.toMatchObject({ allowed: true, basis: "synthetic-resolver" });
    const after = probe.calls();
    await expect(ask()).resolves.toMatchObject({ allowed: true, basis: "synthetic-resolver" });
    expect(probe.calls()).toBe(after);
  });

  it("名字层不受代理证据影响：URL 里直接写的内网 IP / localhost 在确认合成解析时照拒", async () => {
    seedProbe("确认", 4);
    for (const raw of ["http://192.168.1.20/v.mp4", "http://localhost:8080/v.mp4", "http://[fd00::1]/v.mp4", "http://169.254.169.254/x"]) {
      await expect(authorizeOutboundDestination({
        url: new URL(raw),
        route: "direct",
        stage: "retrieval",
        readEnvironment: readOutboundEnvironment,
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      })).resolves.toMatchObject({ allowed: false, reason: "private-host" });
    }
  });
});

const ENDPOINTS: Record<string, { baseUrl: string; resultPath: string }> = {
  "公网 https 供应商": { baseUrl: "https://api.vendor.example.com", resultPath: "/files/out.mp4" },
  "http 自建中转": { baseUrl: "http://relay.mystudio.example.com:3000", resultPath: "/files/out.mp4" },
  "内网 IP 接入地址": { baseUrl: "http://192.168.1.50:8000", resultPath: "/view?filename=out.mp4" },
  "局域网主机名接入地址": { baseUrl: "http://mypc.lan:8000", resultPath: "/view?filename=out.mp4" },
  "本机 ComfyUI": { baseUrl: "http://127.0.0.1:8188", resultPath: "/view?filename=out.png" },
  "链路本地（永远拒）": { baseUrl: "http://169.254.10.10", resultPath: "/out.mp4" },
};

describe("② 不变量：提交放行的目的地，取回同一家的产物必须过", () => {
  for (const [endpointLabel, endpoint] of Object.entries(ENDPOINTS)) {
    for (const [resolutionLabel, row] of Object.entries(RESOLUTIONS)) {
      for (const state of PROBE_STATES) {
        it(`${endpointLabel} × ${resolutionLabel} × ${state}`, async () => {
          seedProbe(state, row.probeFamily);
          setSubmitOutboundDepsForTests({
            resolve: async () => row.addresses,
            readEnvironment: readOutboundEnvironment,
            isApplicationProxyActive: () => false,
          });
          const vendor = { baseUrlHint: endpoint.baseUrl };
          const submitRefusal = await authorizeSubmitDestination({
            vendor,
            url: `${endpoint.baseUrl}/v1/tasks`,
            routedThroughProviderProxy: false,
          });
          const resultUrl = `${endpoint.baseUrl}${endpoint.resultPath}`;
          const fetchImpl = vi.fn(async () => okResponse());
          const retrieval = hardenedFetch(resultUrl, {
            allowedPrivateOrigins: [await trustedRetrievalOrigin(vendor, resultUrl)].filter((origin): origin is string => Boolean(origin)),
          }, {
            resolveHost: async () => row.addresses,
            createPinnedDispatcher: () => fakeDispatcher(),
            fetch: fetchImpl,
            isApplicationProxyActive: () => false,
            readOutboundEnvironment: readOutboundEnvironment,
          });
          if (submitRefusal === null) {
            await expect(retrieval, "提交放行了，取回却被拒：扣了钱取不回").resolves.toMatchObject({ status: 200 });
            expect(fetchImpl).toHaveBeenCalledTimes(1);
          } else {
            // 提交被拒的只应是链路本地那一行；取回同样拒，两侧口径一致。
            expect(endpointLabel).toBe("链路本地（永远拒）");
            await expect(retrieval).rejects.toThrow();
            expect(fetchImpl).not.toHaveBeenCalled();
          }
        });
      }
    }
  }

  it("保存的接入地址提交时不解析、不判地址（开着代理也照常发）", async () => {
    const resolve = vi.fn(async () => [{ address: "198.18.0.140", family: 4 as const }]);
    seedProbe("没确认", 4);
    setSubmitOutboundDepsForTests({ resolve, readEnvironment: readOutboundEnvironment, isApplicationProxyActive: () => false });
    await expect(authorizeSubmitDestination({
      vendor: { baseUrlHint: "https://api.vendor.example.com" },
      url: "https://api.vendor.example.com/v1/tasks",
      routedThroughProviderProxy: false,
    })).resolves.toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("【阴性对照】同主机换端口不是那个接入地址：内网字面量照拒", async () => {
    seedProbe("没确认", 4);
    setSubmitOutboundDepsForTests({ resolve: async () => [], readEnvironment: readOutboundEnvironment, isApplicationProxyActive: () => false });
    await expect(authorizeSubmitDestination({
      vendor: { baseUrlHint: "http://192.168.1.50:8000" },
      url: "http://192.168.1.50:9000/v1/tasks",
      routedThroughProviderProxy: false,
    })).resolves.toMatch(/outbound-blocked-submit/);
    await expect(trustedRetrievalOrigin({ baseUrlHint: "http://192.168.1.50:8000" }, "http://192.168.1.50:9000/x")).resolves.toBeUndefined();
  });
});

describe("③ 跳转语义", () => {
  it("私网字面量声明的那一跳不跟跳转（局域网后端不该把我们带去别处）", async () => {
    seedProbe("没确认", 4);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://cdn.example.com/v.mp4" } }));
    await expect(hardenedFetch("http://192.168.1.50:8000/view", { allowedPrivateOrigins: ["http://192.168.1.50:8000"] }, {
      resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
      createPinnedDispatcher: () => fakeDispatcher(),
      fetch: fetchImpl,
      isApplicationProxyActive: () => false,
      readOutboundEnvironment: readOutboundEnvironment,
    })).rejects.toThrow(/redirect/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("公网接入地址照常跳到 CDN；跳转后那一跳不再享受声明例外（解析进内网照拒）", async () => {
    seedProbe("没确认", 4);
    const hops: string[] = [];
    const fetchImpl = vi.fn(async (url: URL) => {
      hops.push(url.hostname);
      return url.hostname === "api.vendor.example.com"
        ? new Response(null, { status: 302, headers: { Location: "https://cdn.vendor-media.example.com/v.mp4" } })
        : okResponse();
    });
    const resolveHost = async (hostname: string): Promise<ResolvedHostAddress[]> =>
      hostname === "cdn.vendor-media.example.com" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "10.0.0.9", family: 4 }];
    await expect(hardenedFetch("https://api.vendor.example.com/files/v.mp4", { allowedPrivateOrigins: ["https://api.vendor.example.com"] }, {
      resolveHost,
      createPinnedDispatcher: () => fakeDispatcher(),
      fetch: fetchImpl,
      isApplicationProxyActive: () => false,
      readOutboundEnvironment: readOutboundEnvironment,
    })).resolves.toMatchObject({ status: 200 });
    expect(hops).toEqual(["api.vendor.example.com", "cdn.vendor-media.example.com"]);

    const backToDeclared = vi.fn(async (url: URL) => url.pathname === "/start"
      ? new Response(null, { status: 302, headers: { Location: "https://cdn.vendor-media.example.com/v.mp4" } })
      : okResponse());
    await expect(hardenedFetch("https://api.vendor.example.com/start", { allowedPrivateOrigins: ["https://api.vendor.example.com"] }, {
      resolveHost: async () => [{ address: "10.0.0.9", family: 4 }],
      createPinnedDispatcher: () => fakeDispatcher(),
      fetch: backToDeclared,
      isApplicationProxyActive: () => false,
      readOutboundEnvironment: readOutboundEnvironment,
    })).rejects.toMatchObject({ reason: "private-address" });
    expect(backToDeclared).toHaveBeenCalledTimes(1);
  });
});
