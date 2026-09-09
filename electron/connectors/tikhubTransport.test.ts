import { describe, expect, it, vi, beforeEach } from "vitest";

// 锁 connector 的真实出站契约（默认 fetchJson 路径 = fetchTikhubJson）：
//   · Bearer 鉴权头 + Authorization 作敏感头（跨域剥离）+ 禁重定向出域；
//   · allowedOrigins 硬校验（只允许候选域）；
//   · http status / ResponseModel.code → 错误 kind 分类。
// hardenedFetch 被 mock；不发真网络、不烧额度。
// 选路层被桩住（resolveHost 固定给 api.tikhub.io），本套只测「给定 host 后的出站契约」，
// 双域名选路/failover 由 tikhubRoute.test.ts 单独锁。
const hardenedFetch = vi.fn();
vi.mock("../hardenedFetch", () => ({ hardenedFetch: (...args: unknown[]) => hardenedFetch(...args) }));

import { resolveShareVideo, searchReferences } from "./tikhubConnector";

/** 固定选路到主域，隔离出路由层：本套只验 fetchTikhubJson 的出站形状。 */
const routeToPrimary = { resolveHost: async () => "api.tikhub.io" };

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
    const resolved = await resolveShareVideo("https://v.douyin.com/e3x2fjE/", "secret-key", routeToPrimary);
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
    await expect(resolveShareVideo("https://v.douyin.com/x/", "bad", routeToPrimary)).rejects.toMatchObject({
      kind: "auth",
      status: 401,
    });
  });

  it("403 → quota", async () => {
    hardenedFetch.mockResolvedValue({ ...bytesOf({ code: 403 }), status: 403 });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k", routeToPrimary)).rejects.toMatchObject({
      kind: "quota",
    });
  });

  // ── 2026-09-07 补：读官方文档 + 实调发现的三处错误分类缺口 ────────────────────
  // docs.tikhub.io 明列 402 与 429，但此前两者都掉进 bad-response，用户看到「响应结构异常」。

  it("402 余额不足 → quota（处置同 403：去 tikhub.io 处理）", async () => {
    hardenedFetch.mockResolvedValue({ ...bytesOf({ code: 402, message_zh: "余额不足" }), status: 402 });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k", routeToPrimary)).rejects.toMatchObject({
      kind: "quota",
      status: 402,
    });
  });

  it("429 限流 → rate-limited，**不能归到 quota**：一个要充值，一个只要等一下", async () => {
    hardenedFetch.mockResolvedValue({ ...bytesOf({ code: 429 }), status: 429 });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k", routeToPrimary)).rejects.toMatchObject({
      kind: "rate-limited",
      status: 429,
    });
  });

  it("错误文案从 detail 信封里捞（实调：401 是 {detail:{message}}，顶层 message 是空的）", async () => {
    hardenedFetch.mockResolvedValue({
      ...bytesOf({ detail: { code: 401, message: "Invalid API token, your submitted API token is xxx." } }),
      status: 401,
    });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "bad", routeToPrimary)).rejects.toMatchObject({
      kind: "auth",
      message: expect.stringContaining("Invalid API token"),
    });
  });

  it("422 的 detail 是数组（参数校验错），也要捞得出人话", async () => {
    hardenedFetch.mockResolvedValue({
      ...bytesOf({ detail: [{ type: "int_parsing", loc: ["body", "like"], msg: "Input should be a valid integer" }] }),
      status: 422,
    });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k", routeToPrimary)).rejects.toMatchObject({
      kind: "bad-response",
      message: expect.stringContaining("valid integer"),
    });
  });

  it("404 → not-found", async () => {
    hardenedFetch.mockResolvedValue({ ...bytesOf({ code: 404 }), status: 404 });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k", routeToPrimary)).rejects.toMatchObject({
      kind: "not-found",
    });
  });

  it("5xx → upstream", async () => {
    // 主选 host 5xx 会触发一次 failover 探测；此处桩 failover 返回 null，坐实分类为 upstream 前的切域尝试。
    hardenedFetch.mockResolvedValue({ ...bytesOf({ code: 502 }), status: 502 });
    await expect(
      resolveShareVideo("https://v.douyin.com/x/", "k", { ...routeToPrimary, failover: async () => null }),
    ).rejects.toMatchObject({ kind: "no-route" });
  });

  it("envelope.code 非 200 但 http 200 也按错分类（信封优先）", async () => {
    hardenedFetch.mockResolvedValue(bytesOf({ code: 403, message_zh: "额度不足" }));
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k", routeToPrimary)).rejects.toMatchObject({
      kind: "quota",
    });
  });

  it("非 JSON body → bad-response", async () => {
    hardenedFetch.mockResolvedValue({
      bytes: Buffer.from("<html>blocked</html>", "utf8"),
      status: 200,
      contentType: "text/html",
      finalUrl: "https://api.tikhub.io/",
      truncated: false,
    });
    await expect(resolveShareVideo("https://v.douyin.com/x/", "k", routeToPrimary)).rejects.toMatchObject({
      kind: "bad-response",
    });
  });

  it("非 2xx 且非 JSON（如 502 HTML 网关页）→ 切域失败后 no-route", async () => {
    hardenedFetch.mockResolvedValue({
      bytes: Buffer.from("<html>502 Bad Gateway</html>", "utf8"),
      status: 502,
      contentType: "text/html",
      finalUrl: "https://api.tikhub.io/",
      truncated: false,
    });
    await expect(
      resolveShareVideo("https://v.douyin.com/x/", "k", { ...routeToPrimary, failover: async () => null }),
    ).rejects.toMatchObject({ kind: "no-route" });
  });

  it("hardenedFetch 拒绝（网络失败）→ 切域失败后 no-route", async () => {
    // 现实里 hardenedFetch 会 reject（非 sync throw）。用 mockReturnValueOnce + 预挂 catch 的
    // rejected promise：既真实模拟拒绝，又不让 vitest 记成未处理拒绝。只发一次（主选 host 拒绝→
    // failover 桩 null→no-route），故 Once 即可；主选拒绝归类 upstream 后触发一次切域尝试。
    const rejected = Promise.reject(new Error("ECONNREFUSED"));
    rejected.catch(() => {}); // 预挂空 catch：消除「未处理拒绝」告警，真实拒绝仍会被 fetchTikhubJson 的 await 接住
    hardenedFetch.mockReturnValueOnce(rejected);
    await expect(
      resolveShareVideo("https://v.douyin.com/x/", "k", { ...routeToPrimary, failover: async () => null }),
    ).rejects.toMatchObject({ kind: "no-route" });
  });
});

describe("searchReferences 出站契约（POST 不得削弱加固）", () => {
  it("TikTok 广告库走 POST + JSON body，limit 钉在实测上限 20（文档说 50 是错的）", async () => {
    hardenedFetch.mockResolvedValue(bytesOf({ code: 200, data: { data: { materials: [] } } }));
    const out = await searchReferences({ platform: "tiktok", keyword: "skincare" }, "k", routeToPrimary);
    expect(out.result.platform).toBe("tiktok");
    const [url, opts] = hardenedFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toContain("/api/v1/tiktok/ads/search_ads");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toMatchObject({ keyword: "skincare", limit: 20, order_by: "likes" });
  });

  it("POST 路径的加固参数与 GET 完全一致：敏感头剥离 / 禁重定向 / 字节上限 / 白名单", async () => {
    hardenedFetch.mockResolvedValue(bytesOf({ code: 200, data: { data: { materials: [] } } }));
    await searchReferences({ platform: "tiktok", keyword: "x" }, "secret-key", routeToPrimary);
    const [url, opts] = hardenedFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(url.startsWith("https://api.tikhub.io/")).toBe(true);
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(opts.sensitiveHeaders).toEqual(["authorization"]);
    expect(opts.allowRedirect).toBe(false);
    expect(opts.maxBytes).toBe(8 * 1024 * 1024);
    expect(opts.timeoutMs).toBe(30_000);
  });

  it("抖音也是 POST；小红书是 GET + 中文枚举的时间筛选", async () => {
    hardenedFetch.mockResolvedValue(bytesOf({ code: 200, data: { data: [] } }));
    await searchReferences({ platform: "douyin", keyword: "护肤" }, "k", routeToPrimary);
    expect((hardenedFetch.mock.calls[0][1] as Record<string, unknown>).method).toBe("POST");

    hardenedFetch.mockReset();
    hardenedFetch.mockResolvedValue(bytesOf({ code: 200, data: { data: { items: [] } } }));
    await searchReferences({ platform: "xhs", keyword: "护肤", periodDays: 7 }, "k", routeToPrimary);
    const [xhsUrl, xhsOpts] = hardenedFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(xhsOpts.method).toBe("GET");
    expect(decodeURIComponent(xhsUrl)).toContain("time_filter=一周内");
  });

  it("空关键词直接拒绝，不发出站（不浪费一次计费请求）", async () => {
    await expect(searchReferences({ platform: "douyin", keyword: "  " }, "k", routeToPrimary)).rejects.toMatchObject({
      kind: "bad-response",
    });
    expect(hardenedFetch).not.toHaveBeenCalled();
  });
});
