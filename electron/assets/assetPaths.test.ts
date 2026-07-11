import { describe, expect, it } from "vitest";
import {
  assetBucketFromMeta,
  assetKindFromContentType,
  contentTypeFromPath,
  extensionFromMime,
  extensionFromUrl,
  localAssetUrl,
  stableAssetId,
} from "./assetPaths";

describe("extensionFromMime", () => {
  it("maps known mime types and strips parameters", () => {
    expect(extensionFromMime("image/png")).toBe("png");
    expect(extensionFromMime("image/jpeg")).toBe("jpg");
    expect(extensionFromMime("video/mp4; codecs=avc1")).toBe("mp4");
    expect(extensionFromMime("application/json")).toBe("json");
  });
  it("maps audio mime types (previously fell through to fallback)", () => {
    expect(extensionFromMime("audio/mpeg")).toBe("mp3");
    expect(extensionFromMime("audio/wav")).toBe("wav");
    expect(extensionFromMime("audio/mp4")).toBe("m4a");
    expect(extensionFromMime("audio/flac")).toBe("flac");
  });
  it("returns the fallback for unknown types", () => {
    expect(extensionFromMime("application/zip")).toBe("bin");
    expect(extensionFromMime("application/zip", "zip")).toBe("zip");
  });
});

describe("extensionFromUrl", () => {
  it("extracts the lowercased extension from a URL path", () => {
    expect(extensionFromUrl("https://x/a/b.PNG?q=1")).toBe("png");
    expect(extensionFromUrl("https://x/v.mp4")).toBe("mp4");
  });
  it("falls back to 'bin' for extensionless or invalid urls", () => {
    expect(extensionFromUrl("https://x/noext")).toBe("bin");
    expect(extensionFromUrl("not a url")).toBe("bin");
  });
});

describe("localAssetUrl", () => {
  it("builds a nomi-local URL with per-segment encoding", () => {
    expect(localAssetUrl("proj 1", "a b/c.png")).toBe("nomi-local://asset/proj%201/a%20b/c.png");
  });
});

describe("contentTypeFromPath", () => {
  it("maps file extensions to content types", () => {
    expect(contentTypeFromPath("/x/a.png")).toBe("image/png");
    expect(contentTypeFromPath("/x/a.JPEG")).toBe("image/jpeg");
    expect(contentTypeFromPath("/x/a.mov")).toBe("video/quicktime");
    expect(contentTypeFromPath("/x/a.md")).toBe("text/markdown");
    expect(contentTypeFromPath("/x/a.bin")).toBe("application/octet-stream");
  });
  it("maps audio extensions (previously returned octet-stream)", () => {
    expect(contentTypeFromPath("/x/a.mp3")).toBe("audio/mpeg");
    expect(contentTypeFromPath("/x/voice.m4a")).toBe("audio/mp4");
    expect(contentTypeFromPath("/x/song.FLAC")).toBe("audio/flac");
  });
});

describe("assetKindFromContentType", () => {
  it("classifies by content-type family", () => {
    expect(assetKindFromContentType("image/png")).toBe("image");
    expect(assetKindFromContentType("video/mp4")).toBe("video");
    expect(assetKindFromContentType("audio/mpeg")).toBe("audio");
    expect(assetKindFromContentType("audio/flac")).toBe("audio");
    expect(assetKindFromContentType("application/json")).toBe("document");
    expect(assetKindFromContentType("text/plain")).toBe("document");
    expect(assetKindFromContentType("application/octet-stream")).toBe("file");
  });
});

describe("stableAssetId", () => {
  it("is deterministic and prefixed", () => {
    const a = stableAssetId("p", "dir/file.png");
    expect(a).toMatch(/^asset-[0-9a-f]{20}$/);
    expect(stableAssetId("p", "dir/file.png")).toBe(a);
    expect(stableAssetId("p", "other.png")).not.toBe(a);
  });
});

describe("assetBucketFromMeta", () => {
  it("routes user-imported assets to imported, else generated", () => {
    expect(assetBucketFromMeta({ kind: "upload" })).toBe("imported");
    expect(assetBucketFromMeta({ kind: "imported" })).toBe("imported");
    expect(assetBucketFromMeta({ kind: "local" })).toBe("imported");
    expect(assetBucketFromMeta({ kind: "browser-capture" })).toBe("imported");
    expect(assetBucketFromMeta({ kind: "browser-upload" })).toBe("imported");
    expect(assetBucketFromMeta({ kind: "generated" })).toBe("generated");
    expect(assetBucketFromMeta({})).toBe("generated");
  });
});
