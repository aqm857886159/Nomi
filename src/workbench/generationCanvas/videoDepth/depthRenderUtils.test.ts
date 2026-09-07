import { describe, expect, it } from "vitest";
import { DepthTemporalSmoother, createDepthSmoother, depthToGray } from "./depthRenderUtils";

describe("depthToGray", () => {
  it("maps min->0 / max->255 when near = white", () => {
    const depth = new Float32Array([0.0, 0.25, 0.5, 1.0]);
    expect(Array.from(depthToGray(depth, "nearWhite"))).toEqual([0, 64, 128, 255]);
  });

  it("inverts when near = black", () => {
    const depth = new Float32Array([0.0, 0.25, 0.5, 1.0]);
    // nearWhite(0.5) rounds to 128, so its inverse is 128 too (round(255-127.5))
    expect(Array.from(depthToGray(depth, "nearBlack"))).toEqual([255, 191, 128, 0]);
  });

  it("normalizes non-0..1 ranges to full contrast", () => {
    const depth = new Float32Array([0.4, 0.8]); // (0.8-0.4) = 0.4 range
    expect(Array.from(depthToGray(depth, "nearWhite"))).toEqual([0, 255]);
  });

  it("handles flat input deterministically per direction", () => {
    const flat = new Float32Array([0.5, 0.5, 0.5]);
    expect(Array.from(depthToGray(flat, "nearWhite"))).toEqual([0, 0, 0]);
    expect(Array.from(depthToGray(flat, "nearBlack"))).toEqual([255, 255, 255]);
  });

  it("handles empty input without crashing", () => {
    expect(depthToGray(new Float32Array(0), "nearWhite").length).toBe(0);
  });
});

describe("DepthTemporalSmoother", () => {
  it("rejects an out-of-range alpha", () => {
    expect(() => new DepthTemporalSmoother(-0.1)).toThrow(RangeError);
    expect(() => new DepthTemporalSmoother(1.1)).toThrow(RangeError);
    expect(() => new DepthTemporalSmoother(Number.NaN)).toThrow(RangeError);
  });

  it("passes the first frame through", () => {
    const s = new DepthTemporalSmoother(0.5);
    expect(Array.from(s.push(new Float32Array([1, 2, 3])))).toEqual([1, 2, 3]);
  });

  it("alpha=0 means no smoothing (always current frame)", () => {
    const s = new DepthTemporalSmoother(0);
    s.push(new Float32Array([10, 20]));
    expect(Array.from(s.push(new Float32Array([30, 40])))).toEqual([30, 40]);
    expect(Array.from(s.push(new Float32Array([50, 60])))).toEqual([50, 60]);
  });

  it("alpha=1 freezes at the first frame", () => {
    const s = new DepthTemporalSmoother(1);
    s.push(new Float32Array([10, 20]));
    expect(Array.from(s.push(new Float32Array([99, 88])))).toEqual([10, 20]);
  });

  it("interpolates correctly with alpha=0.5", () => {
    const s = new DepthTemporalSmoother(0.5);
    s.push(new Float32Array([0, 0]));
    const out = s.push(new Float32Array([100, 200]));
    expect(Array.from(out)).toEqual([50, 100]);
  });

  it("keeps updating from the smoothed value, not the raw frame", () => {
    const s = new DepthTemporalSmoother(0.5);
    s.push(new Float32Array([0]));
    s.push(new Float32Array([100])); // -> 50
    const out = s.push(new Float32Array([0])); // 0.5*50 + 0.5*0 = 25
    expect(Array.from(out)).toEqual([25]);
  });

  it("does not share buffers with the caller", () => {
    const s = new DepthTemporalSmoother(0.5);
    const first = s.push(new Float32Array([1, 2]));
    first[0] = 999;
    const second = s.push(new Float32Array([1, 2]));
    expect(second[0]).toBe(1);
  });

  it("reset() starts a fresh first-frame passthrough", () => {
    const s = new DepthTemporalSmoother(1);
    s.push(new Float32Array([7]));
    s.reset();
    expect(Array.from(s.push(new Float32Array([8])))).toEqual([8]);
  });

  it("re-frames itself when frame length changes (new clip / resolution)", () => {
    const s = new DepthTemporalSmoother(0.5);
    s.push(new Float32Array([1, 2, 3]));
    const out = s.push(new Float32Array([9, 9, 9, 9]));
    expect(Array.from(out)).toEqual([9, 9, 9, 9]);
  });

  it("createDepthSmoother is a plain constructor wrapper", () => {
    const s = createDepthSmoother(0.35);
    s.push(new Float32Array([0]));
    // out = 0.35*prev(0) + 0.65*cur(100) = 65
    expect(Array.from(s.push(new Float32Array([100])))).toEqual([65]);
  });
});
