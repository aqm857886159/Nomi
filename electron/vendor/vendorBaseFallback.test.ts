import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  activeVendorBaseOverride,
  configureVendorBaseFallback,
  fetchVendorWithBaseFallback,
  isConnectPhaseError,
  maybeResolveVendorBase,
  resetVendorBaseFallbackForTests,
  restorePrimaryIfHealthy,
  rewriteVendorUrl,
} from "./vendorBaseFallback";
import { requestJson } from "./vendorHttp";
import type { Vendor } from "../catalog/types";

const PRIMARY = "https://api.apimart.ai";
const APIB = "https://api.apib.ai";

/** 连接从未建立形态的 fetch 拒绝（undici 把码塞 cause.code）。 */
const connectFail = (code = "UND_ERR_CONNECT_TIMEOUT") =>
  Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

const tlsHandshakeReset = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(
      new Error("Client network socket disconnected before secure TLS connection was established"),
      { code: "ECONNRESET" },
    ),
  });

const apimartGate = () =>
  new Response(JSON.stringify({ error: { message: "API key is required", type: "apimart_error" } }), { status: 401 });

beforeEach(() => resetVendorBaseFallbackForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  resetVendorBaseFallbackForTests();
});

describe("isConnectPhaseError（换线重发的安全闸）", () => {
  it("cause 链上的 DNS/拒绝/连接超时码 → true", () => {
    expect(isConnectPhaseError(connectFail("ENOTFOUND"))).toBe(true);
    expect(isConnectPhaseError(connectFail("ECONNREFUSED"))).toBe(true);
    expect(isConnectPhaseError(connectFail("UND_ERR_CONNECT_TIMEOUT"))).toBe(true);
  });
  it("happy-eyeballs 双栈失败的 AggregateError.errors 也识别", () => {
    const aggregate = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new AggregateError([Object.assign(new Error("refused"), { code: "ECONNREFUSED" })]), {}),
    });
    expect(isConnectPhaseError(aggregate)).toBe(true);
  });
  it("响应阶段错误（Abort/HEADERS_TIMEOUT/普通 Error）→ false（可能已计费，绝不触发重发）", () => {
    expect(isConnectPhaseError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false);
    expect(isConnectPhaseError(connectFail("UND_ERR_HEADERS_TIMEOUT"))).toBe(false);
    expect(isConnectPhaseError(new Error("boom"))).toBe(false);
  });
  it("TLS 握手建立前的 ECONNRESET → true；请求后普通 reset → false", () => {
    expect(isConnectPhaseError(tlsHandshakeReset())).toBe(true);
    expect(isConnectPhaseError(Object.assign(new Error("socket reset after request"), { code: "ECONNRESET" }))).toBe(false);
  });
});

describe("探测梯子 + rewrite", () => {
  it("主域连接失败 → 探测跳过刚失败域、采纳首个带 apimart 特征的备用域；rewrite 保 path+query", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      if (String(url).startsWith(APIB)) return apimartGate();
      throw connectFail();
    }));
    const changed = await maybeResolveVendorBase(`${PRIMARY}/v1/images/generations`, connectFail());
    expect(changed).toBe(true);
    expect(activeVendorBaseOverride("apimart")).toBe(APIB);
    expect(calls.some((u) => u.startsWith(PRIMARY))).toBe(false); // 刚失败的主域本轮不重试
    expect(rewriteVendorUrl(`${PRIMARY}/v1/tasks/abc?x=1`)).toBe(`${APIB}/v1/tasks/abc?x=1`);
    expect(rewriteVendorUrl("https://api.kie.ai/v1/task")).toBe("https://api.kie.ai/v1/task"); // 非 family 不动
  });

  it("captive portal（200 但无特征串）不算可达 → 继续下一候选", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).startsWith(APIB)) return new Response("<html>login to wifi</html>", { status: 200 });
      if (String(url).startsWith("https://api.aiuxu.com")) return apimartGate();
      throw connectFail();
    }));
    await maybeResolveVendorBase(`${PRIMARY}/v1/models`, connectFail());
    expect(activeVendorBaseOverride("apimart")).toBe("https://api.aiuxu.com");
  });

  it("全部候选不可达 → 不设 override、返回 false、rewrite 恒等", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw connectFail(); }));
    expect(await maybeResolveVendorBase(`${PRIMARY}/v1/models`, connectFail())).toBe(false);
    expect(activeVendorBaseOverride("apimart")).toBeNull();
    expect(rewriteVendorUrl(`${PRIMARY}/v1/models`)).toBe(`${PRIMARY}/v1/models`);
  });

  it("非连接层错误不触发梯子（零次探测）", async () => {
    const fetchMock = vi.fn(async () => apimartGate());
    vi.stubGlobal("fetch", fetchMock);
    expect(await maybeResolveVendorBase(`${PRIMARY}/v1/models`, new Error("HTTP 500"))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("并发失败单飞：两个调用共享一轮探测", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).startsWith(APIB)) return apimartGate();
      throw connectFail();
    });
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([
      maybeResolveVendorBase(`${PRIMARY}/a`, connectFail()),
      maybeResolveVendorBase(`${PRIMARY}/b`, connectFail()),
    ]);
    // 单轮梯子只探到 apib 就停（1 次），并发不翻倍
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchVendorWithBaseFallback / requestJson 集成", () => {
  it("连接层失败 → 换线重发一次成功；付费 POST 只在「请求从未离开本机」时重发", async () => {
    const wireCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      wireCalls.push(`${init?.method ?? "GET"} ${u}`);
      if (u.startsWith(PRIMARY)) throw tlsHandshakeReset();
      if (u.includes("/v1/models")) return apimartGate(); // 梯子的零额度探测
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    }));
    const response = await fetchVendorWithBaseFallback(`${PRIMARY}/v1/images/generations`, { method: "POST" });
    expect(response.status).toBe(200);
    // 1 次主域失败 + 1 次探测（GET /v1/models）+ 1 次换线重发
    expect(wireCalls[0]).toBe(`POST ${PRIMARY}/v1/images/generations`);
    expect(wireCalls.at(-1)).toBe(`POST ${APIB}/v1/images/generations`);
  });

  it("HTTP 错误绝不换线重发（requestJson 照常抛结构化错误，fetch 只打一次）", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "bad" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const vendor = { key: "apimart", authType: "bearer", baseUrlHint: PRIMARY } as unknown as Vendor;
    const error = await requestJson(vendor, "k", "POST", `${PRIMARY}/v1/images/generations`, {}, {}, {}).catch((e) => e);
    expect(error.structured).toMatchObject({ httpStatus: 500, category: "server" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("响应阶段 Abort（我们的超时）不换线重发", async () => {
    const fetchMock = vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchVendorWithBaseFallback(`${PRIMARY}/v1/x`, { method: "POST" })).rejects.toThrow("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("持久化 + 主域回切", () => {
  const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-vbf-")), "vendor-base-overrides.json");

  it("override 落盘；重启（configure）恢复；名单外的域被拒收", async () => {
    const file = tmpFile();
    configureVendorBaseFallback(file, { restoreDelayMs: 9_999_999 });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).startsWith(APIB)) return apimartGate();
      throw connectFail();
    }));
    await maybeResolveVendorBase(`${PRIMARY}/v1/models`, connectFail());
    expect(JSON.parse(fs.readFileSync(file, "utf8")).overrides.apimart).toBe(APIB);

    resetVendorBaseFallbackForTests();
    configureVendorBaseFallback(file, { restoreDelayMs: 9_999_999 });
    expect(activeVendorBaseOverride("apimart")).toBe(APIB);

    // 手改落盘文件指向任意站 → 拒收（key 绝不发往名单外的域）
    resetVendorBaseFallbackForTests();
    fs.writeFileSync(file, JSON.stringify({ version: 1, overrides: { apimart: "https://evil.example.com" } }));
    configureVendorBaseFallback(file, { restoreDelayMs: 9_999_999 });
    expect(activeVendorBaseOverride("apimart")).toBeNull();
  });

  it("主域恢复 → restorePrimaryIfHealthy 清 override 并落盘", async () => {
    const file = tmpFile();
    configureVendorBaseFallback(file, { restoreDelayMs: 9_999_999 });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).startsWith(APIB)) return apimartGate();
      throw connectFail();
    }));
    await maybeResolveVendorBase(`${PRIMARY}/v1/models`, connectFail());
    expect(activeVendorBaseOverride("apimart")).toBe(APIB);

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => apimartGate())); // 主域也通了
    await restorePrimaryIfHealthy("apimart");
    expect(activeVendorBaseOverride("apimart")).toBeNull();
    expect(JSON.parse(fs.readFileSync(file, "utf8")).overrides).toEqual({});
  });
});
