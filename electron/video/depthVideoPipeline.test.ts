import { describe, expect, it } from "vitest";
import {
  buildExtractFramesArgs,
  buildRawToMp4Args,
  computeExpectedRawBytes,
  rawBytesPerPixel,
} from "./depthVideoPipeline";

describe("buildExtractFramesArgs", () => {
  it("trims the window and scales to the processing size at the chosen fps", () => {
    const args = buildExtractFramesArgs({
      sourcePath: "/in/dance.mp4",
      startSeconds: 2,
      durationSeconds: 4,
      fps: 24,
      outWidth: 768,
      outHeight: 432,
      outDir: "/tmp/job/frames",
    });
    expect(args).toContain("-ss");
    expect(args[args.indexOf("-ss") + 1]).toBe("2");
    expect(args[args.indexOf("-t") + 1]).toBe("4");
    expect(args[args.indexOf("-i") + 1]).toBe("/in/dance.mp4");
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=768:432");
    expect(args[args.indexOf("-r") + 1]).toBe("24");
    expect(args).toContain("-q:v");
    expect(args[args.length - 1]).toBe("/tmp/job/frames/f_%04d.jpg");
  });
});

describe("buildRawToMp4Args", () => {
  it("encodes gray rawvideo into yuv420p h264", () => {
    const args = buildRawToMp4Args({
      outWidth: 768,
      outHeight: 432,
      fps: 24,
      pixFmt: "gray",
      rawPath: "/tmp/job/depth.raw",
      outMp4: "/tmp/job/depth.mp4",
    });
    expect(args[args.indexOf("-f") + 1]).toBe("rawvideo");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("gray");
    expect(args[args.indexOf("-s") + 1]).toBe("768x432");
    expect(args[args.indexOf("-i") + 1]).toBe("/tmp/job/depth.raw");
    expect(args[args.length - 1]).toBe("/tmp/job/depth.mp4");
  });

  it("uses rgb24 for original+skeleton frames", () => {
    const args = buildRawToMp4Args({
      outWidth: 1280,
      outHeight: 720,
      fps: 30,
      pixFmt: "rgb24",
      rawPath: "/raw.bin",
      outMp4: "/out.mp4",
    });
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("rgb24");
  });
});

describe("raw byte budget", () => {
  it("counts gray at 1 byte/px and rgb24 at 3 bytes/px", () => {
    expect(rawBytesPerPixel("gray")).toBe(1);
    expect(rawBytesPerPixel("rgb24")).toBe(3);
  });

  it("computes expected totals", () => {
    expect(computeExpectedRawBytes(96, 1280, 720, "gray")).toBe(96 * 1280 * 720);
    expect(computeExpectedRawBytes(10, 768, 432, "rgb24")).toBe(10 * 768 * 432 * 3);
    expect(computeExpectedRawBytes(0, 640, 360, "gray")).toBe(0);
  });
});
