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

  // 2026-07-24 语义反转（群反馈根因）：旧断言是 archetypeInput **独占**（标准键被忽略）——正是它把
  // 中转 gpt-image-2 的参考吞光（中转模板只认 reference_images/chat_image_parts/image_url）。
  // 新不变量：标准键先建、档案键叠加，同名键档案权威。标准面的模式互斥由渲染层
  // buildReferenceExtras 按当前模式槽位门控（catalogTaskActions.test 锁），此处只管叠加不吞。
  it('档案模型：archetypeInput 叠加在标准键之上（同名档案权威，不吞标准键）', () => {
    const out = referenceInputParams({
      firstFrameUrl: "standard.png",
      archetypeInput: { model: "happyhorse/reference-to-video", reference_image_urls: ["c1", "c2"] },
    });
    expect(out).toEqual({
      first_frame_url: "standard.png",
      reference_images: [],
      model: "happyhorse/reference-to-video",
      reference_image_urls: ["c1", "c2"],
    });
  });

  it('同名键冲突：档案投影覆盖标准值（构造层投影是单一真相）', () => {
    const out = referenceInputParams({
      firstFrameUrl: "raw.png",
      archetypeInput: { first_frame_url: "mode-filtered.png" },
    });
    expect(out.first_frame_url).toBe("mode-filtered.png");
  });
});
