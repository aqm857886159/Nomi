import { describe, expect, it, vi, beforeEach } from "vitest";

// 锁 connector 的真实出站契约（默认 fetchJson 路径 = fetchTikhubJson）：
//   · Bearer 鉴权头 + Authorization 作敏感头（跨域剥离）+ 禁重定向出域；
//   · allowedOrigins 硬校验（只允许 api.tikhub.io）；
//   · http status / ResponseModel.code → 错误 kind 分类。
// hardenedFetch 被 mock；不发真网络、不烧额度。
const hardenedFetch = vi.fn();
vi.mock("../hardenedFetch", () => ({ hardenedFetch: (...args: unknown[]) => hardenedFetch(...args) }));

import { resolveShareVideo } from "./tikhubConnector";

function bytesOf(obj: unknown): { bytes: Buffer; status: number; contentType: string; finalUrl: string; truncated: boolean } {
  return {
    bytes: Buffer.from(JSON.stringify(obj), "utf8"),
    status: 200,
    contentType: "application/json",
    finalUrl: "https://api.tikhub.io/",
    truncated: false,
  };
}

beforeEach(() => hardenedFetch.mockReset());

describe("fetchTikhubJson 出站契约", () => {
  it("带 Bearer 头 + 敏感头声明 + 禁重定向，命中 api.tikhub.io 高画质端点", async () => {
    hardenedFetch.mockResolvedValue(
      bytesOf({ code: 200, data: { original_video_url: "https://aweme.snssdk.com/hq.mp4" } }),
    );
    const resolved = await resolveShareVideo("https://v.douyin.com/e3x2fjE/", "secret-key");
    expect(resolved.playUrl).toBe("https://aweme.snssdk.com/hq.mp4");
    expect(hardenedFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = hardenedFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(url.startsWith("https://api.tikhub.io/api/v1/douyin/web/fetch_video_high_quality_play_url")).toBe(true);
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-key");
    expect(opts.sensitiveHeaders).toEqual(["authorization"]);
    expect(opts.allowRedirect).toBe(false);
    expect(opts.throwOnNon2xx).toBe(false);
  });

  it("401 → auth", async () => {
    hardenedFetch.mockResolvedValue({ ...bytesOf({ code: 401, message_zh: "无效密钥" }), status: 401 });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "bad")).rejects.toMatchObject({ kind: "auth", status: 401 });
  });

  it("403 → quota", async () => {
    hardenedFetch.mockResolvedValue({ ...bytesOf({ code: 403 }), status: 403 });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k")).rejects.toMatchObject({ kind: "quota" });
  });

  it("404 → not-found", async () => {
    hardenedFetch.mockResolvedValue({ ...bytesOf({ code: 404 }), status: 404 });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k")).rejects.toMatchObject({ kind: "not-found" });
  });

  it("5xx → upstream", async () => {
    hardenedFetch.mockResolvedValue({ ...bytesOf({ code: 502 }), status: 502 });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k")).rejects.toMatchObject({ kind: "upstream" });
  });

  it("envelope.code 非 200 但 http 200 也按错分类（信封优先）", async () => {
    hardenedFetch.mockResolvedValue(bytesOf({ code: 403, message_zh: "额度不足" }));
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k")).rejects.toMatchObject({ kind: "quota" });
  });

  it("非 JSON body → bad-response", async () => {
    hardenedFetch.mockResolvedValue({
      bytes: Buffer.from("<html>blocked</html>", "utf8"),
      status: 200,
      contentType: "text/html",
      finalUrl: "https://api.tikhub.io/",
      truncated: false,
    });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k")).rejects.toMatchObject({ kind: "bad-response" });
  });

  it("非 2xx 且非 JSON（如 502 HTML 网关页）→ upstream", async () => {
    hardenedFetch.mockResolvedValue({
      bytes: Buffer.from("<html>502 Bad Gateway</html>", "utf8"),
      status: 502,
      contentType: "text/html",
      finalUrl: "https://api.tikhub.io/",
      truncated: false,
    });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k")).rejects.toMatchObject({ kind: "upstream" });
  });

  it("hardenedFetch 拒绝（网络失败）→ upstream", async () => {
    // 现实里 hardenedFetch 会 reject（非 sync throw）。用 mockReturnValueOnce + 预挂 catch 的
    // rejected promise，既真实模拟拒绝，又不让 vitest 把它记成未处理拒绝。
    const rejected = Promise.reject(new Error("ECONNREFUSED"));
    rejected.catch(() => {}); // 预挂空 catch：消除「未处理拒绝」告警，真实拒绝仍会被 fetchTikhubJson 的 await 接住
    hardenedFetch.mockReturnValueOnce(rejected);
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k")).rejects.toMatchObject({ kind: "upstream" });
  });
});
