import { describe, expect, it, vi } from "vitest";
import { browserCaptureContentType, browserCaptureFileName, browserCaptureMediaTarget } from "./browserCaptureMedia";

describe("browser capture media helpers", () => {
  it("extracts right-click image and video targets from Electron context menu params", () => {
    expect(browserCaptureMediaTarget({ mediaType: "image", srcURL: "https://cdn.example.com/a.png", suggestedFilename: "a.png" })).toEqual({
      kind: "image",
      url: "https://cdn.example.com/a.png",
      suggestedName: "a.png",
    });
    expect(browserCaptureMediaTarget({ mediaType: "video", srcURL: "data:video/mp4;base64,AAAA", suggestedFilename: "" })).toMatchObject({
      kind: "video",
      url: "data:video/mp4;base64,AAAA",
    });
  });

  it("rejects non-media and blob targets so capture stays on downloadable bytes", () => {
    expect(browserCaptureMediaTarget({ mediaType: "canvas", srcURL: "https://x/canvas", suggestedFilename: "" })).toBeNull();
    expect(browserCaptureMediaTarget({ mediaType: "image", srcURL: "blob:https://x/id", suggestedFilename: "" })).toBeNull();
    expect(browserCaptureMediaTarget({ mediaType: "image", srcURL: "", suggestedFilename: "" })).toBeNull();
  });

  it("builds a safe file name from suggestion, URL, or content type", () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    expect(browserCaptureFileName({ url: "https://x/assets/cat", contentType: "image/webp", fallbackKind: "image" })).toBe("cat.webp");
    expect(browserCaptureFileName({ url: "https://x/a", contentType: "video/mp4", suggestedName: "clip", fallbackKind: "video" })).toBe("clip.mp4");
    expect(browserCaptureFileName({ url: "not-a-url", contentType: "image/png", fallbackKind: "image" })).toBe("browser-capture-123.png");
  });

  it("normalizes content type to image or video families", () => {
    expect(browserCaptureContentType({ responseType: "image/png; charset=utf-8", fileName: "x.bin", fallbackKind: "image" })).toBe("image/png");
    expect(browserCaptureContentType({ responseType: "application/octet-stream", fileName: "movie.webm", fallbackKind: "video" })).toBe("video/webm");
    expect(browserCaptureContentType({ responseType: "application/octet-stream", fileName: "x.bin", fallbackKind: "image" })).toBe("image/png");
  });
});
