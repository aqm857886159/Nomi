// 带密钥的出站请求不许跟随跳转——走**真实的 appFetch**（全局 setup 默认把它换成直通 fetch，
// 在那种环境里测「不跟随」是空转，所以这里 unmock），对着本地两个端口的真跳转服务验：
// 第一个端口回 302/307/308 指向第二个端口，第二个端口一个字节都不许收到。
// 失败的人话也在这里验：同一条跳转，生成路径和接入探测各自说出同一句话。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { Session } from "electron";

vi.unmock("./appFetch");

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>() }));
vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd(), on: vi.fn(), quit: vi.fn() },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) },
}));
vi.mock("./ipcSenderGuard", () => ({ assertTrustedSender: vi.fn() }));
vi.mock("./catalog/catalogStore", () => ({
  normalizeProviderKind: (value: string) => value === "anthropic" || value === "openai-responses" ? value : "openai-compatible",
  readCatalog: () => ({ version: 8, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }),
}));
vi.mock("./ai/onboarding/vendorHealth", () => ({ checkVendorHealth: vi.fn() }));
vi.mock("./catalog/rendererCatalogMutation", () => ({ upsertRendererCatalogVendorApiKey: vi.fn() }));

import { appFetch } from "./appFetch";
import { requestCarriesCredentials } from "./credentialRedirectPolicy";
import { fetchVendorWithBaseFallback } from "./vendor/vendorBaseFallback";
import { requestJson, VendorRequestError } from "./vendor/vendorHttp";
import { setSubmitOutboundDepsForTests } from "./vendor/vendorOutboundGuard";
import { registerOnboardingIpc } from "./ai/onboarding/onboardingIpc";
import { fetchModelList } from "./ai/onboarding/modelListProbe";
import { applySystemProxy } from "./systemProxy";
import { classifyGenerationError } from "../src/workbench/observability/classifyError";
import { matchNomiErrorCode } from "./shared/nomiErrorCodes";
import { desktopT } from "./desktopStrings";
import type { Vendor } from "./catalog/types";

type Seen = { headers: http.IncomingHttpHeaders; body: string };
const servers: http.Server[] = [];

async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture has no TCP address");
  return `http://127.0.0.1:${address.port}`;
}

/** 两个端口：source 回 3xx 指向 target；target 记下收到的一切。 */
async function redirectPair(status: number) {
  const seen: Seen[] = [];
  const target = await listen((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seen.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      response.end("reached the second origin");
    });
  });
  let sourceHits = 0;
  const source = await listen((request, response) => {
    sourceHits += 1;
    request.resume();
    request.on("end", () => {
      response.writeHead(status, { location: `${target}/stolen` });
      response.end();
    });
  });
  return { source, target, seen, sourceHits: () => sourceHits };
}

const AUTH_HEADERS = { "x-api-key": "redirect-api-key", "x-tenant-key": "redirect-tenant", "content-type": "application/json" };
const BODY = JSON.stringify({ prompt: "redirect-sensitive-body" });

beforeAll(async () => {
  await applySystemProxy({ setProxy: async () => undefined } as unknown as Session, { mode: "off", customUrl: "" });
});
beforeEach(() => {
  handlers.clear();
  registerOnboardingIpc();
  // 本机回环是用户显式配置的接入地址（声明式例外）；公网 / 无代理这一格钉死，不碰真 DNS。
  setSubmitOutboundDepsForTests({
    resolve: async () => [{ address: "93.184.216.34", family: 4 as const }],
    readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
    isApplicationProxyActive: () => false,
  });
});
afterEach(async () => {
  setSubmitOutboundDepsForTests(null);
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe.each([302, 307, 308])("带密钥请求遇到 HTTP %s 跳转：第二个网站一个字节都收不到", (status) => {
  it("门 1 appFetch（共享出站 owner）：自定义鉴权头 + POST 正文", async () => {
    const { source, seen, sourceHits } = await redirectPair(status);
    await expect(appFetch(`${source}/v1/x`, { method: "POST", headers: AUTH_HEADERS, body: BODY })).rejects.toBeInstanceOf(TypeError);
    expect(sourceHits()).toBe(1);
    expect(seen).toEqual([]);
  });

  it("门 1 appFetch：Authorization 与 Cookie 一样不跟随", async () => {
    const { source, seen } = await redirectPair(status);
    await expect(appFetch(`${source}/a`, { headers: { Authorization: "Bearer k" } })).rejects.toBeInstanceOf(TypeError);
    await expect(appFetch(`${source}/b`, { headers: { Cookie: "sid=1" } })).rejects.toBeInstanceOf(TypeError);
    expect(seen).toEqual([]);
  });

  it("门 2 供应商传输 fetchVendorWithBaseFallback", async () => {
    const { source, seen, sourceHits } = await redirectPair(status);
    await expect(fetchVendorWithBaseFallback(`${source}/v1/generations`, { method: "POST", headers: AUTH_HEADERS, body: BODY }))
      .rejects.toBeInstanceOf(Error);
    expect(sourceHits()).toBe(1);
    expect(seen).toEqual([]);
  });

  it("门 3 供应商 JSON 请求 requestJson：失败带稳定码，不可重试，渲染层认得出", async () => {
    const { source, seen } = await redirectPair(status);
    const vendor = { key: "relay", authType: "bearer", baseUrlHint: source } as unknown as Vendor;
    const error = (await requestJson(vendor, "redirect-api-key", "POST", `${source}/v1/generations`, AUTH_HEADERS, {}, { prompt: "p" }).catch((e) => e)) as VendorRequestError;
    expect(error).toBeInstanceOf(VendorRequestError);
    expect(error.structured).toMatchObject({ category: "network", retryable: false });
    expect(matchNomiErrorCode(error.structured.upstreamMsg)).toBe("credential-redirect");
    expect(seen).toEqual([]);
    const report = classifyGenerationError(String(error.message));
    expect(report.kind).toBe("credential-redirect");
    expect(report.primary).toBe("open-model-access");
  });

  it("门 5 模型列表拉取（手动模式）：不跟随，且告诉用户跳去了哪里", async () => {
    const { source, seen } = await redirectPair(status);
    const result = await fetchModelList("openai-compatible", `${source}/v1`, { "x-tenant-key": "redirect-tenant" }, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, failureKind: "redirect" });
    const message = JSON.stringify(result);
    expect(message).toContain("/stolen");
    expect(message).not.toContain("redirect-tenant");
    expect(seen).toEqual([]);
  });

  it("门 4 接入向导协议探测：失败说人话，第二个网站收不到", async () => {
    const { source, target, seen, sourceHits } = await redirectPair(status);
    const result = await handlers.get("nomi:onboarding:test-connection")?.({}, {
      baseUrl: source, providerKind: "openai-compatible", modelId: "m", apiKey: "redirect-api-key",
      headers: { "x-tenant-key": "redirect-tenant" },
    });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain(desktopT("network.credentialRedirectTo", { target: `${target}/stolen` }));
    expect(sourceHits()).toBeGreaterThanOrEqual(1);
    expect(seen).toEqual([]);
  });
});

describe("规则的边界", () => {
  it("不带密钥的普通下载仍然跟随跳转（正当 CDN 跳转不受影响）", async () => {
    const { source, seen } = await redirectPair(302);
    const response = await appFetch(`${source}/asset.png`, { headers: { accept: "image/*", "user-agent": "nomi" } });
    expect(await response.text()).toBe("reached the second origin");
    expect(seen).toHaveLength(1);
  });

  it("调用方自己指定 redirect（hardenedFetch / 模型列表分页）时尊重它", async () => {
    const { source } = await redirectPair(302);
    const response = await appFetch(`${source}/models`, { headers: AUTH_HEADERS, redirect: "manual" });
    expect(response.status).toBe(302);
  });

  it("判据按「有没有标准头之外的头」派生，认得出供应商自己取名的鉴权头", () => {
    expect(requestCarriesCredentials("https://x.test", { headers: { "x-relay-pass": "k" } })).toBe(true);
    expect(requestCarriesCredentials("https://x.test", { headers: [["Authorization", "Bearer k"]] })).toBe(true);
    expect(requestCarriesCredentials(new Request("https://x.test", { headers: { cookie: "a=b" } }))).toBe(true);
    expect(requestCarriesCredentials("https://x.test", { headers: { "content-type": "application/json", accept: "*/*" } })).toBe(false);
    expect(requestCarriesCredentials("https://x.test")).toBe(false);
  });
});

describe("跳转失败的那句人话（zh / en 都有）", () => {
  it.each(["zh-CN", "en"] as const)("%s：生成错误卡的原因与下一步都在词表里，不说「没扣费」", async (language) => {
    const { default: i18n } = await import("../src/i18n");
    await i18n.changeLanguage(language);
    const report = classifyGenerationError("NOMI_ERR::credential-redirect:: provider endpoint redirected");
    expect(report.kind).toBe("credential-redirect");
    expect(report.reason.length).toBeGreaterThan(10);
    expect(report.hint.length).toBeGreaterThan(20);
    expect(report.vendorSide).toBe(false);
    expect(`${report.reason}${report.hint}`).not.toMatch(/没有扣费|不扣费|not charged|nothing was charged/i);
    if (language === "zh-CN") expect(report.reason).toContain("跳转");
    else expect(report.reason.toLowerCase()).toContain("redirect");
  });
});
