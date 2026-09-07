import { describe, expect, it } from "vitest";
import {
  VIDEO_DEPTH_MODEL_MANIFEST,
  videoDepthModelByFileName,
  videoDepthModelOrigins,
  videoDepthRequiredAssets,
} from "./videoDepthModels";

describe("video depth model manifest", () => {
  it("pins every asset to a real sha256, exact size and a permissive license", () => {
    expect(VIDEO_DEPTH_MODEL_MANIFEST.length).toBeGreaterThan(0);
    for (const asset of VIDEO_DEPTH_MODEL_MANIFEST) {
      // 空 sha256 = 「首下即信任」= 没有防线（R28）。这条断言就是不让它再长回来。
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.sizeBytes).toBeGreaterThan(0);
      expect(asset.license).toBe("Apache-2.0");
    }
  });

  it("downloads only from official first-party endpoints, never a mirror", () => {
    // 骨架输出砍掉之后 MediaPipe 那条也没了，所以出站白名单**只剩一个 origin**。
    // 这条断言同时是「谁又偷偷加了一个下载源」的门。
    expect([...videoDepthModelOrigins()].sort()).toEqual(["https://huggingface.co"]);
    for (const asset of VIDEO_DEPTH_MODEL_MANIFEST) {
      expect(asset.downloadUrl).not.toContain("hf-mirror");
    }
  });

  it("pins immutable revisions, not moving refs", () => {
    // `resolve/main` 和 `/latest/` 都会前进；那会让 pin 死的 sha256 某天突然全员失败。
    for (const asset of VIDEO_DEPTH_MODEL_MANIFEST) {
      expect(asset.downloadUrl).not.toContain("/resolve/main/");
      expect(asset.downloadUrl).not.toContain("/latest/");
    }
  });

  it("carries exactly one model — DA2 Small, no CC-BY-NC Base and no pose model", () => {
    // 输出只有一种（深度视频），所以权重也只该有一份。骨架那条（MediaPipe pose_landmarker）
    // 随骨架链一起删了：留在清单里就等于把「顺手把骨架加回来」写进白名单。
    expect(VIDEO_DEPTH_MODEL_MANIFEST).toHaveLength(1);
    expect(VIDEO_DEPTH_MODEL_MANIFEST[0].downloadUrl).toContain("depth-anything-v2-small");
    expect(VIDEO_DEPTH_MODEL_MANIFEST.some((a) => a.downloadUrl.includes("depth-anything-v2-base"))).toBe(false);
    expect(VIDEO_DEPTH_MODEL_MANIFEST.some((a) => a.downloadUrl.includes("pose_landmarker"))).toBe(false);
  });

  it("asks for exactly that one asset on every run", () => {
    expect(videoDepthRequiredAssets()).toEqual(VIDEO_DEPTH_MODEL_MANIFEST);
  });

  it("resolves assets by the file name used as the serving allowlist key", () => {
    const depth = VIDEO_DEPTH_MODEL_MANIFEST[0];
    expect(videoDepthModelByFileName(depth.fileName)).toBe(depth);
    expect(videoDepthModelByFileName("../../etc/passwd")).toBeUndefined();
  });

  it("uses file names with no path separators (they are an allowlist key, not a path)", () => {
    for (const asset of VIDEO_DEPTH_MODEL_MANIFEST) {
      expect(asset.fileName).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });
});
