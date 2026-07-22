import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserViewRecord } from "../core/browserViewTypes";
import {
  assertPromptReferenceDataUrlSize,
  downloadBrowserMediaFromPageView,
} from "./browserViewMedia";
import { streamBrowserMediaResponseToFile } from "./browserMediaValidation";

vi.mock("electron", () => ({ BrowserWindow: { fromId: () => null } }));

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeRecord(fetchResponse: Response | (() => Promise<Response>)): { record: BrowserViewRecord; fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(async () => typeof fetchResponse === "function" ? fetchResponse() : fetchResponse);
  return {
    fetch,
    record: {
      view: {
        webContents: {
          isDestroyed: () => false,
          getURL: () => "https://dribbble.com/shots/123",
          session: { fetch },
        },
      },
    } as unknown as BrowserViewRecord,
  };
}

describe("browser media session download", () => {
  // 2026-07-22 审计 P0 根因：手写跨源完整 URL Referer（Electron net-fetch 不过滤 forbidden header）
  // 与 strict-origin-when-cross-origin 政策相抵触 → Chromium 拦成 net::ERR_BLOCKED_BY_CLIENT。
  // 15 站实测：同 URL 无 Referer 直测 200。此测试钉死「任何 referrer 形态都不进请求」。
  it("downloads through the source page session with credentials and media accept — never a hand-written Referer", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { record, fetch } = makeRecord(new Response(png, { status: 200, headers: { "content-type": "image/png" } }));

    const result = await downloadBrowserMediaFromPageView(record, "https://cdn.dribbble.com/userupload/shot.png", "shot", "image");
    cleanupDirs.push(result.cleanupDir);

    expect(fetch).toHaveBeenCalledWith(
      "https://cdn.dribbble.com/userupload/shot.png",
      expect.objectContaining({
        credentials: "include",
        redirect: "follow",
        referrerPolicy: "strict-origin-when-cross-origin",
        headers: expect.objectContaining({
          Accept: expect.stringContaining("image/"),
        }),
      }),
    );
    const init = fetch.mock.calls[0]?.[1] as (RequestInit & { referrer?: string }) | undefined;
    expect(init && "referrer" in init).toBe(false);
    const headerNames = Object.keys((init?.headers ?? {}) as Record<string, string>).map((name) => name.toLowerCase());
    expect(headerNames).not.toContain("referer");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result.contentType).toBe("image/png");
    expect(result.mediaType).toBe("image");
    expect(fs.readFileSync(result.absolutePath)).toEqual(Buffer.from(png));
  });

  it("rejects an HTML anti-hotlink response instead of importing it as the requested image", async () => {
    const { record } = makeRecord(new Response("forbidden", { status: 200, headers: { "content-type": "text/html" } }));

    await expect(
      downloadBrowserMediaFromPageView(record, "https://cdn.example.com/protected.png", "protected.png", "image"),
    ).rejects.toThrow(/不是图片或视频|text\/html/i);
  });

  it("rejects HTML bytes even when the server lies with an image content type", async () => {
    const { record } = makeRecord(new Response("<!doctype html><title>blocked</title>", {
      status: 200,
      headers: { "content-type": "image/png" },
    }));

    await expect(
      downloadBrowserMediaFromPageView(record, "https://cdn.example.com/protected.png", "protected.png", "image"),
    ).rejects.toThrow(/内容无法识别|image\/png/i);
  });

  it("uses the verified byte type and extension when the server reports the wrong image subtype", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { record } = makeRecord(new Response(png, { status: 200, headers: { "content-type": "image/jpeg" } }));

    const result = await downloadBrowserMediaFromPageView(record, "https://cdn.example.com/wrong.jpg", "wrong.jpg", "image");
    cleanupDirs.push(result.cleanupDir);

    expect(result.contentType).toBe("image/png");
    expect(result.fileName).toBe("wrong.png");
  });

  it("surfaces the actual HTTP status", async () => {
    const { record } = makeRecord(new Response("forbidden", { status: 403, headers: { "content-type": "text/html" } }));

    await expect(
      downloadBrowserMediaFromPageView(record, "https://cdn.example.com/protected.png", "protected.png", "image"),
    ).rejects.toThrow(/403/);
  });

  it("recognizes media bytes when the server only reports application/octet-stream", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { record } = makeRecord(new Response(png, { status: 200, headers: { "content-type": "application/octet-stream" } }));

    const result = await downloadBrowserMediaFromPageView(record, "https://cdn.example.com/file", "shot", "image");
    cleanupDirs.push(result.cleanupDir);

    expect(result.contentType).toBe("image/png");
    expect(result.mediaType).toBe("image");
  });

  it("stops an unknown-length response while streaming instead of buffering past the limit", async () => {
    const tempDir = fs.mkdtempSync("/tmp/nomi-browser-stream-test-");
    cleanupDirs.push(tempDir);
    const savePath = `${tempDir}/download.part`;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]));
        controller.enqueue(new Uint8Array([3, 4, 5, 6]));
        controller.close();
      },
    }));

    await expect(streamBrowserMediaResponseToFile(response, savePath, 8)).rejects.toThrow(/too large/i);
    expect(fs.statSync(savePath).size).toBeLessThanOrEqual(6);
  });

  it("rejects prompt-reference base64 before a huge file can be read into main-process memory", () => {
    expect(() => assertPromptReferenceDataUrlSize(16 * 1024 * 1024)).not.toThrow();
    expect(() => assertPromptReferenceDataUrlSize(16 * 1024 * 1024 + 1)).toThrow(/提示词|过大/);
  });
});
