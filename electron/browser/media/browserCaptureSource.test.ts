import { describe, expect, it } from "vitest";
import {
  captureError,
  captureErrorCode,
  classifyBrowserMediaSource,
  classifyDownloadError,
  decodeDataUrlMedia,
} from "./browserCaptureSource";

// 2026-07-22 审计：分型引擎 + 结构化错误码的根因测试——
// 每种失败必须能被渲染层识别成一个可行动下一步，MSE/普通 blob/data/http 不再一锅烩。
describe("classifyBrowserMediaSource", () => {
  it("data / blob / http 三分型", () => {
    expect(classifyBrowserMediaSource("data:image/png;base64,iVBORw0KGgo=")).toBe("data");
    expect(classifyBrowserMediaSource("blob:https://site.example/uuid")).toBe("blob");
    expect(classifyBrowserMediaSource("https://cdn.example/a.jpg")).toBe("http");
  });
});

describe("captureError / captureErrorCode", () => {
  it("code 经 message 前缀存活（IPC 序列化后仍可解析）", () => {
    const error = captureError("mse-stream", "流媒体视频没有可下载的原件");
    expect(error.message).toBe("[nomi-capture:mse-stream] 流媒体视频没有可下载的原件");
    // 模拟 IPC 包裹（Error invoking remote method 前缀在渲染层已被剥掉核心 message）
    expect(captureErrorCode(error.message)).toBe("mse-stream");
  });

  it("重复包装不叠前缀", () => {
    const wrapped = captureError("forbidden", captureError("forbidden", "HTTP 403").message);
    expect(wrapped.message).toBe("[nomi-capture:forbidden] HTTP 403");
  });
});

describe("classifyDownloadError（原始错误 → 错误码）", () => {
  it.each([
    ["网页素材下载失败（HTTP 403）", "forbidden"],
    ["网页素材下载失败（HTTP 404）", "not-found"],
    ["网页返回的不是图片或视频（text/html）", "html-not-media"],
    ["Media is too large to import", "too-large"],
    ["Media download timed out", "timeout"],
    ["net::ERR_BLOCKED_BY_CLIENT https://i.ytimg.com/an_webp/x.webp", "blocked-by-client"],
    ["net::ERR_NAME_NOT_RESOLVED", "network"],
    ["Media download interrupted", "network"],
    ["[nomi-capture:mse-stream] 流媒体视频（MediaSource）没有可下载的原件", "mse-stream"],
    ["something entirely new", "unknown"],
  ])("%s → %s", (reason, code) => {
    expect(classifyDownloadError(reason)).toBe(code);
  });
});

describe("decodeDataUrlMedia", () => {
  const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");

  it("base64 图片解码出原始字节与声明类型", () => {
    const { buffer, declaredContentType } = decodeDataUrlMedia(`data:image/png;base64,${PNG_BASE64}`);
    expect(declaredContentType).toBe("image/png");
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("URL 编码（非 base64）体也能解", () => {
    const { buffer } = decodeDataUrlMedia("data:text/plain,hello%20world");
    expect(buffer.toString("utf8")).toBe("hello world");
  });

  it("超 200MB 预检直接拒（不先解码进内存）", () => {
    const hugeLength = Math.ceil((201 * 1024 * 1024 * 4) / 3);
    const fake = `data:image/png;base64,${"A".repeat(hugeLength)}`;
    expect(() => decodeDataUrlMedia(fake)).toThrow(/too-large/);
  });

  it("垃圾输入给 html-not-media 码", () => {
    expect(() => decodeDataUrlMedia("data:")).toThrow(/html-not-media/);
    expect(() => decodeDataUrlMedia("not-a-data-url")).toThrow(/html-not-media/);
  });
});
