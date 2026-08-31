import { describe, expect, it, vi } from "vitest";
import { postWithUploadRetry } from "./localAssetFile";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/xml" } });
}

const NO_DELAY = { delayMs: 0 };

describe("postWithUploadRetry — 资产上传瞬态有界重试", () => {
  it("一次成功直接返回，不重试", async () => {
    const doFetch = vi.fn(async () => jsonResponse(200, { url: "https://cdn/x.png" }));
    const result = await postWithUploadRetry(doFetch, NO_DELAY);
    expect(result).toEqual({ url: "https://cdn/x.png" });
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("连接级瞬态错误（代理 127.0.0.1 reset）后重试成功", async () => {
    let n = 0;
    const doFetch = vi.fn(async () => {
      n += 1;
      if (n < 3) {
        const err = new Error("fetch failed");
        (err as { cause?: unknown }).cause = { code: "ECONNRESET", message: "connect ECONNRESET 127.0.0.1:7897" };
        throw err;
      }
      return jsonResponse(200, { url: "https://cdn/ok.png" });
    });
    const result = await postWithUploadRetry(doFetch, NO_DELAY);
    expect(result).toEqual({ url: "https://cdn/ok.png" });
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  it("5xx 可重试，最终成功", async () => {
    let n = 0;
    const doFetch = vi.fn(async () => (++n < 2 ? jsonResponse(502, { error: "bad gateway" }) : jsonResponse(200, { url: "https://cdn/y.png" })));
    const result = await postWithUploadRetry(doFetch, NO_DELAY);
    expect(result).toEqual({ url: "https://cdn/y.png" });
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("429 可重试", async () => {
    let n = 0;
    const doFetch = vi.fn(async () => (++n < 2 ? jsonResponse(429, { message: "rate limited" }) : jsonResponse(200, { url: "https://cdn/z.png" })));
    await postWithUploadRetry(doFetch, NO_DELAY);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("4xx（鉴权/请求错）立即抛，绝不重试", async () => {
    const doFetch = vi.fn(async () => jsonResponse(401, { message: "unauthorized" }));
    await expect(postWithUploadRetry(doFetch, NO_DELAY)).rejects.toThrow(/HTTP 401/);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("400 不重试", async () => {
    const doFetch = vi.fn(async () => jsonResponse(400, { message: "bad request" }));
    await expect(postWithUploadRetry(doFetch, NO_DELAY)).rejects.toThrow(/HTTP 400/);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("保留签名对象存储 XML 的短错误码/消息", async () => {
    const doFetch = vi.fn(async () => textResponse(400, '<?xml version="1.0"?><Error><Code>EntityTooSmall</Code><Message>minimum allowed size</Message><RequestId>secret-ish</RequestId></Error>'));
    await expect(postWithUploadRetry(doFetch, NO_DELAY)).rejects.toThrow(/HTTP 400.*EntityTooSmall: minimum allowed size/);
    await expect(postWithUploadRetry(doFetch, NO_DELAY)).rejects.not.toThrow(/RequestId/);
  });

  it("瞬态一直失败 → 耗尽 maxAttempts 后抛最后一次错误", async () => {
    const doFetch = vi.fn(async () => {
      const err = new Error("fetch failed");
      (err as { cause?: unknown }).cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
      throw err;
    });
    await expect(postWithUploadRetry(doFetch, { maxAttempts: 3, delayMs: 0 })).rejects.toThrow(/fetch failed/);
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  it("默认 3 次尝试", async () => {
    const doFetch = vi.fn(async () => jsonResponse(503, { error: "unavailable" }));
    await expect(postWithUploadRetry(doFetch, NO_DELAY)).rejects.toThrow(/HTTP 503/);
    expect(doFetch).toHaveBeenCalledTimes(3);
  });
});
