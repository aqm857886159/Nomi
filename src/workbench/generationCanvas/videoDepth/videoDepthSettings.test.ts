import { describe, expect, it } from "vitest";
import { VIDEO_DEPTH_FIXED_SKELETON } from "../../../../electron/shared/canvas/videoDepth";
import {
  DEFAULT_VIDEO_DEPTH_SETTINGS,
  VIDEO_DEPTH_UI_MODES,
  coerceVideoDepthSettings,
  createDefaultVideoDepthSettings,
  videoDepthUsesPose,
} from "./videoDepthSettings";

describe("renderer video depth settings helpers", () => {
  it("defaults match the shared contract defaults and are frozen in structure", () => {
    const created = createDefaultVideoDepthSettings();
    expect(created).toEqual(DEFAULT_VIDEO_DEPTH_SETTINGS);
    expect(created.skeleton).toEqual(VIDEO_DEPTH_FIXED_SKELETON);
  });

  it("returns independent copies (no shared nested refs between calls)", () => {
    const a = createDefaultVideoDepthSettings();
    const b = createDefaultVideoDepthSettings();
    // @ts-expect-error mutation guard: skeleton is the fixed read-only style
    a.skeleton = { ...a.skeleton, glow: true };
    expect(b.skeleton.glow).toBe(false);
  });

  it("coerces junk snapshot input back to defaults and keeps valid input", () => {
    expect(coerceVideoDepthSettings(null)).toEqual(DEFAULT_VIDEO_DEPTH_SETTINGS);
    expect(coerceVideoDepthSettings({ mode: "skeleton_black" })).toEqual(DEFAULT_VIDEO_DEPTH_SETTINGS);
    expect(coerceVideoDepthSettings({ mode: "depth_skeleton", maxPeople: 2 }).mode).toBe("depth_skeleton");
  });

  it("exposes the three v1 modes in UI order and pose usage flags", () => {
    expect(VIDEO_DEPTH_UI_MODES).toEqual(["depth", "depth_skeleton", "original_skeleton"]);
    expect(videoDepthUsesPose("depth")).toBe(false);
    expect(videoDepthUsesPose("depth_skeleton")).toBe(true);
    expect(videoDepthUsesPose("original_skeleton")).toBe(true);
  });
});
