import { describe, expect, it } from "vitest";
import { buildFramesToVideoArgs } from "./framesToVideoArgs";

describe("buildFramesToVideoArgs", () => {
  it("builds image2-sequence → H.264 mp4 args with framerate, pix_fmt, codec, output", () => {
    const args = buildFramesToVideoArgs({
      framePattern: "/tmp/cam/frame-%05d.png",
      outputPath: "/tmp/cam/out.mp4",
      fps: 12,
    });

    // input framerate (read) before -i
    const framerateIndex = args.indexOf("-framerate");
    expect(framerateIndex).toBeGreaterThanOrEqual(0);
    expect(args[framerateIndex + 1]).toBe("12");

    // -i pattern
    const inputIndex = args.indexOf("-i");
    expect(args[inputIndex + 1]).toBe("/tmp/cam/frame-%05d.png");
    // -framerate must precede -i (it's a read-side option)
    expect(framerateIndex).toBeLessThan(inputIndex);

    // codec + pixel format
    expect(args).toContain("-c:v");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args).toContain("-pix_fmt");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p");

    // output framerate
    const outRateIndex = args.lastIndexOf("-r");
    expect(args[outRateIndex + 1]).toBe("12");

    // faststart + output path last
    expect(args).toContain("-movflags");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    expect(args[args.length - 1]).toBe("/tmp/cam/out.mp4");

    // overwrite flag present
    expect(args).toContain("-y");
  });

  it("rejects non-positive fps", () => {
    expect(() => buildFramesToVideoArgs({ framePattern: "/tmp/f-%05d.png", outputPath: "/tmp/o.mp4", fps: 0 })).toThrow();
    expect(() => buildFramesToVideoArgs({ framePattern: "/tmp/f-%05d.png", outputPath: "/tmp/o.mp4", fps: Number.NaN })).toThrow();
  });

  it("rejects missing pattern or output", () => {
    expect(() => buildFramesToVideoArgs({ framePattern: "", outputPath: "/tmp/o.mp4", fps: 12 })).toThrow();
    expect(() => buildFramesToVideoArgs({ framePattern: "/tmp/f-%05d.png", outputPath: "", fps: 12 })).toThrow();
  });
});
