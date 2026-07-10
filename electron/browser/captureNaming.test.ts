import { describe, expect, it } from "vitest";
import { captureFileName, isCapturableMediaUrl } from "./captureNaming";

describe("isCapturableMediaUrl", () => {
  it("accepts http(s)/blob/data:image, rejects the rest", () => {
    expect(isCapturableMediaUrl("https://a.com/x.jpg")).toBe(true);
    expect(isCapturableMediaUrl("http://a.com/x.jpg")).toBe(true);
    expect(isCapturableMediaUrl("blob:https://a.com/uuid")).toBe(true);
    expect(isCapturableMediaUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isCapturableMediaUrl("data:text/html,<b>x</b>")).toBe(false);
    expect(isCapturableMediaUrl("javascript:alert(1)")).toBe(false);
    expect(isCapturableMediaUrl("file:///etc/passwd")).toBe(false);
    expect(isCapturableMediaUrl("")).toBe(false);
  });
});

describe("captureFileName", () => {
  it("keeps the URL stem but derives extension from contentType (URL ext lies)", () => {
    expect(captureFileName("https://cdn.a.com/imgs/hero-shot.webp?w=800", "image/png", "image")).toBe("hero-shot.png");
  });
  it("falls back to capture-<ts> for data URLs", () => {
    const name = captureFileName("data:image/png;base64,AAAA", "image/png", "image");
    expect(name).toMatch(/^capture-\d+\.png$/);
  });
  it("falls back for blob URLs and video hint defaults to mp4 when mime unknown", () => {
    const name = captureFileName("blob:https://a.com/uuid", "application/octet-stream", "video");
    expect(name).toMatch(/^capture-\d+\.mp4$/);
  });
  it("screenshot hint names screenshot-<ts>", () => {
    const name = captureFileName("https://a.com/some/page", "image/png", "screenshot");
    // 路径末段 "page" 是合法名 → 保留；无路径时才落 screenshot-<ts>
    expect(name).toBe("page.png");
    expect(captureFileName("https://a.com/", "image/png", "screenshot")).toMatch(/^screenshot-\d+\.png$/);
  });
  it("never lets path traversal into the name", () => {
    const name = captureFileName("https://a.com/..%2F..%2Fetc%2Fpasswd.png", "image/png", "image");
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
  });
});
