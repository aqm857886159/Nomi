// 2026-11-13：生成的提交 / 取回 / 下载不再按目的地地址判（方向复盘
// docs/engineering/direction-checks/2026-11-13-outbound-address-layer-delete.md，设计卡 ★9 第 1、4–8 条）。
// 开着代理（fake-ip 把域名解析进 198.18/15）、接本机 / 局域网的生成后端、供应商把结果放在局域网地址上——
// 这几种以前都在本机被拦，现在都照发照取。密钥那两条（只去保存时确认的 origin、遇跳转即停）不受影响；
// 只有「抓来的文字会进模型」的入口（丙 4 catalogCommit.fetchModelCatalogDocs、丙 5 providedDocs / docsDiscovery）
// 还按原判据拒本机 / 内网。全部零公网：提交走注入的 fetch，取回走本机回环夹具或注入的 fetch。
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hardenedFetch } from "./hardenedFetch";
import { OutboundDestinationRefusedError } from "./networkOutboundPolicy";
import { requestJson, VendorRequestError } from "./vendor/vendorHttp";
import { deriveCredentialBinding } from "./catalog/credentialBinding";
import { fetchModelCatalogDocs } from "./catalog/catalogCommit";
import { resolveProviderDocs } from "./providerAdapter/providedDocs";
import type { Vendor } from "./catalog/types";

let server: http.Server;
let baseUrl = "";
let requests = 0;

beforeAll(async () => {
  server = http.createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// 整个文件开着测试网络闸跑：注入 fetch 的那几个假地址登记成夹具 origin，其余一律挡下（零公网）。
beforeEach(() => {
  vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1");
  vi.stubEnv("NOMI_TEST_NETWORK_FIXTURE_ORIGINS", "http://198.18.0.7,http://nas.lan:8188,http://192.168.1.20");
});

/** 一条接入：密钥在保存那一刻绑在 `boundBase` 的 origin 上（凭据绑定）。 */
function vendorAt(baseUrlHint: string, boundBase = baseUrlHint): Vendor {
  return {
    key: "relay",
    authType: "bearer",
    baseUrlHint,
    credentialBinding: deriveCredentialBinding({ baseUrlHint: boundBase, authType: "bearer" }, "2026-11-13T00:00:00.000Z"),
  } as unknown as Vendor;
}

function okJson(): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({ id: "task-1" }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
}

describe("提交：接入地址是什么都照发（只看密钥是不是去保存时确认的那个 origin）", () => {
  it.each([
    ["开着代理：接入地址是代理合成的 198.18 段", "http://198.18.0.7"],
    ["本机生成后端 127.0.0.1", "http://127.0.0.1:8188"],
    ["局域网名字 nas.lan", "http://nas.lan:8188"],
    ["局域网地址 192.168.x", "http://192.168.1.20:8188"],
  ])("%s → 请求真的发出去", async (_label, base) => {
    const fetchImpl = okJson();
    await expect(requestJson(vendorAt(base), "sk-test", "POST", `${base}/v1/images/generations`, {}, {}, { prompt: "a cat" }, undefined, { fetchImpl }))
      .resolves.toMatchObject({ id: "task-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("密钥绑在别的 origin 上 → 本机拦下、一个字节不发（凭据规则 1 仍在）", async () => {
    const fetchImpl = okJson();
    const error = await requestJson(vendorAt("https://api.elsewhere.test", "https://api.relay.test"), "sk-test", "POST", "https://api.elsewhere.test/v1/images/generations", {}, {}, { prompt: "a cat" }, undefined, { fetchImpl })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VendorRequestError);
    expect(String((error as Error).message)).toContain("outbound-blocked-credential-origin");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("取回：结果链接指向哪里都照取（不带密钥）", () => {
  it("本机回环上的结果（真连接，零公网）", async () => {
    const before = requests;
    await expect(hardenedFetch(`${baseUrl}/out.png`)).resolves.toMatchObject({ status: 200, contentType: "image/png" });
    expect(requests).toBe(before + 1);
  });

  it.each([
    ["198.18 段（代理合成地址）", "http://198.18.0.7/out.png"],
    ["局域网名字 nas.lan", "http://nas.lan:8188/view?filename=out.png"],
    ["供应商把结果放在 192.168.x 上", "http://192.168.1.20/results/out.png"],
  ])("%s → 照取，不在本机解析、不问代理探测", async (_label, url) => {
    const resolveHost = vi.fn();
    const readOutboundEnvironment = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } }));
    await expect(hardenedFetch(url, {}, {
      resolveHost: resolveHost as never,
      readOutboundEnvironment: readOutboundEnvironment as never,
      fetch: fetchImpl,
      isApplicationProxyActive: () => false,
    })).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolveHost).not.toHaveBeenCalled();
    expect(readOutboundEnvironment).not.toHaveBeenCalled();
  });
});

describe("丙 4 / 丙 5：抓来的文字会进模型的入口照旧拒本机 / 内网", () => {
  it("丙 4 Agent 读文档（fetchModelCatalogDocs）拒 127.0.0.1，夹具一次都没被请求到", async () => {
    const before = requests;
    const error = await fetchModelCatalogDocs({ url: `${baseUrl}/docs` }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OutboundDestinationRefusedError);
    expect(requests).toBe(before);
  });

  it("丙 5 接入向导抓文档（resolveProviderDocs，交进来的是链接）带上 textEntersModelContext", async () => {
    const fetchText = vi.fn(async () => ({ text: "docs", contentType: "text/plain", finalUrl: `${baseUrl}/docs`, status: 200 }));
    await resolveProviderDocs({ baseUrl, modelKeys: [], providedDocs: `${baseUrl}/docs`, fetchText: fetchText as never });
    expect(fetchText).toHaveBeenCalled();
    for (const call of fetchText.mock.calls as unknown as Array<[string, Record<string, unknown>]>) {
      expect(call[1]).toMatchObject({ textEntersModelContext: true });
    }
  });

  it("丙 5 接入向导自己找文档（discoverProviderDocs）每一次抓取都带 textEntersModelContext", async () => {
    const fetchText = vi.fn(async () => { throw new Error("not found"); });
    await resolveProviderDocs({ baseUrl: "https://api.relay.test", modelKeys: ["m"], fetchText: fetchText as never }).catch(() => undefined);
    expect(fetchText).toHaveBeenCalled();
    for (const call of fetchText.mock.calls as unknown as Array<[string, Record<string, unknown>]>) {
      expect(call[1]).toMatchObject({ textEntersModelContext: true });
    }
  });
});
