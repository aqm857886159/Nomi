import { describe, it, expect } from "vitest";
import { hasImageEditReferences, taskTemplateParams, firstReferenceImage } from "./taskParams";

// 「接入即验证」的零额度一环：在不真跑、不花额度的前提下，核对"摊平给模板的参数"是否完整、类型对。
// 这些坑都只在真实参数构建里暴露（实测）：① duration 是数字被 firstString 吞成 ""；
// ② omni 参考数组该不该进 params；③ generate_audio 布尔值该原样保留。

describe("taskTemplateParams — 时长类型", () => {
  it("数字时长原样保留（修复点：number 5 不再被吞成空串）", () => {
    expect(taskTemplateParams({ extras: { duration: 5 } }).duration).toBe(5);
  });
  it("字符串时长 trim 后保留；缺省为空串", () => {
    expect(taskTemplateParams({ extras: { duration: " 8 " } }).duration).toBe("8");
    expect(taskTemplateParams({ extras: {} }).duration).toBe("");
  });
  it("durationSeconds / videoDuration 兜底", () => {
    expect(taskTemplateParams({ extras: { durationSeconds: 10 } }).duration).toBe(10);
  });
});

describe("taskTemplateParams — 档案参考输入（omni）", () => {
  it("archetypeInput 的 reference_image_urls 透传进 params（数组），generate_audio 布尔原样", () => {
    const params = taskTemplateParams({
      extras: {
        archetypeInput: { reference_image_urls: ["a.png", "b.png"] },
        generate_audio: true,
        resolution: "720p",
      },
    });
    expect(params.reference_image_urls).toEqual(["a.png", "b.png"]);
    expect(params.generate_audio).toBe(true);
    expect(params.resolution).toBe("720p");
  });
  it("无 archetypeInput → 不凭空造参考键", () => {
    const params = taskTemplateParams({ extras: { resolution: "1080p" } });
    expect(params).not.toHaveProperty("reference_image_urls");
  });
});

// 根因回归（2026-07-24 群反馈）：档案投影曾**独占**参考通道（archetypeInput 整包替换标准键）——
// 中转 gpt-image-2 的参考只剩 kie 键 input_urls，multipart 模板读 reference_images、chat 多模态读
// chat_image_parts、i2v 读 image_url，全空 → 改图不带图被拒/首帧到不了 wire。不变量：标准键先建、
// 档案键叠加其上（同名键档案权威）；内置家 body 只引用自家声明键，多出的标准键不进 body。
describe("referenceInputParams/taskTemplateParams — 标准键与档案键并存（中转不丢参考）", () => {
  it("档案模型（kie input_urls 键）+ 标准 referenceImages：两面并存，chat_image_parts/image_url 可派生", () => {
    const params = taskTemplateParams({
      extras: {
        archetypeInput: { input_urls: ["ref.png"], model: "gpt-image-2-image-to-image" },
        referenceImages: ["ref.png"],
      },
    });
    // 档案键照旧（kie/apimart body 读它）
    expect(params.input_urls).toEqual(["ref.png"]);
    // 标准键不再被吞（中转 multipart 模板读 reference_images）
    expect(params.reference_images).toEqual(["ref.png"]);
    // chat 多模态参考件由标准键派生（中转 chat/completions 图生图）
    expect(params.chat_image_parts).toEqual([{ type: "image_url", image_url: { url: "ref.png" } }]);
    // i2v/单图口径由标准面派生
    expect(params.image_url).toBe("ref.png");
  });

  it("档案首帧（标准 firstFrameUrl 并存）→ first_frame_url 与 image_url 都在场；同名键档案权威", () => {
    const params = taskTemplateParams({
      extras: {
        archetypeInput: { first_frame_url: "frame-A.png" },
        firstFrameUrl: "frame-A.png",
      },
    });
    expect(params.first_frame_url).toBe("frame-A.png");
    expect(params.image_url).toBe("frame-A.png");
  });

  it("同名键冲突时档案权威覆盖标准值（构造层投影是单一真相）", () => {
    const params = taskTemplateParams({
      extras: {
        archetypeInput: { first_frame_url: "mode-filtered.png" },
        firstFrameUrl: "raw-standard.png",
      },
    });
    expect(params.first_frame_url).toBe("mode-filtered.png");
  });
});

describe("firstReferenceImage — 单图首选", () => {
  it("按 image_url → imageUrl → firstFrameUrl → lastFrameUrl → referenceImages[0] 顺序取第一个非空", () => {
    expect(firstReferenceImage({ extras: { firstFrameUrl: "f.png" } })).toBe("f.png");
    expect(firstReferenceImage({ extras: { referenceImages: ["r.png"] } })).toBe("r.png");
    expect(firstReferenceImage({ extras: {} })).toBe("");
  });
});

describe("hasImageEditReferences — L3 诚实护栏判定（图生图/图生视频是否真带了参考）", () => {
  it("空 extras → false", () => {
    expect(hasImageEditReferences({ extras: {} })).toBe(false);
    expect(hasImageEditReferences({})).toBe(false);
  });
  it("referenceImages（非档案路）→ true", () => {
    expect(hasImageEditReferences({ extras: { referenceImages: ["https://cdn/a.png"] } })).toBe(true);
  });
  it("archetypeInput 只有 model enum + fixedParams（无任何 URL）→ false（enum 不算参考图）", () => {
    expect(hasImageEditReferences({ extras: { archetypeInput: { model: "gpt-image-2-image-to-image", generation_type: "edit" } } })).toBe(false);
  });
  it("archetypeInput.input_urls → true（gpt-image-2 i2i 口径）", () => {
    expect(hasImageEditReferences({ extras: { archetypeInput: { model: "gpt-image-2-image-to-image", input_urls: ["nomi-local://asset/p/a.png"] } } })).toBe(true);
  });
  it("volcengine content 项（嵌套 {image_url:{url}}）→ true", () => {
    expect(hasImageEditReferences({ extras: { archetypeInput: { volcengine_image_contents: [{ type: "image_url", image_url: { url: "https://cdn/a.png" }, role: "reference_image" }] } } })).toBe(true);
  });
  it("extras.image 裸键（headless/老调用方）→ true", () => {
    expect(hasImageEditReferences({ extras: { image: "https://cdn/first.png" } })).toBe(true);
  });
  it("firstFrameUrl 单图口径 → true", () => {
    expect(hasImageEditReferences({ extras: { firstFrameUrl: "https://cdn/f.png" } })).toBe(true);
  });
});
