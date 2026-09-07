import { describe, expect, it } from "vitest";
import {
  VIDEO_DEPTH_FPS,
  VIDEO_DEPTH_MODES,
  deriveProcessingPlan,
  modeNeedsDepth,
  modeNeedsPose,
  parseVideoDepthSettings,
} from "./videoDepth";
import type { VideoDepthSettings } from "./videoDepth";

const defaults: VideoDepthSettings = {
  schemaVersion: 1,
  trimStartSeconds: 0,
  trimEndSeconds: 0,
  mode: "depth",
  depthModel: "small",
  poseModel: "full",
  maxPeople: 1,
  maxResolution: 768,
  processingFps: 30,
  depthStyle: "grayscale",
  depthDirection: "nearWhite",
  temporalSmoothing: 0.35,
  skeleton: { lineWidth: 3, jointRadius: 5, confidence: 0.35, glow: false },
  exportPoseJson: false,
};

describe("video depth settings contract", () => {
  it("fills defaults for a partial input and keeps a valid full input", () => {
    expect(parseVideoDepthSettings({})).toEqual(defaults);
    const full = parseVideoDepthSettings({ ...defaults, mode: "depth_skeleton", maxPeople: 2 });
    expect(full?.mode).toBe("depth_skeleton");
    expect(full?.maxPeople).toBe(2);
  });

  it("rejects out-of-scope v1 values (fail-closed)", () => {
    // v1 scope cuts
    expect(parseVideoDepthSettings({ mode: "skeleton_black" })).toBeUndefined();
    expect(parseVideoDepthSettings({ depthStyle: "inferno" })).toBeUndefined();
    expect(parseVideoDepthSettings({ depthStyle: "viridis" })).toBeUndefined();
    expect(parseVideoDepthSettings({ poseModel: "lite" })).toBeUndefined();
    expect(parseVideoDepthSettings({ poseModel: "heavy" })).toBeUndefined();
    // unknown keys
    expect(parseVideoDepthSettings({ glowOutline: true })).toBeUndefined();
  });

  it("rejects out-of-range numeric values", () => {
    expect(parseVideoDepthSettings({ maxPeople: 0 })).toBeUndefined();
    expect(parseVideoDepthSettings({ maxPeople: 5 })).toBeUndefined();
    expect(parseVideoDepthSettings({ maxPeople: 1.5 })).toBeUndefined();
    expect(parseVideoDepthSettings({ processingFps: 7 })).toBeUndefined();
    expect(parseVideoDepthSettings({ processingFps: 61 })).toBeUndefined();
    expect(parseVideoDepthSettings({ maxResolution: 2048 })).toBeUndefined();
    expect(parseVideoDepthSettings({ temporalSmoothing: -0.1 })).toBeUndefined();
    expect(parseVideoDepthSettings({ temporalSmoothing: 1.1 })).toBeUndefined();
    expect(parseVideoDepthSettings({ trimStartSeconds: -1 })).toBeUndefined();
  });

  it("rejects an inverted trim window but allows end=0 and end>=start", () => {
    expect(parseVideoDepthSettings({ trimStartSeconds: 5, trimEndSeconds: 3 })).toBeUndefined();
    expect(parseVideoDepthSettings({ trimStartSeconds: 5, trimEndSeconds: 5 })?.trimEndSeconds).toBe(5);
    expect(parseVideoDepthSettings({ trimStartSeconds: 5, trimEndSeconds: 0 })?.trimEndSeconds).toBe(0);
  });

  it("coerces skeleton styling inputs to the fixed v1 defaults", () => {
    const s = parseVideoDepthSettings({ skeleton: { lineWidth: 99, glow: true, confidence: 9 } });
    expect(s?.skeleton).toEqual(defaults.skeleton);
    expect(parseVideoDepthSettings({}).skeleton.glow).toBe(false);
  });

  it("rejects non-strict unknown keys anywhere nested", () => {
    expect(parseVideoDepthSettings({ sourceVideoRef: { sourceUrl: "nomi-local://x", title: "t", sourceKind: "local-mp4", nope: 1 } })).toBeUndefined();
  });

  it("keeps canonical scope constants in sync with the v1 decisions", () => {
    // v1 scope: three modes, one grayscale style, one pose tier, six fps tiers
    expect(VIDEO_DEPTH_MODES).toEqual(["depth", "depth_skeleton", "original_skeleton"]);
    expect(VIDEO_DEPTH_FPS).toEqual([8, 12, 15, 24, 30, 60]);
    const s = parseVideoDepthSettings({ processingFps: 24 });
    expect(s?.processingFps).toBe(24);
  });
});

describe("mode needs", () => {
  it("depth-only does not load pose; skeleton modes do", () => {
    expect(modeNeedsDepth("depth")).toBe(true);
    expect(modeNeedsPose("depth")).toBe(false);
    expect(modeNeedsDepth("depth_skeleton")).toBe(true);
    expect(modeNeedsPose("depth_skeleton")).toBe(true);
    expect(modeNeedsDepth("original_skeleton")).toBe(false);
    expect(modeNeedsPose("original_skeleton")).toBe(true);
  });
});

describe("derive processing plan", () => {
  const base = { ...defaults, processingFps: 24 };

  it("scales 720p source to 768 long edge", () => {
    const p = deriveProcessingPlan(base, { width: 1280, height: 720, durationSeconds: 10 });
    expect(p.outWidth).toBe(768);
    expect(p.outHeight).toBe(432);
    expect(p.totalFramesEstimate).toBe(240);
  });

  it("keeps original resolution when maxResolution is original", () => {
    const p = deriveProcessingPlan({ ...base, maxResolution: "original" }, { width: 1920, height: 1080 });
    expect(p.outWidth).toBe(1920);
    expect(p.outHeight).toBe(1080);
  });

  it("honours 512 limit and even dimensions", () => {
    const p = deriveProcessingPlan({ ...base, maxResolution: 512 }, { width: 1280, height: 720 });
    expect(p.outWidth).toBe(512);
    expect(p.outHeight).toBe(288);
    expect(p.outWidth % 2).toBe(0);
    expect(p.outHeight % 2).toBe(0);
  });

  it("resolves trim end from settings; end=0 falls back to source duration", () => {
    const p = deriveProcessingPlan({ ...base, trimStartSeconds: 2, trimEndSeconds: 6 }, { durationSeconds: 10 });
    expect(p.startSeconds).toBe(2);
    expect(p.endSeconds).toBe(6);
    expect(p.totalFramesEstimate).toBe(96);

    const p2 = deriveProcessingPlan({ ...base, trimEndSeconds: 0 }, { durationSeconds: 10 });
    expect(p2.endSeconds).toBe(10);
    expect(p2.totalFramesEstimate).toBe(240);
  });

  it("reports null frame estimate when window/source duration is unknown", () => {
    const p = deriveProcessingPlan({ ...base, trimEndSeconds: 0 }, {});
    expect(p.endSeconds).toBe(0);
    expect(p.totalFramesEstimate).toBeNull();
  });
});
