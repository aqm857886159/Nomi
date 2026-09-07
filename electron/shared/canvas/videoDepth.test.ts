import { describe, expect, it } from "vitest";
import {
  VIDEO_DEPTH_MAX_RAW_BYTES,
  VIDEO_DEPTH_RECIPE,
  checkVideoDepthBudget,
  computeExpectedRawBytes,
  deriveProcessingPlan,
} from "./videoDepth";

describe("VIDEO_DEPTH_RECIPE", () => {
  it("is the one and only recipe, pinned to the numbers the decisions name", () => {
    // 这三个数各有出处（DA2 原生 518、素材原生 30fps、A/B 用的 0.35）。
    // 钉在测试里不是为了防手滑，是为了让「悄悄换一个数」必须先解释为什么。
    expect(VIDEO_DEPTH_RECIPE).toEqual({
      maxResolutionPx: 518,
      processingFps: 30,
      temporalSmoothing: 0.35,
      depthDirection: "nearWhite",
    });
  });
});

describe("deriveProcessingPlan", () => {
  it("scales the longest edge down to 518 and keeps both edges even", () => {
    const plan = deriveProcessingPlan({ width: 1920, height: 1080, durationSeconds: 4 });
    expect(plan.outWidth).toBe(518);
    expect(plan.outHeight).toBe(290);
    expect(plan.outWidth % 2).toBe(0);
    expect(plan.outHeight % 2).toBe(0);
  });

  it("scales a portrait source by its longest edge too, not by width", () => {
    const plan = deriveProcessingPlan({ width: 1080, height: 1920, durationSeconds: 4 });
    expect([plan.outWidth, plan.outHeight]).toEqual([290, 518]);
  });

  it("never upscales a source that is already smaller than the tier", () => {
    const plan = deriveProcessingPlan({ width: 320, height: 180, durationSeconds: 2 });
    expect(plan.outWidth).toBe(320);
    expect(plan.outHeight).toBe(180);
  });

  it("processes the whole clip — the trim window went away with the panel", () => {
    const plan = deriveProcessingPlan({ width: 640, height: 360, durationSeconds: 5 });
    expect(plan.durationSeconds).toBe(5);
    expect(plan.totalFramesEstimate).toBe(5 * VIDEO_DEPTH_RECIPE.processingFps);
  });

  it("reports null instead of inventing an estimate when source facts are missing", () => {
    const noDuration = deriveProcessingPlan({ width: 640, height: 360 });
    expect(noDuration.totalFramesEstimate).toBeNull();
    expect(noDuration.expectedRawBytes).toBeNull();

    const noSize = deriveProcessingPlan({ durationSeconds: 4 });
    expect(noSize.expectedRawBytes).toBeNull();

    // 时长探成 0 与「没探到」是同一件事：都不能拿来算帧数。
    expect(deriveProcessingPlan({ width: 640, height: 360, durationSeconds: 0 }).totalFramesEstimate).toBeNull();
  });
});

describe("raw byte budget", () => {
  it("counts one byte per pixel — the output is single-channel gray, and only that", () => {
    expect(computeExpectedRawBytes(10, 100, 50)).toBe(50_000);
  });

  it("passes a realistic 518px job", () => {
    const plan = deriveProcessingPlan({ width: 1920, height: 1080, durationSeconds: 30 });
    expect(checkVideoDepthBudget(plan)).toEqual({ ok: true });
  });

  it("refuses a clip long enough to run for hours, naming the numbers", () => {
    // 518px 封住的是每帧多大，封不住片子多长：518×290 灰度 ≈ 147KB/帧，@30fps 约 16 分钟就满 4GB。
    // 用户等不起，必须在开跑**之前**拦下来（错误文案让他先剪短）。
    const plan = deriveProcessingPlan({ width: 1920, height: 1080, durationSeconds: 60 * 30 });
    const verdict = checkVideoDepthBudget(plan);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("over-budget");
    if (verdict.reason !== "over-budget") throw new Error("unreachable");
    expect(verdict.expectedRawBytes).toBeGreaterThan(VIDEO_DEPTH_MAX_RAW_BYTES);
    expect(verdict.limitBytes).toBe(VIDEO_DEPTH_MAX_RAW_BYTES);
  });

  it("fails closed when the source was never measured", () => {
    expect(checkVideoDepthBudget(deriveProcessingPlan({}))).toEqual({ ok: false, reason: "unknown-source" });
  });
});
