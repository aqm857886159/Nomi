/**
 * 参考素材的临时链接：发给模型之前先试一下，明确失效才改用本机文件上传（设计卡 docs/plan/2026-11-01-reference-link-delivery.md ★9）。
 *
 * 这是那张矩阵：真的 `localizeAssetsForVendor`（唯一决定点）+ 真的试探函数 `probeProviderLink` + 本机 HTTP 假服务，
 * 断言的是假服务**真收到**的请求和决定点真返回的值，不是内部函数的返回。上传函数一律注入或指向本机假服务，
 * 测试网络闸 `NOMI_TEST_NETWORK_GUARD=1` 开着，全局 fetch 在入口那几组里换成"只放行回环"的路由——
 * 之前有线测试时真传过公共托管，这里结构上做不出来。
 *
 * 不在这里的行（各有自己的文件，同一份设计卡）：
 *   · 做片返工换链接的封存校验 / 哈希：productionRun/reworkReferenceLinks.test.ts；返工要不要换：capabilityCore/productionReferenceUrls.test.ts
 *   · 提交被拒 / 任务失败的记账（两个引擎各一行）：productionRun/productionGenerationSubmission.referenceRefusal.test.ts
 *   · 判据：shared/referenceFetchRefusal.test.ts；错误卡：generationCanvas/runner/classifyGenerationError.test.ts
 *   · 「试探或上传时点停止」今天就拦不住提交（设计卡 ★5 已改：和今天「提交中」点停止一样），这条线没有新增取消行为，所以没有对应的新断言。
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const customCall = vi.hoisted(() => ({ runScript: vi.fn(), catalog: { current: null as unknown } }));
const localAssets = vi.hoisted(() => ({ read: new Map<string, unknown>() }));

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    app: { getPath: () => String(process.env.NOMI_SETTINGS_DIR), getAppPath: () => process.cwd(), isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => v.toString() },
  };
});
vi.mock("./catalogStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./catalogStore")>()),
  readCatalog: () => structuredClone(customCall.catalog.current),
}));
vi.mock("./customCallRunner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./customCallRunner")>()),
  runCustomCallScript: (...args: unknown[]) => customCall.runScript(...args),
}));
vi.mock("../assets/localAssetFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../assets/localAssetFile")>();
  // 表里有就用表里的（入口几组塞进来的素材）；没有就读真盘（老用户那一组：0.24.0 真实落盘的素材 + .meta）。
  return { ...actual, readNomiLocalAsset: (url: string) => (localAssets.read.get(url) as ReturnType<typeof actual.readNomiLocalAsset> | undefined) ?? actual.readNomiLocalAsset(url) };
});
vi.mock("../capabilityCore/pendingSpendReferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../capabilityCore/pendingSpendReferences")>()),
  projectSpendReferenceAssets: {
    list: () => [{ id: "asset-1", data: { url: "nomi-local://asset/p/gen.png", contentType: "image/png" } }],
    identity: () => ({ contentHash: "hash", version: 1 }),
  },
}));

import { createPinnedDispatcher, type HardenedFetchDependencies, type ResolvedHostAddress } from "../hardenedFetch";
import type { OutboundEnvironment } from "../networkOutboundPolicy";
import { setLabTrustedPrivateOrigins } from "../networkOutboundPolicy";
import { probeProviderLink, resetProviderLinkProbes } from "../assets/providerMediaFetch";
import { createProject, executeProfileOperation } from "../runtime";
import { readNomiLocalAsset } from "../assets/localAssetFile";
import { resolveProjectRelativePath } from "../projects/repository";
import { runCustomCallTask } from "./customCallDispatch";
import { resolveProductionReferenceUrls } from "../capabilityCore/productionReferenceUrls";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { matchNomiErrorCode } from "../shared/nomiErrorCodes";
import {
  AnonymousAssetConsentRequiredError,
  ORIGINAL_URL_TRUST_MS,
  assertLocalAssetTransportReady,
  localizeAssetsForVendor,
  type IngestionCandidate,
  type LocalAsset,
  type ReferenceLinkPolicy,
} from "./assetLocalization";
import { assetLocalizationOptions } from "./assetTransportRuntime";
import { noteConnectionRefused, referenceLinkRefusalsPath } from "./referenceLinkRefusals";
import { ANON_UPLOAD_CHAIN } from "./assetIngestionRegistry";
import type { AssetIngestion, Model, Vendor } from "./types";

// ── 假服务：链接状态 + 假 API（生成 / 上传）──────────────────────────────────────────────────────────────
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const MP4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x10]), Buffer.from("ftypisom"), Buffer.alloc(4), Buffer.from("mdat")]);
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(32, 1)]);
const HOST = "cdn.matrix.test";
const PUBLIC_ADDRESS: ResolvedHostAddress = { address: "93.184.216.34", family: 4 };
const NO_LOCAL_PROXY: OutboundEnvironment = { syntheticResolver: false, syntheticSample: "" };

let server: http.Server;
let port = 0;
let origin = "";
const hits = new Map<string, number>();
const generated: Array<{ path: string; body: Record<string, unknown> }> = [];
const uploads: string[] = [];
let probeDelayMs = 0;
let inFlight = 0;
let maxInFlight = 0;
let hangingSockets: Array<() => void> = [];

function route(req: http.IncomingMessage, res: http.ServerResponse): void {
  const pathname = (req.url || "/").split("?")[0];
  hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
  const send = (type: string, payload: Buffer, status = 200): void => { res.writeHead(status, { "Content-Type": type, "Content-Length": payload.length }).end(payload); };
  if (pathname.startsWith("/gen/")) {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    res.once("close", () => { inFlight -= 1; });
  }
  const respond = (): void => {
    switch (pathname) {
      case "/gen/ok": return void res.writeHead(206, { "Content-Type": "image/png", "Content-Range": "bytes 0-15/9000", "Content-Length": PNG.length }).end(PNG);
      case "/gen/ignores-range": {
        const big = Buffer.alloc(2 * 1024 * 1024, 0x41);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": big.length });
        res.write(big.subarray(0, 64 * 1024));
        return void setTimeout(() => res.destroy(), 50);
      }
      case "/gen/octet": return send("application/octet-stream", Buffer.concat([PNG, Buffer.alloc(64, 1)]));
      case "/gen/redirect-ok": return void res.writeHead(302, { Location: "/gen/ok" }).end();
      case "/gen/redirect-403": return void res.writeHead(302, { Location: "/gen/status-403" }).end();
      case "/gen/html": return send("text/html", Buffer.from("<!doctype html><html>denied</html>"));
      case "/gen/json": return send("application/json", Buffer.from('{"code":403}'));
      case "/gen/text": return send("text/plain", Buffer.from("denied"));
      case "/gen/video": return void res.writeHead(206, { "Content-Type": "video/mp4", "Content-Length": MP4.length }).end(MP4);
      case "/gen/audio": return void res.writeHead(206, { "Content-Type": "audio/mpeg", "Content-Length": MP3.length }).end(MP3);
      case "/gen/video-dead": return send("text/html", Buffer.from("<html>gone</html>"), 404);
      case "/generated/gen-ref.png": return void res.writeHead(206, { "Content-Type": "image/png", "Content-Length": PNG.length }).end(PNG);
      case "/generated/gone.png": return send("application/xml", Buffer.from("<Error><Code>ExpiredToken</Code></Error>"), 410);
      case "/gen/hang": hangingSockets.push(() => req.socket.destroy()); return;
      case "/v1/uploads/images": {
        uploads.push(pathname);
        const done = (): void => send("application/json", Buffer.from(JSON.stringify({ url: `${origin}/uploaded/${uploads.length}.png` })));
        req.resume();
        req.on("end", done);
        return;
      }
      case "/v1/uploads-fail": req.resume(); req.on("end", () => send("application/json", Buffer.from('{"message":"nope"}'), 400)); return;
      case "/v1/generate": {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          generated.push({ path: pathname, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown> });
          send("application/json", Buffer.from(JSON.stringify({ data: [{ url: "https://result.example.com/out.png" }] })));
        });
        return;
      }
      default: {
        const status = Number(pathname.replace("/gen/status-", ""));
        if (Number.isInteger(status) && status >= 100) return send(status >= 500 ? "text/html" : "application/xml", Buffer.from("<Error/>"), status);
        res.writeHead(404).end();
      }
    }
  };
  if (probeDelayMs > 0 && pathname.startsWith("/gen/")) setTimeout(respond, probeDelayMs);
  else respond();
}

beforeAll(async () => {
  server = http.createServer(route);
  server.keepAliveTimeout = 0;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const destroy of hangingSockets) destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let settingsRoot = "";
beforeEach(() => {
  settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-reference-link-matrix-"));
  vi.stubEnv("NOMI_SETTINGS_DIR", settingsRoot);
  vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1");
  vi.stubEnv("NOMI_TEST_NETWORK_FIXTURE_ORIGINS", `http://${HOST}:${port}`);
  resetProviderLinkProbes();
  hits.clear();
  generated.length = 0;
  uploads.length = 0;
  probeDelayMs = 0;
  inFlight = 0;
  maxInFlight = 0;
  localAssets.read.clear();
  customCall.runScript.mockReset();
});

afterEach(() => {
  for (const destroy of hangingSockets) destroy();
  hangingSockets = [];
  setLabTrustedPrivateOrigins([]);
  vi.unstubAllGlobals();
  fs.rmSync(settingsRoot, { recursive: true, force: true });
});

// ── 通用夹具 ──────────────────────────────────────────────────────────────────────────────────────────────
const localUrl = (name: string) => `nomi-local://asset/p/${name}`;
const pinnedDeps = (): HardenedFetchDependencies => ({
  resolveHost: async () => [PUBLIC_ADDRESS],
  createPinnedDispatcher: (hostname) => createPinnedDispatcher(hostname, [{ address: "127.0.0.1", family: 4 }]),
  readOutboundEnvironment: async () => NO_LOCAL_PROXY,
  isApplicationProxyActive: () => false,
});
const cdn = (route: string) => `http://${HOST}:${port}${route}`;
const asset = (
  name: string,
  link: string | undefined,
  kind: "image" | "video" | "audio" = "image",
  ageMs: number | undefined = 60_000,
): LocalAsset => ({
  bytes: kind === "video" ? MP4 : kind === "audio" ? MP3 : Buffer.concat([PNG, Buffer.from(name)]),
  contentType: kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png",
  fileName: name,
  ...(link ? { originalUrl: link } : {}),
  ...(ageMs !== undefined ? { ageMs } : {}),
});
const uploadUrl: AssetIngestion = { strategy: "upload-url", endpoint: "https://up.example/x", base64Field: "b", urlPath: "url", accepts: ["image", "video", "audio"] };
const own = (ingestion: AssetIngestion = uploadUrl): IngestionCandidate => ({ vendorKey: "relay", ingestion, uploadApiKey: "k" });
const policyWith = (deps = pinnedDeps(), refused = false): ReferenceLinkPolicy => ({ refused, probe: (url) => probeProviderLink(url, {}, deps) });
const noMultipart = vi.fn();
const extrasOf = (out: { value: unknown }) => (out.value as { input_urls: string[] }).input_urls;

async function sendOne(linkRoute: string, options: { kind?: "image" | "video" | "audio"; ageMs?: number | undefined; channels?: IngestionCandidate[]; post?: ReturnType<typeof vi.fn>; refused?: boolean } = {}) {
  const post = options.post ?? vi.fn(async () => ({ url: "https://uploaded.example/new.png" }));
  const link = cdn(linkRoute);
  const out = await localizeAssetsForVendor(
    { input_urls: [localUrl("a.png")] },
    () => options.channels ?? [own()],
    () => asset("a.png", link, options.kind ?? "image", "ageMs" in options ? options.ageMs : 60_000),
    post,
    noMultipart,
    { linkPolicy: policyWith(pinnedDeps(), options.refused ?? false) },
  );
  return { wire: extrasOf(out)[0], link, post };
}

// ── 链接状态 ──────────────────────────────────────────────────────────────────────────────────────────────
describe("链接状态 → 发原链接 / 转上传（真试探 × 真决定点）", () => {
  const sendsLink: Array<[string, string]> = [
    ["206 图（服务器认 Range）", "/gen/ok"],
    ["200 图，忽略 Range 并返回大文件", "/gen/ignores-range"],
    ["200 octet-stream（开头是图片字节）", "/gen/octet"],
    ["跳转到 200", "/gen/redirect-ok"],
    ["429 限流", "/gen/status-429"],
    ["408 请求超时", "/gen/status-408"],
    ["416 Range 不可满足", "/gen/status-416"],
    ["500", "/gen/status-500"],
    ["503", "/gen/status-503"],
  ];
  const uploads_: Array<[string, string]> = [
    ["跳转到 403", "/gen/redirect-403"],
    ["400", "/gen/status-400"],
    ["401", "/gen/status-401"],
    ["403", "/gen/status-403"],
    ["404", "/gen/status-404"],
    ["410", "/gen/status-410"],
    ["200 HTML 页面", "/gen/html"],
    ["200 JSON", "/gen/json"],
    ["200 纯文本", "/gen/text"],
  ];

  it.each(sendsLink)("%s → 发原链接，零上传", async (_label, linkRoute) => {
    const { wire, link, post } = await sendOne(linkRoute);
    expect(wire).toBe(link);
    expect(post).not.toHaveBeenCalled();
  });

  it.each(uploads_)("%s → 转上传，发出去的是新链接", async (_label, linkRoute) => {
    const { wire, link, post } = await sendOne(linkRoute);
    expect(wire).toBe("https://uploaded.example/new.png");
    expect(wire).not.toBe(link);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("连接被拒 → 发原链接", async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    vi.stubEnv("NOMI_TEST_NETWORK_FIXTURE_ORIGINS", `http://${HOST}:${deadPort}`);
    const link = `http://${HOST}:${deadPort}/gen/ok`;
    const post = vi.fn();
    const out = await localizeAssetsForVendor({ input_urls: [localUrl("a.png")] }, () => [own()], () => asset("a.png", link), post, noMultipart, { linkPolicy: policyWith() });
    expect(extrasOf(out)).toEqual([link]);
    expect(post).not.toHaveBeenCalled();
  });

  // 不量墙钟：4 秒上限没生效的话这条会一直挂着，被 vitest 的测试超时判红。
  it("挂起到超时 → 发原链接（上限 4 秒，不陪着等）", async () => {
    const { wire, link, post } = await sendOne("/gen/hang");
    expect(wire).toBe(link);
    expect(post).not.toHaveBeenCalled();
  });

  it("出站策略拒绝（解析到内网）→ 发原链接，和今天一样", async () => {
    const link = cdn("/gen/ok");
    const post = vi.fn();
    const privateDeps = { ...pinnedDeps(), resolveHost: async () => [{ address: "10.1.2.3", family: 4 as const }] };
    const out = await localizeAssetsForVendor({ input_urls: [localUrl("a.png")] }, () => [own()], () => asset("a.png", link), post, noMultipart, { linkPolicy: policyWith(privateDeps) });
    expect(extrasOf(out)).toEqual([link]);
    expect(hits.get("/gen/ok") ?? 0).toBe(0);
  });
});

// ── 上传 ──────────────────────────────────────────────────────────────────────────────────────────────────
describe("上传（失效后走现有通道链，不新增通道）", () => {
  it("自家通道成功", async () => {
    const { wire, post } = await sendOne("/gen/status-410");
    expect(wire).toBe("https://uploaded.example/new.png");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("第一条失败、第二条成功", async () => {
    const first: AssetIngestion = { ...uploadUrl, endpoint: "https://first.example/x" };
    const second: AssetIngestion = { ...uploadUrl, endpoint: "https://second.example/x" };
    const post = vi.fn(async (url: string) => {
      if (url.includes("first.example")) throw new Error("素材上传失败(HTTP 500)：down");
      return { url: "https://second.example/new.png" };
    });
    const { wire } = await sendOne("/gen/status-404", { channels: [own(first), own(second)], post });
    expect(wire).toBe("https://second.example/new.png");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("全部失败 → 抛现有的「参考图没能送到服务商」错误；没有一条请求带着死链接出去", async () => {
    const post = vi.fn(async () => { throw new Error("素材上传失败(HTTP 500)：down"); });
    const failure = await sendOne("/gen/status-404", { post }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(matchNomiErrorCode((failure as Error).message)).toBe("asset-upload-failed");
  });

  it("没有任何通道 → 抛现有的「没有可用的图片上传通道」错误", async () => {
    const failure = await sendOne("/gen/status-404", { channels: [] }).catch((error: Error) => error);
    expect((failure as Error).message).toMatch(/没有可用的图片上传通道/);
  });

  const anonymous: AssetIngestion = { ...ANON_UPLOAD_CHAIN, chain: [] };
  it.each([
    ["allow", null],
    ["ask", AnonymousAssetConsentRequiredError],
    ["deny", AnonymousAssetConsentRequiredError],
  ] as const)("只剩匿名通道，公共托管同意为 %s", async (consent, error) => {
    const link = cdn("/gen/status-404");
    const post = vi.fn(async () => ({ url: "https://anon.example/new.png" }));
    const run = () => localizeAssetsForVendor(
      { input_urls: [localUrl("a.png")] }, () => [{ vendorKey: null as never, ingestion: { ...anonymous, chain: [{ ...uploadUrl, endpoint: "https://anon.example/x" }] }, uploadApiKey: "" }],
      () => asset("a.png", link), post, noMultipart, { linkPolicy: policyWith(), anonymousConsent: consent },
    );
    if (error) await expect(run()).rejects.toBeInstanceOf(error);
    else expect(extrasOf(await run())).toEqual(["https://anon.example/new.png"]);
    if (error) expect(post).not.toHaveBeenCalled();
  });
});

// ── 媒体 ──────────────────────────────────────────────────────────────────────────────────────────────────
describe("媒体：图片 / 视频 / 音频", () => {
  it.each([
    ["图片", "image", "/gen/ok"],
    ["视频", "video", "/gen/video"],
    ["音频", "audio", "/gen/audio"],
  ] as const)("%s：活着发原链接", async (_label, kind, linkRoute) => {
    const { wire, link, post } = await sendOne(linkRoute, { kind });
    expect(wire).toBe(link);
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ["图片", "image"],
    ["视频", "video"],
    ["音频", "audio"],
  ] as const)("%s：明确失效转上传", async (_label, kind) => {
    const { wire, post } = await sendOne("/gen/video-dead", { kind });
    expect(wire).toBe("https://uploaded.example/new.png");
    expect(post).toHaveBeenCalledTimes(1);
  });
});

// ── 不试探的情况 ──────────────────────────────────────────────────────────────────────────────────────────
describe("不试探的情况（GET 0 次）", () => {
  it("超过 48 小时：直接上传", async () => {
    const { wire, post } = await sendOne("/gen/ok", { ageMs: ORIGINAL_URL_TRUST_MS + 1 });
    expect(wire).toBe("https://uploaded.example/new.png");
    expect(post).toHaveBeenCalledTimes(1);
    expect(hits.get("/gen/ok") ?? 0).toBe(0);
  });

  it("没有 originalUrl：直接上传", async () => {
    const post = vi.fn(async () => ({ url: "https://uploaded.example/new.png" }));
    const out = await localizeAssetsForVendor({ input_urls: [localUrl("a.png")] }, () => [own()], () => asset("a.png", undefined), post, noMultipart, { linkPolicy: policyWith() });
    expect(extrasOf(out)).toEqual(["https://uploaded.example/new.png"]);
    expect(hits.size).toBe(0);
  });

  it("ageMs 未知：按在窗内处理，要试探", async () => {
    const { wire, link } = await sendOne("/gen/ok", { ageMs: undefined });
    expect(wire).toBe(link);
    expect(hits.get("/gen/ok")).toBe(1);
  });

  it("ComfyUI 目标：恒上传，不试探", async () => {
    const comfy: AssetIngestion = { strategy: "comfyui-upload", endpoint: "http://127.0.0.1:8188/upload/image", accepts: ["image"] };
    const postMultipart = vi.fn(async () => ({ name: "up.png", subfolder: "", type: "input" }));
    const out = await localizeAssetsForVendor({ input_urls: [localUrl("a.png")] }, () => [own(comfy)], () => asset("a.png", cdn("/gen/ok")), vi.fn(), postMultipart, { linkPolicy: policyWith() });
    expect(extrasOf(out)).toEqual(["up.png"]);
    expect(hits.size).toBe(0);
  });

  it("内联 data 字节：没有链接可试探", async () => {
    const post = vi.fn(async () => ({ url: "https://uploaded.example/new.png" }));
    const inline = `data:image/png;base64,${PNG.toString("base64")}`;
    const out = await localizeAssetsForVendor({ input_urls: [inline] }, () => [own()], () => null, post, noMultipart, { linkPolicy: policyWith() });
    expect(extrasOf(out)).toEqual(["https://uploaded.example/new.png"]);
    expect(hits.size).toBe(0);
  });
});

// ── 并发与去重 ────────────────────────────────────────────────────────────────────────────────────────────
describe("并发与去重", () => {
  it("一个请求 5 张图：试探一起发（同一时刻 5 个在途），耗时不随张数累加", async () => {
    probeDelayMs = 100;
    const routes = ["/gen/ok", "/gen/octet", "/gen/video", "/gen/audio", "/gen/status-429"];
    const out = await localizeAssetsForVendor(
      { input_urls: routes.map((_route, index) => localUrl(`n${index}.png`)) }, () => [own()],
      (url) => asset("x.png", cdn(routes[Number(/n(\d)/.exec(url)![1])])), vi.fn(), noMultipart, { linkPolicy: policyWith() },
    );
    expect(extrasOf(out)).toHaveLength(5);
    // 直接观测机制，不量墙钟：逐张串行的话同一时刻最多 1 个在途，一起发则 5 个同时在途。
    expect(maxInFlight).toBe(5);
    for (const r of routes) expect(hits.get(r)).toBe(1);
  });

  it("26 个请求共用一张图：GET 只有 1 次", async () => {
    const link = cdn("/gen/ok");
    const dependencies = pinnedDeps();
    const policy: ReferenceLinkPolicy = { refused: false, probe: (url) => probeProviderLink(url, {}, dependencies) };
    await Promise.all(Array.from({ length: 26 }, () => localizeAssetsForVendor(
      { input_urls: [localUrl("a.png")] }, () => [own()], () => asset("a.png", link), vi.fn(), noMultipart, { linkPolicy: policy },
    )));
    expect(hits.get("/gen/ok")).toBe(1);
  });

  it("5 分钟后再试一次；窗口内不再发", async () => {
    let clock = 10_000_000;
    const link = cdn("/gen/ok");
    const dependencies = pinnedDeps();
    const policy: ReferenceLinkPolicy = { refused: false, probe: (url) => probeProviderLink(url, { now: () => clock }, dependencies) };
    const send = () => localizeAssetsForVendor({ input_urls: [localUrl("a.png")] }, () => [own()], () => asset("a.png", link), vi.fn(), noMultipart, { linkPolicy: policy });
    await send();
    clock += 4 * 60_000;
    await send();
    expect(hits.get("/gen/ok")).toBe(1);
    clock += 61_000;
    await send();
    expect(hits.get("/gen/ok")).toBe(2);
  });

  it("做片入口 Run 失效：试探和上传做完之后 assertCurrent 抛错，不封存、不发（POST 0 次）", async () => {
    setLabTrustedPrivateOrigins([origin]);
    const vendor = relayVendor("relay-run");
    customCall.catalog.current = { version: 13, vendors: [vendor], models: [], mappings: [], apiKeysByVendor: {} };
    localAssets.read.set("nomi-local://asset/p/gen.png", asset("gen.png", `${origin}/gen/status-404`));
    const reference = { assetId: "asset-1", contentHash: "hash", version: 1, kind: "image" as const, role: "reference" as const };
    await expect(resolveProductionReferenceUrls({
      projectId: "p", providerId: vendor.key, references: [reference as never],
      assertCurrent() { if (uploads.length > 0) throw new Error("run_invalidated"); },
    })).rejects.toThrow("run_invalidated");
    expect(uploads).toHaveLength(1); // 换链接的上传做过了（免费），但没有任何东西被封存或发出
    expect(generated).toHaveLength(0);
  });
});

// ── 入口：三个发送入口各一组失效链接，都发出新链接 ────────────────────────────────────────────────────────────
function relayVendor(key: string, ingestion?: AssetIngestion): Vendor {
  const now = "2026-11-01T00:00:00.000Z";
  return {
    key, name: key, enabled: true, baseUrlHint: `${origin}/v1`, authType: "bearer", createdAt: now, updatedAt: now,
    assetIngestion: ingestion ?? { strategy: "upload-multipart", endpoint: `${origin}/v1/uploads/images`, urlPath: "url", accepts: ["image", "video", "audio"] },
  };
}
const relayModel = (vendorKey: string): Model => ({ vendorKey, modelKey: "paint", labelZh: "Paint", kind: "image", enabled: true, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" });
const generateOperation = { method: "POST" as const, path: "/generate", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", image: "{{request.params.image_url}}" } };

/** 全局 fetch 换成只放行回环的路由：任何一次想出网的请求都被记下并拒绝（匿名图床也不例外）。 */
function onlyLoopbackFetch(): string[] {
  const outbound: string[] = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/^https?:\/\/127\.0\.0\.1[:/]/.test(url)) return realFetch(input, init);
    outbound.push(url);
    return Promise.reject(new TypeError(`blocked in test: ${new URL(url).hostname}`));
  });
  return outbound;
}

describe("入口：三个发送入口，窗内链接失效 → 发出去的是新链接", () => {
  const deadLink = () => `${origin}/gen/status-404`;
  const aliveLink = () => `${origin}/gen/ok`;
  const reference = () => localUrl("gen.png");
  const prepare = (link: string) => {
    setLabTrustedPrivateOrigins([origin]);
    const vendor = relayVendor("relay-entrance");
    customCall.catalog.current = { version: 13, vendors: [vendor], models: [relayModel(vendor.key)], mappings: [], apiKeysByVendor: {} };
    localAssets.read.set(reference(), asset("gen.png", link));
    return { vendor, model: relayModel(vendor.key), outbound: onlyLoopbackFetch() };
  };
  const runtimeSend = (vendor: Vendor, model: Model) => executeProfileOperation({
    vendor, model, apiKey: "sk-test", stage: "create", operation: generateOperation,
    request: { kind: "image_edit", prompt: "keep the boat", extras: { modelKey: model.modelKey, referenceImages: [reference()] } },
    localAssetReader: (url: string) => (localAssets.read.get(url) as LocalAsset | undefined) ?? null,
  } as Parameters<typeof executeProfileOperation>[0]);

  it("runtime.ts 普通生成：失效 → 请求体里是上传后的新链接，生成 POST 1 次", async () => {
    const { vendor, model, outbound } = prepare(deadLink());
    await runtimeSend(vendor, model);
    expect(generated).toHaveLength(1);
    expect(generated[0].body.image).toMatch(new RegExp(`^${origin}/uploaded/\\d+\\.png$`));
    expect(uploads).toHaveLength(1);
    expect(outbound).toEqual([]);
  });

  it("runtime.ts 普通生成：活着 → 请求体里是原链接，零上传", async () => {
    const { vendor, model, outbound } = prepare(aliveLink());
    await runtimeSend(vendor, model);
    expect(generated).toHaveLength(1);
    expect(generated[0].body.image).toBe(aliveLink());
    expect(uploads).toHaveLength(0);
    expect(hits.get("/gen/ok")).toBe(1);
    expect(outbound).toEqual([]);
  });

  it("runtime.ts 普通生成：失效且上传全失败 → 抛「参考图没能送到服务商」，生成 POST 0 次", async () => {
    const { vendor, model, outbound } = prepare(deadLink());
    const failing = { ...vendor, assetIngestion: { strategy: "upload-multipart", endpoint: `${origin}/v1/uploads-fail`, urlPath: "url", accepts: ["image"] } as AssetIngestion };
    const failure = await runtimeSend(failing, model).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(matchNomiErrorCode((failure as Error).message)).toBe("asset-upload-failed");
    expect(generated).toHaveLength(0);
    // 匿名图床也被试过（兜底链），但全局 fetch 只放行回环：没有一个字节出过机器。
    expect(outbound.every((url) => !url.startsWith(origin))).toBe(true);
  });

  it("customCallDispatch.ts 自定义调用：失效 → 脚本拿到的参考是新链接", async () => {
    const { vendor, model, outbound } = prepare(deadLink());
    customCall.runScript.mockResolvedValue({ assets: ["https://result.example.com/out.png"], transcript: [] });
    await runCustomCallTask({
      vendor, model, apiKey: "sk-test", customConfig: {}, script: "return {}", taskKind: "image_edit",
      request: { kind: "image_edit", prompt: "keep the boat", extras: { modelKey: model.modelKey, referenceImages: [reference()] } },
      kind: "image_edit", wantedKind: "image", projectId: "p", nodeId: "n", grantId: "g", taskId: "t",
      spendGate: vi.fn(async () => undefined) as never, writeAsset: vi.fn(), localizeTaskAsset: vi.fn(),
    } as unknown as Parameters<typeof runCustomCallTask>[0]);
    const params = JSON.stringify(customCall.runScript.mock.calls[0][0].params);
    expect(params).toMatch(new RegExp(`${origin}/uploaded/\\d+\\.png`));
    expect(params).not.toContain(deadLink());
    expect(uploads).toHaveLength(1);
    expect(outbound).toEqual([]);
  });

  it("productionReferenceUrls.ts 做片流程：失效 → 封存的是上传后的新链接", async () => {
    const { vendor, outbound } = prepare(deadLink());
    const reference_ = { assetId: "asset-1", contentHash: "hash", version: 1, kind: "image" as const, role: "reference" as const };
    const urls = await resolveProductionReferenceUrls({ projectId: "p", providerId: vendor.key, references: [reference_ as never], assertCurrent() {} });
    expect(urls[spendReferenceKey(reference_ as never)]).toMatch(new RegExp(`^${origin}/uploaded/\\d+\\.png$`));
    expect(uploads).toHaveLength(1);
    expect(outbound).toEqual([]);
  });
});

// ── 模型拒绝之后：这条连接改走上传 ────────────────────────────────────────────────────────────────────────
describe("模型拒绝之后", () => {
  const link = () => `${origin}/gen/ok`;
  const send = async (vendorKey: string) => {
    setLabTrustedPrivateOrigins([origin]);
    const post = vi.fn(async () => ({ url: "https://uploaded.example/new.png" }));
    const options = assetLocalizationOptions({ key: vendorKey }, undefined);
    const out = await localizeAssetsForVendor({ input_urls: [localUrl("a.png")] }, () => [own()], () => asset("a.png", link()), post, noMultipart, options);
    return { wire: extrasOf(out)[0], post, options };
  };

  it("没拒绝过：试探，活着就发原链接", async () => {
    const { wire, post, options } = await send("relay-x");
    expect(options.linkPolicy?.refused).toBe(false);
    expect(wire).toBe(link());
    expect(post).not.toHaveBeenCalled();
    expect(hits.get("/gen/ok")).toBe(1);
  });

  it("记下之后：同一条连接下一次直接上传，且不再试探", async () => {
    noteConnectionRefused("relay-x");
    const { wire, post, options } = await send("relay-x");
    expect(options.linkPolicy?.refused).toBe(true);
    expect(wire).toBe("https://uploaded.example/new.png");
    expect(post).toHaveBeenCalledTimes(1);
    expect(hits.get("/gen/ok") ?? 0).toBe(0);
  });

  it("兄弟连接和别的连接不受影响", async () => {
    noteConnectionRefused("relay-x");
    for (const key of ["relay-x--b2c3", "relay-y", "apimart"]) {
      resetProviderLinkProbes();
      const { wire, options } = await send(key);
      expect(options.linkPolicy?.refused).toBe(false);
      expect(wire).toBe(link());
    }
  });

  it("清内存（重置试探记忆）后读文件仍生效", async () => {
    noteConnectionRefused("relay-x");
    resetProviderLinkProbes();
    expect(assetLocalizationOptions({ key: "relay-x" }, undefined).linkPolicy?.refused).toBe(true);
  });

  it("文件缺失或损坏：当作没有记录", async () => {
    expect(assetLocalizationOptions({ key: "relay-x" }, undefined).linkPolicy?.refused).toBe(false);
    fs.writeFileSync(referenceLinkRefusalsPath(), "{not json", "utf8");
    expect(assetLocalizationOptions({ key: "relay-x" }, undefined).linkPolicy?.refused).toBe(false);
  });

  it("拒绝过的连接，发送前的通道检查也不再因为窗内链接被跳过", () => {
    noteConnectionRefused("relay-x");
    const noChannel = () => [];
    const read = () => asset("a.png", link());
    expect(() => assertLocalAssetTransportReady({ input_urls: [localUrl("a.png")] }, noChannel, read, assetLocalizationOptions({ key: "relay-y" }, undefined))).not.toThrow();
    expect(() => assertLocalAssetTransportReady({ input_urls: [localUrl("a.png")] }, noChannel, read, assetLocalizationOptions({ key: "relay-x" }, undefined))).toThrow(/没有可用的图片上传通道/);
  });
});

// ── 老用户：旧版本用它自己的真函数落盘的生成图（tests/fixtures/old-user-data/assets/<版本>-<名字>）──────────────────
// 素材文件和 .meta 不是手写的形状：是那个版本自己的 importRemoteAsset 落下的（generators/zzRefLinkGen.ts.txt）。
// 升级那一刻什么都不迁移，所以这里只验：升级后的决定点读这份老 .meta，活着的照发、失效的转上传，和升级前超过 48 小时的图走同一条路。
// 目录是**遍历**出来的：以后每个版本补一份，新目录自动进这几行，不用回来改这个文件（推送前扫描型守卫登记的也是这个根）。
const OLD_USER_ASSETS = fileURLToPath(new URL("../../tests/fixtures/old-user-data/assets", import.meta.url));
const OLD_USER_DIRECTORIES = fs.readdirSync(OLD_USER_ASSETS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

describe.each(OLD_USER_DIRECTORIES)("老用户升级后：%s", (directory) => {
  const FIXTURE = path.join(OLD_USER_ASSETS, directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE, "manifest.json"), "utf8")) as { relativePath: string; savedOrigin: string };

  /** 把老素材拷进一个真项目；.meta 里存的地址换成本机假服务（和 catalogs 那几份同一个办法：仓库里的文件从不被改动）。 */
  function oldUserAsset(savedPath: string, mtime?: Date): string {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-old-user-asset-"));
    const project = createProject({ rootPath, name: "Old User", payload: {} });
    const projectDir = resolveProjectRelativePath(project.id, "");
    const target = path.join(projectDir, manifest.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(FIXTURE, manifest.relativePath), target);
    const meta = fs.readFileSync(path.join(FIXTURE, `${manifest.relativePath}.meta`), "utf8").replaceAll(`${manifest.savedOrigin}/generated/gen-ref.png`, `${origin}${savedPath}`);
    fs.writeFileSync(`${target}.meta`, meta);
    if (mtime) fs.utimesSync(target, mtime, mtime);
    return `nomi-local://asset/${project.id}/${manifest.relativePath}`;
  }
  /** 夹具的链接在回环上：用出站策略的实验室例外放行这一个精确 origin（入口那几组同款）。 */
  const sendOldAsset = async (url: string) => {
    setLabTrustedPrivateOrigins([origin]);
    const post = vi.fn(async () => ({ url: "https://uploaded.example/new.png" }));
    const out = await localizeAssetsForVendor({ input_urls: [url] }, () => [own()], readNomiLocalAsset, post, noMultipart, { linkPolicy: policyWith({}) });
    return { wire: extrasOf(out)[0], post };
  };

  it("真 .meta 里存着服务商的临时链接，读出来的素材带着它", () => {
    const url = oldUserAsset("/generated/gen-ref.png");
    const read = readNomiLocalAsset(url);
    expect(read?.originalUrl).toBe(`${origin}/generated/gen-ref.png`);
    expect(read?.contentType).toBe("image/png");
    expect(typeof read?.ageMs).toBe("number");
  });

  it("链接还活着 → 发原链接，零上传（请求和升级前一字不差）", async () => {
    const { wire, post } = await sendOldAsset(oldUserAsset("/generated/gen-ref.png"));
    expect(wire).toBe(`${origin}/generated/gen-ref.png`);
    expect(post).not.toHaveBeenCalled();
  });

  it("链接已失效 → 用本机文件上传换新链，不再发那条死链接", async () => {
    const { wire, post } = await sendOldAsset(oldUserAsset("/generated/gone.png"));
    expect(wire).toBe("https://uploaded.example/new.png");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("升级前就超过 48 小时的图：不试探，直接上传（和以前一样）", async () => {
    const longAgo = new Date(Date.now() - ORIGINAL_URL_TRUST_MS - 3_600_000);
    const { wire, post } = await sendOldAsset(oldUserAsset("/generated/gen-ref.png", longAgo));
    expect(wire).toBe("https://uploaded.example/new.png");
    expect(post).toHaveBeenCalledTimes(1);
    expect(hits.get("/generated/gen-ref.png") ?? 0).toBe(0);
  });
});
