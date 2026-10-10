import { describe, expect, it } from "vitest";
import { buildTrimVideoArgs, clampTrimRange } from "./trimVideoArgs";

describe("buildTrimVideoArgs：精确切 + 重编码", () => {
  const args = buildTrimVideoArgs({ inputPath: "in.mp4", outputPath: "out.mp4", startSeconds: 6, durationSeconds: 12 });
  it("-ss 在 -i 之前（解码到精确帧再输出），-t 是保留时长", () => {
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-ss") + 1]).toBe("6.000");
    expect(args[args.indexOf("-t") + 1]).toBe("12.000");
  });
  it("重编码（不是流拷贝：流拷贝只能切在关键帧上）、不缩放、音轨可有可无", () => {
    expect(args).toContain("libx264");
    expect(args).not.toContain("copy");
    expect(args.join(" ")).not.toMatch(/scale=|pad=/);
    expect(args).toContain("0:a:0?");
  });
  it("进度走 -progress pipe:1", () => {
    expect(args.slice(args.indexOf("-progress"), args.indexOf("-progress") + 2)).toEqual(["-progress", "pipe:1"]);
  });
  it("入点为负、时长太短：夹到合法值", () => {
    const clamped = buildTrimVideoArgs({ inputPath: "a", outputPath: "b", startSeconds: -3, durationSeconds: 0 });
    expect(clamped[clamped.indexOf("-ss") + 1]).toBe("0.000");
    expect(Number(clamped[clamped.indexOf("-t") + 1])).toBeGreaterThan(0);
  });
});

describe("clampTrimRange", () => {
  it("区间在时长内原样", () => expect(clampTrimRange(6, 18, 24)).toEqual({ start: 6, end: 18 }));
  it("出点超出时长夹到时长", () => expect(clampTrimRange(6, 99, 24)).toEqual({ start: 6, end: 24 }));
  it("区间短于 0.1 秒：向前补成至少 0.1 秒", () => {
    const range = clampTrimRange(23.98, 24, 24);
    expect(range.end - range.start).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(range.end).toBeLessThanOrEqual(24);
  });
});
