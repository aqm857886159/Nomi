// 交给模型看的图：迁到 pi-ai 后远程图由**本机**取回再内联（协调 10-21 定，D4）。
// 2026-11-13 起取图不再按目的地地址判（docs/engineering/direction-checks/2026-11-13-outbound-address-layer-delete.md，丙 1）：
// 本机 / 内网地址照取、跳转照跟；守住的只剩类型白名单（png / jpeg / webp / gif，看响应头）与 20MB 上限。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readModelImage } from "./modelImageInput";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("远程图本机取回", () => {
  // 开着测试网络闸跑：请求全走注入的 fetch，这些假名字登记成夹具 origin。
  beforeEach(() => {
    vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1");
    vi.stubEnv("NOMI_TEST_NETWORK_FIXTURE_ORIGINS", "http://10.0.0.8,http://nas.lan,https://cdn.example.test,https://img.example.test");
  });

  it("本机 / 内网地址照取（不再按地址判），不在本机解析", async () => {
    for (const url of ["http://127.0.0.1:9/frame.png", "http://10.0.0.8/frame.png", "http://nas.lan/frame.png"]) {
      const fetchImpl = vi.fn(async () => new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } }));
      const resolveHost = vi.fn();
      await expect(readModelImage(url, {}, { fetch: fetchImpl, resolveHost: resolveHost as never }))
        .resolves.toMatchObject({ mimeType: "image/png" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(resolveHost).not.toHaveBeenCalled();
    }
  });

  it("公网之间的 CDN 跳转照常跟，拿到图片字节与类型", async () => {
    const fetchImpl = vi.fn(async (url: URL) => url.hostname === "cdn.example.test"
      ? new Response(null, { status: 302, headers: { Location: "https://img.example.test/real.png" } })
      : new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } }));
    await expect(readModelImage("https://cdn.example.test/a.png", {}, { fetch: fetchImpl })).resolves.toMatchObject({ mimeType: "image/png" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gif 收，svg 不收（类型白名单：png / jpeg / webp / gif）", async () => {
    const respond = (type: string) => vi.fn(async () => new Response(PNG, { status: 200, headers: { "Content-Type": type } }));
    const deps = (fetchImpl: ReturnType<typeof respond>) => ({ fetch: fetchImpl });
    await expect(readModelImage("https://img.example.test/a.gif", {}, deps(respond("image/gif")))).resolves.toMatchObject({ mimeType: "image/gif" });
    await expect(readModelImage("https://img.example.test/a.svg", {}, deps(respond("image/svg+xml")))).rejects.toThrow();
  });
});

describe("本机素材与内联图", () => {
  it("data: URI 原样解码；不是图的 data: 拒收", async () => {
    await expect(readModelImage(`data:image/png;base64,${PNG.toString("base64")}`)).resolves.toMatchObject({ mimeType: "image/png" });
    await expect(readModelImage("data:text/html;base64,PGgxPg==")).rejects.toThrow();
  });

  it("不认识的地址形状拒收", async () => {
    await expect(readModelImage("file:///C:/Windows/win.ini")).rejects.toThrow(/Unsupported image address/);
  });
});
