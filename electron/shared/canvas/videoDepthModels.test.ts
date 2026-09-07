import { describe, expect, it } from "vitest";
import {
  VIDEO_DEPTH_MODEL_MANIFEST,
  videoDepthModelFor,
  videoDepthRequiredAssets,
} from "./videoDepthModels";

describe("video depth model manifest", () => {
  it("ships exactly the three v1 assets with whitelisted URLs", () => {
    expect(VIDEO_DEPTH_MODEL_MANIFEST.map((m) => m.id).sort()).toEqual(["depth_base", "depth_small", "pose_full"]);
    for (const m of VIDEO_DEPTH_MODEL_MANIFEST) {
      expect(m.downloadUrl.startsWith("https://")).toBe(true);
      expect(m.sizeBytesApprox).toBeGreaterThan(0);
    }
    // v1 scope: pose manifest contains no lite/heavy entries
    expect(VIDEO_DEPTH_MODEL_MANIFEST.filter((m) => m.role === "pose").every((m) => m.kindKey === "full")).toBe(true);
  });

  it("pins the measured sha256 for depth small", () => {
    const small = videoDepthModelFor("depth", "small");
    expect(small?.sha256).toBe("2df6223f206b5164e21f664ace61dabeb9bb6a49b8b5a3e00510b4807d0f5b04");
  });

  it("looks assets up by role + kindKey", () => {
    expect(videoDepthModelFor("pose", "full")?.fileName).toBe("pose_landmarker_full.task");
    expect(videoDepthModelFor("depth", "base")).toBeDefined();
    expect(videoDepthModelFor("pose", "lite")).toBeUndefined();
    expect(videoDepthModelFor("depth", "large")).toBeUndefined();
  });

  it("derives required assets per mode (pose skipped for depth-only)", () => {
    expect(videoDepthRequiredAssets("depth", "small").map((a) => a.id)).toEqual(["depth_small"]);
    expect(videoDepthRequiredAssets("depth_skeleton", "small").map((a) => a.id)).toEqual(["depth_small", "pose_full"]);
    expect(videoDepthRequiredAssets("depth_skeleton", "base").map((a) => a.id)).toEqual(["depth_base", "pose_full"]);
    expect(videoDepthRequiredAssets("original_skeleton", "small").map((a) => a.id)).toEqual(["pose_full"]);
  });
});
