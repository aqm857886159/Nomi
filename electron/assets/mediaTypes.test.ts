import { describe, expect, it } from "vitest";
import {
  MEDIA_TYPES,
  acceptAttrForKinds,
  contentTypeFromExtension,
  contentTypeFromMagicBytes,
  extensionFromContentType,
  extensionsForKind,
  isCertifiableMediaContentType,
  mediaKindFromExtension,
  normalizeExtension,
  resolveContentType,
} from "./mediaTypes";
import { mediaKindFromContentType } from "../catalog/assetLocalization";

describe("media types registry — single source of truth", () => {
  it("has no duplicate extensions", () => {
    const exts = MEDIA_TYPES.map((e) => e.ext);
    expect(new Set(exts).size).toBe(exts.length);
  });

  it("every ext is lowercase with a leading dot", () => {
    for (const entry of MEDIA_TYPES) {
      expect(entry.ext).toMatch(/^\.[a-z0-9]+$/);
    }
  });

  it("round-trips ext → contentType → ext for single-ext content types", () => {
    // jpg/jpeg、ogg/oga 等多扩展名共享 contentType,反查取首条;此处只验单扩展名条目的往返。
    const contentTypeCounts = new Map<string, number>();
    for (const e of MEDIA_TYPES) contentTypeCounts.set(e.contentType, (contentTypeCounts.get(e.contentType) || 0) + 1);
    for (const entry of MEDIA_TYPES) {
      if (contentTypeCounts.get(entry.contentType) === 1) {
        expect(`.${extensionFromContentType(entry.contentType)}`).toBe(entry.ext);
      }
    }
  });
});

describe("normalizeExtension", () => {
  it("accepts ext, dotted ext, filename and path; lowercases", () => {
    expect(normalizeExtension("mp3")).toBe(".mp3");
    expect(normalizeExtension(".MP3")).toBe(".mp3");
    expect(normalizeExtension("song.FLAC")).toBe(".flac");
    expect(normalizeExtension("/a/b/voice.m4a")).toBe(".m4a");
    expect(normalizeExtension("")).toBe("");
  });
});

describe("mediaKindFromExtension", () => {
  it("classifies image / video / audio", () => {
    expect(mediaKindFromExtension("photo.png")).toBe("image");
    expect(mediaKindFromExtension("clip.mp4")).toBe("video");
    expect(mediaKindFromExtension("clip.m4v")).toBe("video");
    expect(mediaKindFromExtension("voice.m4a")).toBe("audio");
    expect(mediaKindFromExtension("song.flac")).toBe("audio");
    expect(mediaKindFromExtension("a.aac")).toBe("audio");
    expect(mediaKindFromExtension("a.ogg")).toBe("audio");
  });
  it("returns null for unknown", () => {
    expect(mediaKindFromExtension("a.zip")).toBeNull();
    expect(mediaKindFromExtension("noext")).toBeNull();
  });
});

describe("contentTypeFromExtension", () => {
  it("maps audio extensions the old tables missed", () => {
    expect(contentTypeFromExtension(".m4a")).toBe("audio/mp4");
    expect(contentTypeFromExtension(".aac")).toBe("audio/aac");
    expect(contentTypeFromExtension(".flac")).toBe("audio/flac");
    expect(contentTypeFromExtension(".opus")).toBe("audio/opus");
  });
  it("returns null for unknown", () => {
    expect(contentTypeFromExtension(".zip")).toBeNull();
  });
});

describe("extensionFromContentType", () => {
  it("strips charset params and is case-insensitive", () => {
    expect(extensionFromContentType("AUDIO/MPEG; charset=x")).toBe("mp3");
  });
});

describe("extensionsForKind", () => {
  it("returns audio extensions without dots", () => {
    expect(extensionsForKind("audio")).toEqual(["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "opus", "weba"]);
  });
});

describe("acceptAttrForKinds", () => {
  it("lists wildcards plus explicit extensions for picker", () => {
    const accept = acceptAttrForKinds(["image", "video", "audio"]);
    expect(accept).toContain("image/*");
    expect(accept).toContain("video/*");
    expect(accept).toContain("audio/*");
    // 显式扩展名补齐(macOS 灰掉坑):放行的音频格式都在
    expect(accept).toContain(".m4a");
    expect(accept).toContain(".flac");
    expect(accept).toContain(".mov");
    // 不含其它 kind
    expect(accept).not.toContain(".pdf");
    expect(accept).not.toContain(".glb");
  });
});

// 2026-08-20 用户报「素材上传失败(HTTP 413)」，而那只是段 2 秒的视频。根因不是文件大：
// 上传前判「这是图还是视频」只看扩展名，认不出时 mediaKindFromContentType 一律当图片
// → 视频被送进 base64 图片通道（整个文件塞进 JSON body）→ 反代 413。
// 文件名是人起的，字节是事实：扩展名认不出就读文件头。
describe("contentTypeFromMagicBytes / resolveContentType（扩展名认不出时读字节）", () => {
  const head = (...parts: Array<number[] | string>) => {
    const bytes: number[] = [];
    for (const part of parts) {
      if (typeof part === "string") bytes.push(...[...part].map((c) => c.charCodeAt(0)));
      else bytes.push(...part);
    }
    while (bytes.length < 16) bytes.push(0);
    return Uint8Array.from(bytes);
  };
  const ftyp = (major: string, compatible: string[] = []) => {
    const size = 16 + compatible.length * 4;
    return head([(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff], "ftyp", major, [0, 0, 0, 0], ...compatible);
  };
  const mp4 = ftyp("isom");
  const mov = ftyp("qt  ");
  const matroska = head([0x1a, 0x45, 0xdf, 0xa3]);
  const wav = head("RIFF", [0, 0, 0, 0], "WAVE");
  const webp = head("RIFF", [0, 0, 0, 0], "WEBP");
  const png = head([0x89], "PNG\r\n\n");

  it("认得出常见容器的文件头", () => {
    expect(contentTypeFromMagicBytes(mp4)).toBe("video/mp4");
    expect(contentTypeFromMagicBytes(mov)).toBe("video/quicktime");
    expect(contentTypeFromMagicBytes(matroska)).toBe("video/webm");
    expect(contentTypeFromMagicBytes(wav)).toBe("audio/wav");
    expect(contentTypeFromMagicBytes(webp)).toBe("image/webp");
    expect(contentTypeFromMagicBytes(png)).toBe("image/png");
    expect(contentTypeFromMagicBytes(ftyp("avif"))).toBe("image/avif");
    expect(contentTypeFromMagicBytes(ftyp("heic"))).toBe("image/heic");
    expect(contentTypeFromMagicBytes(ftyp("mif1", ["avif"]))).toBe("image/avif");
    expect(contentTypeFromMagicBytes(ftyp("mif1", ["heic", "hevc"]))).toBe("image/heic");
    expect(contentTypeFromMagicBytes(Uint8Array.from([0, 0, 0, 32, ...Buffer.from("ftypmif1")]))).toBeNull();
    expect(contentTypeFromMagicBytes(Uint8Array.from([0, 0, 0, 0, ...Buffer.from("ftypmif1"), ...new Uint8Array(8192)]))).toBeNull();
    expect(contentTypeFromMagicBytes(head([...Buffer.from("BM"), 0, 0]))).toBe("image/bmp");
    expect(contentTypeFromMagicBytes(head([0x49, 0x49, 0x2a, 0x00]))).toBe("image/tiff");
    expect(contentTypeFromMagicBytes(head([0x00, 0x00, 0x01, 0x00]))).toBe("image/x-icon");
    expect(contentTypeFromMagicBytes(head([1, 2, 3, 4]))).toBeNull();
  });

  it("按真实容器品牌/DocType识别 M4V、M4A、MKV、AAC 与 Opus", () => {
    expect(contentTypeFromMagicBytes(ftyp("M4V "))).toBe("video/x-m4v");
    expect(contentTypeFromMagicBytes(ftyp("M4A "))).toBe("audio/mp4");
    expect(contentTypeFromMagicBytes(head([0x1a, 0x45, 0xdf, 0xa3], "matroska"))).toBe("video/x-matroska");
    expect(contentTypeFromMagicBytes(head([0xff, 0xf1, 0x50, 0x80]))).toBe("audio/aac");
    expect(contentTypeFromMagicBytes(head("OggS", [0, 0, 0, 0], "OpusHead"))).toBe("audio/opus");
  });

  it("能力矩阵只声明当前真实 decoder 支持的图片格式", () => {
    expect(isCertifiableMediaContentType("image/png")).toBe(true);
    expect(isCertifiableMediaContentType("image/gif")).toBe(false);
    expect(isCertifiableMediaContentType("image/avif")).toBe(false);
    expect(isCertifiableMediaContentType("image/heic")).toBe(false);
    expect(isCertifiableMediaContentType("video/x-matroska")).toBe(true);
    expect(isCertifiableMediaContentType("audio/opus")).toBe(true);
  });

  it("扩展名认得出就用扩展名（快路不变）", () => {
    expect(resolveContentType("/p/clip.mp4", mp4)).toBe("video/mp4");
    expect(resolveContentType("/p/a.png", png)).toBe("image/png");
  });

  // 这三种正是用户可能踩到的：落盘扩展名缺失兜底成 .bin、导入的 .mkv、URL 没扩展名。
  it.each([["/p/clip.bin"], ["/p/clip.mkv"], ["/p/clip"]])(
    "扩展名认不出（%s）时读文件头，视频不再被判成图片",
    (filePath) => {
      const contentType = resolveContentType(filePath, mp4);
      expect(contentType).toBe("video/mp4");
      // 这一步就是原来出事的地方：判成 image → 走 base64 图片通道 → 413
      expect(mediaKindFromContentType(contentType)).toBe("video");
    },
  );

  it("字节也认不出才落到 octet-stream（此时仍会被当图片，属于已知下界）", () => {
    expect(resolveContentType("/p/x.bin", head([1, 2, 3, 4]))).toBe("application/octet-stream");
  });
});
