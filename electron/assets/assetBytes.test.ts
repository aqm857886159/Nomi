import { describe, expect, it } from "vitest";

import { parseDataUrl } from "./assetBytes";

describe("parseDataUrl", () => {
  it("decodes a base64 data URL", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const parsed = parseDataUrl(`data:image/png;base64,${png.toString("base64")}`);
    expect(parsed.contentType).toBe("image/png");
    expect(parsed.bytes.equals(png)).toBe(true);
  });

  it("decodes a percent-encoded `;utf8` SVG data URL instead of throwing (regression: cutover localizer choked on seeded SVG thumbnails)", () => {
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"/>";
    const parsed = parseDataUrl(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
    expect(parsed.contentType).toBe("image/svg+xml");
    expect(parsed.bytes.toString("utf8")).toBe(svg);
  });

  it("decodes a `;charset=utf-8` parameter form", () => {
    const parsed = parseDataUrl("data:text/plain;charset=utf-8,hello%20world");
    expect(parsed.contentType).toBe("text/plain");
    expect(parsed.bytes.toString("utf8")).toBe("hello world");
  });

  it("handles a bare (no-parameter) text payload", () => {
    const parsed = parseDataUrl("data:image/gif,rawtext");
    expect(parsed.contentType).toBe("image/gif");
    expect(parsed.bytes.toString("utf8")).toBe("rawtext");
  });

  it("falls back to the default content type when the media type is omitted", () => {
    const parsed = parseDataUrl("data:,plain");
    expect(parsed.contentType).toBe("application/octet-stream");
    expect(parsed.bytes.toString("utf8")).toBe("plain");
  });

  it("keeps a literal payload when it is not valid percent-encoding", () => {
    // A stray `%` would make decodeURIComponent throw; the payload must survive verbatim.
    const parsed = parseDataUrl("data:text/plain,100%25% done");
    expect(parsed.bytes.toString("utf8")).toContain("100%");
  });

  it("throws on a string that is not a data URL", () => {
    expect(() => parseDataUrl("https://example.com/x.png")).toThrow("Invalid data URL");
  });
});
