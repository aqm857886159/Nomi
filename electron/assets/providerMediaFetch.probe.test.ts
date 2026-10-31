import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createPinnedDispatcher, type HardenedFetchDependencies, type ResolvedHostAddress } from "../hardenedFetch";
import type { OutboundEnvironment } from "../networkOutboundPolicy";
import {
  REFERENCE_LINK_ALIVE_MEMO_MS,
  REFERENCE_LINK_MEMO_LIMIT,
  REFERENCE_LINK_PROBE_RANGE_BYTES,
} from "../shared/assets/providerMediaRetrievalBudget";

const logged = vi.hoisted(() => [] as Array<{ scope: string; event: string; fields?: Record<string, unknown> }>);
vi.mock("../logging/logger", () => ({
  logInfo: (scope: string, event: string, fields?: Record<string, unknown>) => { logged.push({ scope, event, fields }); },
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { probeProviderLink, resetProviderLinkProbes, type ProviderLinkVerdict } from "./providerMediaFetch";

// 试探的真函数 + 本机假服务。名字是公网形态，经注入解析成公网地址 → 出站策略放行并按解析结果建「这次请求专用」的连接池，
// 连接池再被钉到本机夹具上：与生产直连同一段代码，只是 DNS 与落点换成了本机（同 hardenedFetch.test 的存活性矩阵）。
const HOST = "cdn.probe.test";
const PUBLIC_ADDRESS: ResolvedHostAddress = { address: "93.184.216.34", family: 4 };
const LOOPBACK: ResolvedHostAddress[] = [{ address: "127.0.0.1", family: 4 }];
const NO_LOCAL_PROXY: OutboundEnvironment = { syntheticResolver: false, syntheticSample: "" };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const HTML_PAGE = Buffer.from("<!doctype html><html><body>Hotlinking is not allowed</body></html>");
const JSON_ERROR = Buffer.from('{"code":403,"message":"expired"}');

let server: http.Server;
let port = 0;
const hits = new Map<string, number>();
const requests: Array<{ path: string; headers: http.IncomingHttpHeaders }> = [];
let hangingSockets: Array<() => void> = [];

function serve(req: http.IncomingMessage, res: http.ServerResponse): void {
  const path = (req.url || "/").split("?")[0];
  hits.set(path, (hits.get(path) ?? 0) + 1);
  requests.push({ path, headers: req.headers });
  const body = (type: string, payload: Buffer, status = 200): void => { res.writeHead(status, { "Content-Type": type, "Content-Length": payload.length }).end(payload); };
  switch (path) {
    case "/range-206":
      res.writeHead(206, { "Content-Type": "image/png", "Content-Range": "bytes 0-15/2048", "Content-Length": PNG.length }).end(PNG);
      return;
    case "/ignores-range-large": {
      // 服务器不理 Range：整份大文件发过来（声明长度远超读取上限）。
      const big = Buffer.alloc(2 * 1024 * 1024, 0x41);
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": big.length });
      res.write(big.subarray(0, 64 * 1024));
      setTimeout(() => res.destroy(), 50);
      return;
    }
    case "/ignores-range-chunked":
      // 分块传输、没有声明长度，读到上限就该断。
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.write(Buffer.alloc(32 * 1024, 0x41));
      setTimeout(() => res.destroy(), 50);
      return;
    case "/octet-stream": return body("application/octet-stream", Buffer.concat([PNG, Buffer.alloc(64, 1)]));
    case "/octet-html": return body("application/octet-stream", HTML_PAGE);
    case "/no-type-json": return body("", JSON_ERROR);
    case "/html": return body("text/html; charset=utf-8", HTML_PAGE);
    case "/json": return body("application/json", JSON_ERROR);
    case "/text": return body("text/plain", Buffer.from("denied"));
    case "/xml": return body("application/xml", Buffer.from("<Error><Code>AccessDenied</Code></Error>"));
    case "/svg": return body("image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    case "/empty": return body("image/png", Buffer.alloc(0));
    case "/redirect-ok":
      res.writeHead(302, { Location: "/range-206" }).end();
      return;
    case "/redirect-403":
      res.writeHead(302, { Location: "/status-403" }).end();
      return;
    case "/big-404": {
      const page = Buffer.alloc(64 * 1024, 0x42);
      res.writeHead(404, { "Content-Type": "text/html", "Content-Length": page.length }).end(page);
      return;
    }
    case "/hang":
      hangingSockets.push(() => req.socket.destroy());
      return; // 不回话，也不关
    default: {
      const status = Number(path.replace("/status-", ""));
      if (Number.isInteger(status)) {
        res.writeHead(status, { "Content-Type": status >= 500 ? "text/html" : "application/xml" }).end("<Error/>");
        return;
      }
      res.writeHead(404).end();
    }
  }
}

beforeAll(async () => {
  server = http.createServer(serve);
  server.keepAliveTimeout = 0;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const destroy of hangingSockets) destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  // 单测不出网：测试网络闸开着，本次夹具的精确 origin 登记在册，别的主机一律被挡。
  vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1");
  vi.stubEnv("NOMI_TEST_NETWORK_FIXTURE_ORIGINS", `http://${HOST}:${port}`);
  resetProviderLinkProbes();
  logged.length = 0;
  hits.clear();
  requests.length = 0;
});

afterEach(() => {
  for (const destroy of hangingSockets) destroy();
  hangingSockets = [];
});

const deps = (overrides: Partial<HardenedFetchDependencies> = {}): HardenedFetchDependencies => ({
  resolveHost: async () => [PUBLIC_ADDRESS],
  createPinnedDispatcher: (hostname) => createPinnedDispatcher(hostname, LOOPBACK),
  readOutboundEnvironment: async () => NO_LOCAL_PROXY,
  isApplicationProxyActive: () => false,
  ...overrides,
});
const link = (path: string, query = "") => `http://${HOST}:${port}${path}${query}`;
const probe = (path: string, dependencies = deps()) => probeProviderLink(link(path), {}, dependencies);

describe("probeProviderLink：链接状态 → alive / dead / unknown", () => {
  const rows: Array<[string, string, ProviderLinkVerdict]> = [
    ["206 图（服务器认 Range）", "/range-206", "alive"],
    ["200 图，忽略 Range 并返回大文件（有声明长度）", "/ignores-range-large", "alive"],
    ["200 视频，忽略 Range，分块传输没有声明长度", "/ignores-range-chunked", "alive"],
    ["200 octet-stream，开头是图片字节", "/octet-stream", "alive"],
    ["200 image/svg+xml（媒体类型，开头是 <，仍是图）", "/svg", "alive"],
    ["跳转到 200 图", "/redirect-ok", "alive"],
    ["跳转到 403", "/redirect-403", "dead"],
    ["200 HTML 页面", "/html", "dead"],
    ["200 JSON", "/json", "dead"],
    ["200 纯文本", "/text", "dead"],
    ["200 XML 错误体", "/xml", "dead"],
    ["200 octet-stream，开头是网页", "/octet-html", "dead"],
    ["200 没声明类型，开头是 {", "/no-type-json", "dead"],
    ["404 大错误页（超过读取上限，靠响应头判）", "/big-404", "dead"],
    ["400", "/status-400", "dead"],
    ["401", "/status-401", "dead"],
    ["403", "/status-403", "dead"],
    ["404", "/status-404", "dead"],
    ["410", "/status-410", "dead"],
    ["408 请求超时", "/status-408", "unknown"],
    ["425 太早", "/status-425", "unknown"],
    ["429 限流", "/status-429", "unknown"],
    ["416 Range 不可满足", "/status-416", "unknown"],
    ["500", "/status-500", "unknown"],
    ["503", "/status-503", "unknown"],
    ["200 空 body（说不清）", "/empty", "unknown"],
  ];

  it.each(rows)("%s → %s", async (_label, path, expected) => {
    expect(await probe(path)).toBe(expected);
  });

  it("请求带 Range、不带任何 Authorization / Cookie（不带 Key）", async () => {
    await probe("/range-206");
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.range).toBe(`bytes=0-${REFERENCE_LINK_PROBE_RANGE_BYTES - 1}`);
    expect(requests[0].headers.authorization).toBeUndefined();
    expect(requests[0].headers.cookie).toBeUndefined();
  });

  it("连接被拒 → unknown（本机网络不通时模型那边多半仍拉得到，不能当失效）", async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    vi.stubEnv("NOMI_TEST_NETWORK_FIXTURE_ORIGINS", `http://${HOST}:${deadPort}`);
    expect(await probeProviderLink(`http://${HOST}:${deadPort}/x`, {}, deps())).toBe("unknown");
  });

  it("出站策略拒绝（解析到内网地址）→ unknown，和今天一样照发", async () => {
    const privateResolver = deps({ resolveHost: async () => [{ address: "10.0.0.7", family: 4 }] });
    expect(await probe("/range-206", privateResolver)).toBe("unknown");
    expect(hits.size).toBe(0);
  });

  it("测试网络闸挡住的主机 → unknown，一个请求都没出", async () => {
    expect(await probeProviderLink("https://elsewhere.example.com/a.png", {}, deps())).toBe("unknown");
    expect(hits.size).toBe(0);
  });

  // 不量墙钟：上限没生效的话这两条会一直挂着，被 vitest 的测试超时（30 秒）判红——直接观测机制，不量机器快慢。
  it("挂住不回话 → 到点放弃，unknown（4 秒上限）", async () => {
    expect(await probe("/hang")).toBe("unknown");
  });

  it("DNS 解析挂住也由外层上限收场（hardenedFetch 的计时器停不下 DNS）", async () => {
    const stuckDns = deps({ resolveHost: () => new Promise<ResolvedHostAddress[]>(() => undefined) });
    expect(await probe("/range-206", stuckDns)).toBe("unknown");
  });
});

describe("probeProviderLink：去重与记忆", () => {
  it("同一条链接并发只发一个 GET", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => probe("/range-206")));
    expect(results).toEqual(Array(12).fill("alive"));
    expect(hits.get("/range-206")).toBe(1);
  });

  it("活着的结论记 5 分钟：窗口内不再发，过了窗口再试一次", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    await probeProviderLink(link("/range-206"), { now }, deps());
    clock += REFERENCE_LINK_ALIVE_MEMO_MS - 1;
    await probeProviderLink(link("/range-206"), { now }, deps());
    expect(hits.get("/range-206")).toBe(1);
    clock += 2;
    await probeProviderLink(link("/range-206"), { now }, deps());
    expect(hits.get("/range-206")).toBe(2);
  });

  it("判断不了的结论同样记 5 分钟", async () => {
    let clock = 1;
    const now = () => clock;
    expect(await probeProviderLink(link("/status-503"), { now }, deps())).toBe("unknown");
    clock += REFERENCE_LINK_ALIVE_MEMO_MS - 1;
    await probeProviderLink(link("/status-503"), { now }, deps());
    expect(hits.get("/status-503")).toBe(1);
  });

  it("明确失效的记到进程结束：时钟走到天边也不再发", async () => {
    let clock = 1;
    const now = () => clock;
    expect(await probeProviderLink(link("/status-410"), { now }, deps())).toBe("dead");
    clock += 365 * 24 * 60 * 60 * 1000;
    expect(await probeProviderLink(link("/status-410"), { now }, deps())).toBe("dead");
    expect(hits.get("/status-410")).toBe(1);
  });

  it("记忆最多 500 条：最早的先被挤掉", async () => {
    const dependencies = deps();
    const first = link("/range-206", "?n=0");
    await probeProviderLink(first, {}, dependencies);
    for (let n = 1; n <= REFERENCE_LINK_MEMO_LIMIT; n += 1) await probeProviderLink(link("/range-206", `?n=${n}`), {}, dependencies);
    hits.clear();
    await probeProviderLink(first, {}, dependencies);
    expect(hits.get("/range-206")).toBe(1); // 第 0 条已被挤出，要重新试
    hits.clear();
    await probeProviderLink(link("/range-206", `?n=${REFERENCE_LINK_MEMO_LIMIT}`), {}, dependencies);
    expect(hits.size).toBe(0); // 最新的还在
  }, 60_000);

  it("日志只写主机，不写完整链接（查询串里常带签名）", async () => {
    await probeProviderLink(link("/range-206", "?X-Signature=SECRET-TOKEN"), {}, deps());
    const probeLogs = logged.filter((entry) => entry.event === "reference-link-probe");
    expect(probeLogs).toHaveLength(1);
    expect(probeLogs[0].fields).toMatchObject({ host: HOST, verdict: "alive" });
    expect(JSON.stringify(logged)).not.toContain("SECRET-TOKEN");
    expect(JSON.stringify(logged)).not.toContain("range-206");
  });
});
