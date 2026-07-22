import { describe, expect, it } from "vitest";
import { bgraLumaStats, detectAnimatedImage, isBlankFrameLuma } from "./browserMediaValidation";

function solidBgra(pixels: number, b: number, g: number, r: number): Buffer {
  const buffer = Buffer.alloc(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    buffer[i * 4] = b;
    buffer[i * 4 + 1] = g;
    buffer[i * 4 + 2] = r;
    buffer[i * 4 + 3] = 255;
  }
  return buffer;
}

describe("bgraLumaStats + isBlankFrameLuma (黑帧拒绝)", () => {
  it("pure black frame → mean≈0, variance≈0 → blank", () => {
    const stats = bgraLumaStats(solidBgra(256, 0, 0, 0), 1);
    expect(stats.mean).toBeCloseTo(0, 3);
    expect(stats.variance).toBeCloseTo(0, 3);
    expect(isBlankFrameLuma(stats.mean, stats.variance)).toBe(true);
  });

  it("B站阻断画面 YMIN=YMAX=YAVG=16（纯色 16 灰）→ blank（复测真实黑帧场景）", () => {
    const stats = bgraLumaStats(solidBgra(256, 16, 16, 16), 1);
    expect(stats.variance).toBeCloseTo(0, 3);
    expect(isBlankFrameLuma(stats.mean, stats.variance)).toBe(true);
  });

  it("有内容的画面（半黑半白）→ 高方差 → 非空帧（不误伤有效当前帧）", () => {
    const half = Buffer.concat([solidBgra(128, 0, 0, 0), solidBgra(128, 255, 255, 255)]);
    const stats = bgraLumaStats(half, 1);
    expect(stats.variance).toBeGreaterThan(4);
    expect(isBlankFrameLuma(stats.mean, stats.variance)).toBe(false);
  });

  it("暗但有内容的夜景（低均值、有纹理）→ 不被误判为黑帧", () => {
    // 均值低但方差不为零：交替 8 与 60 灰。
    const buffer = Buffer.alloc(256 * 4);
    for (let i = 0; i < 256; i += 1) {
      const v = i % 2 === 0 ? 8 : 60;
      buffer[i * 4] = v;
      buffer[i * 4 + 1] = v;
      buffer[i * 4 + 2] = v;
      buffer[i * 4 + 3] = 255;
    }
    const stats = bgraLumaStats(buffer, 1);
    expect(isBlankFrameLuma(stats.mean, stats.variance)).toBe(false);
  });

  it("empty bitmap → blank", () => {
    const stats = bgraLumaStats(Buffer.alloc(0));
    expect(isBlankFrameLuma(stats.mean, stats.variance)).toBe(true);
  });
});

describe("detectAnimatedImage (动态图标注)", () => {
  it("animated WebP (VP8X animation flag) → true", () => {
    const buffer = Buffer.alloc(32);
    buffer.write("RIFF", 0, "ascii");
    buffer.write("WEBP", 8, "ascii");
    buffer.write("VP8X", 12, "ascii");
    buffer[20] = 0x02; // animation flag bit
    expect(detectAnimatedImage(buffer, "image/webp")).toBe(true);
  });

  it("animated WebP via ANMF chunk → true", () => {
    const buffer = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.alloc(4),
      Buffer.from("WEBP", "ascii"),
      Buffer.from("VP8 ", "ascii"),
      Buffer.alloc(8),
      Buffer.from("ANMF", "ascii"),
    ]);
    expect(detectAnimatedImage(buffer, "image/webp")).toBe(true);
  });

  it("static WebP (no animation flag, no ANMF) → false", () => {
    const buffer = Buffer.alloc(32);
    buffer.write("RIFF", 0, "ascii");
    buffer.write("WEBP", 8, "ascii");
    buffer.write("VP8 ", 12, "ascii");
    expect(detectAnimatedImage(buffer, "image/webp")).toBe(false);
  });

  it("animated GIF (NETSCAPE2.0) → true", () => {
    const buffer = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.from("...NETSCAPE2.0...", "ascii")]);
    expect(detectAnimatedImage(buffer, "image/gif")).toBe(true);
  });

  it("animated GIF (multiple image separators) → true", () => {
    const buffer = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.from([0x2c, 0x00, 0x2c, 0x00])]);
    expect(detectAnimatedImage(buffer, "image/gif")).toBe(true);
  });

  it("plain JPEG / PNG → false", () => {
    expect(detectAnimatedImage(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(false);
    expect(detectAnimatedImage(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png")).toBe(false);
  });
});
