import { describe, expect, it } from "vitest";
import { parseFfmpegProgressChunk, progressFromOutTime } from "./ffmpegProgress";

describe("parseFfmpegProgressChunk", () => {
  it("parses frame, fps, out_time_ms, speed, and progress fields", () => {
    expect(parseFfmpegProgressChunk([
      "frame=123",
      "fps=45.1",
      "out_time_ms=4100000",
      "speed=1.2x",
      "progress=continue",
    ].join("\n"))).toEqual({
      frame: 123,
      fps: 45.1,
      outTimeMs: 4100000,
      speed: 1.2,
      progress: "continue",
    });
  });

  it("tolerates CRLF, ignores malformed and unknown lines, and lets repeated keys use the last value", () => {
    expect(parseFfmpegProgressChunk("frame=1\r\nunknown=value\r\nnot-a-pair\r\nfps=NaN\r\nfps=29.97\r\nspeed=N/A\r\nspeed=0.8x\r\nprogress=end\r\n")).toEqual({
      frame: 1,
      fps: 29.97,
      speed: 0.8,
      progress: "end",
    });
  });

  it("ignores empty numeric values instead of treating them as zero", () => {
    expect(parseFfmpegProgressChunk("frame=\nfps=\nout_time_ms=\nspeed=x\nprogress=continue")).toEqual({
      progress: "continue",
    });
  });

  it("handles partial chunks gracefully without throwing", () => {
    expect(() => parseFfmpegProgressChunk("frame=12\npartial_line_without_equals")).not.toThrow();
    expect(parseFfmpegProgressChunk("frame=12\npartial_line_without_equals")).toEqual({ frame: 12 });
    expect(parseFfmpegProgressChunk("speed=1.")).toEqual({ speed: 1 });
  });
});

describe("progressFromOutTime", () => {
  it("computes progress as a clamped 0..1 ratio", () => {
    expect(progressFromOutTime(250, 1000)).toBe(0.25);
    expect(progressFromOutTime(-100, 1000)).toBe(0);
    expect(progressFromOutTime(1500, 1000)).toBe(1);
  });

  it("handles invalid or zero durations gracefully", () => {
    expect(progressFromOutTime(100, 0)).toBe(0);
    expect(progressFromOutTime(100, -1)).toBe(0);
    expect(progressFromOutTime(Number.NaN, 1000)).toBe(0);
    expect(progressFromOutTime(100, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
