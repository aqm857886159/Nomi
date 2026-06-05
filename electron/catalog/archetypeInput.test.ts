import { describe, it, expect } from "vitest";
import { referenceInputParams } from "./archetypeInput";

// C3：参考输入构建（extras camelCase → 通用 snake 参数）。M2 互斥：空值不进结果。

describe("referenceInputParams", () => {
  it("首帧：只出 first_frame_url + 空 reference_images", () => {
    expect(referenceInputParams({ firstFrameUrl: "F.png" })).toEqual({
      first_frame_url: "F.png",
      reference_images: [],
    });
  });

  it("全能参考：三数组按序，空数组不出键", () => {
    expect(
      referenceInputParams({
        referenceImageUrls: ["c1", "c2", "c3"],
        referenceVideoUrls: ["v1"],
        referenceAudioUrls: [],
        referenceImages: [],
      }),
    ).toEqual({
      reference_image_urls: ["c1", "c2", "c3"],
      reference_video_urls: ["v1"],
      reference_images: [],
    });
  });

  it("空字符串 / 非数组健壮过滤", () => {
    expect(referenceInputParams({ firstFrameUrl: "   ", referenceImageUrls: ["", " x ", 5] })).toEqual({
      reference_image_urls: ["x"],
      reference_images: [],
    });
  });

  it("首/尾帧同时给 → 两个键都在", () => {
    const out = referenceInputParams({ firstFrameUrl: "F", lastFrameUrl: "L" });
    expect(out.first_frame_url).toBe("F");
    expect(out.last_frame_url).toBe("L");
  });
});
