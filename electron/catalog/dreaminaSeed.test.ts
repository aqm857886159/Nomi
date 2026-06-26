// 即梦全量接线回归测试：vendor + 视频/图片模型 + mapping + 档案模式，全对得上（多屏 UI 走查受限，用这个扎实兜底）。
import { describe, it, expect } from "vitest";
import type { CatalogState } from "./types";
import { selectTaskMapping } from "./types";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { getArchetypeById } from "../../src/config/modelArchetypes";

function emptyCatalog(): CatalogState {
  return { version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
}
const NOW = "2026-06-24T00:00:00.000Z";

describe("即梦 dreamina 全量接线", () => {
  const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);

  it("vendor：dreamina，authType none（设备码登录非 bearer）", () => {
    const v = state.vendors.find((x) => x.key === "dreamina");
    expect(v).toMatchObject({ key: "dreamina", enabled: true, authType: "none" });
  });

  it("模型：视频 1 + 图片 2，kind/档案正确", () => {
    const video = state.models.find((m) => m.modelKey === "dreamina-seedance-2.0");
    expect(video).toMatchObject({ vendorKey: "dreamina", kind: "video" });
    expect(video?.meta).toMatchObject({ archetypeId: "dreamina-seedance-2" });
    expect(state.models.find((m) => m.modelKey === "dreamina-image")).toMatchObject({ kind: "image" });
    expect(state.models.find((m) => m.modelKey === "dreamina-upscale")).toMatchObject({ kind: "image" });
  });

  it("mapping：t2v / i2v / t2i / i2i / upscale 各就位且走 process（非 HTTP）", () => {
    const t2v = selectTaskMapping(state.mappings, "dreamina", "text_to_video", "dreamina-seedance-2.0");
    const i2v = selectTaskMapping(state.mappings, "dreamina", "image_to_video", "dreamina-seedance-2.0");
    const t2i = selectTaskMapping(state.mappings, "dreamina", "text_to_image", "dreamina-image");
    const i2i = selectTaskMapping(state.mappings, "dreamina", "image_edit", "dreamina-image");
    const upscale = selectTaskMapping(state.mappings, "dreamina", "image_edit", "dreamina-upscale");
    for (const m of [t2v, i2v, t2i, i2i, upscale]) {
      expect(m).toBeTruthy();
      expect(m?.create.process?.parser).toBe("dreamina-cli"); // process transport，不是 HTTP path
      expect(m?.query?.process?.args?.[0]).toBe("query_result");
    }
    // i2i / upscale 同 image_edit 桶但不同 modelKey → 各自精确路由，不撞车
    expect(i2i?.id).not.toBe(upscale?.id);
    // 子命令正确
    expect(t2v?.create.process?.args?.[0]).toBe("text2video");
    expect(t2i?.create.process?.args?.[0]).toBe("text2image");
  });

  it("image_to_video 合并 mapping：子命令取 dreamina_cmd + fileParams 覆盖 i2v/首尾帧/全能参考输入", () => {
    const i2v = selectTaskMapping(state.mappings, "dreamina", "image_to_video", "dreamina-seedance-2.0");
    expect(i2v?.create.process?.args?.[0]).toBe("{{request.params.dreamina_cmd}}");
    const fileParams = i2v?.create.process?.fileParams || [];
    const params = fileParams.map((f) => f.param);
    expect(params).toEqual(expect.arrayContaining(["i2v_image", "frames_first", "frames_last", "mm_images", "mm_videos", "mm_audios"]));
    // 全能参考多文件用重复 flag
    expect(fileParams.find((f) => f.param === "mm_images")?.mode).toBe("repeat");
  });

  it("改图/超清 mapping 声明 fileParams（输入图物化成本地路径）", () => {
    const i2i = selectTaskMapping(state.mappings, "dreamina", "image_edit", "dreamina-image");
    const upscale = selectTaskMapping(state.mappings, "dreamina", "image_edit", "dreamina-upscale");
    expect(i2i?.create.process?.fileParams?.[0]).toMatchObject({ param: "input_images", mode: "csv" });
    expect(upscale?.create.process?.fileParams?.[0]).toMatchObject({ param: "input_image", mode: "single" });
  });

  it("档案：seedance 4 模式（fixedParams 选子命令）+ 5 变体", () => {
    const arch = getArchetypeById("dreamina-seedance-2");
    expect(arch?.kind).toBe("video");
    const cmds = (arch?.modes || []).map((m) => m.fixedParams?.dreamina_cmd);
    expect(cmds).toEqual(["text2video", "image2video", "frames2video", "multimodal2video"]);
    expect(arch?.variants?.map((v) => v.modelKey)).toEqual([
      "seedance2.0fast", "seedance2.0", "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini",
    ]);
  });

  it("多帧：独立无变体模型 + image_to_video mapping（build=multiframe，不撞 seedance modelKey）", () => {
    expect(state.models.find((m) => m.modelKey === "dreamina-multiframe")).toMatchObject({ kind: "video" });
    const mf = selectTaskMapping(state.mappings, "dreamina", "image_to_video", "dreamina-multiframe");
    expect(mf?.create.process?.build).toBe("multiframe");
    expect(mf?.create.process?.fileParams?.[0]).toMatchObject({ param: "mf_images", mode: "array" });
    // 与 seedance 的 image_to_video 不是同一条（modelKey 区分路由）
    const seedanceI2v = selectTaskMapping(state.mappings, "dreamina", "image_to_video", "dreamina-seedance-2.0");
    expect(mf?.id).not.toBe(seedanceI2v?.id);
    expect(getArchetypeById("dreamina-multiframe")?.modes?.[0]?.slots?.[0]).toMatchObject({ min: 2, max: 20 });
  });

  it("档案：图片 t2i+i2i 模式 + 8 模型变体", () => {
    const arch = getArchetypeById("dreamina-image");
    expect(arch?.kind).toBe("image");
    expect((arch?.modes || []).map((m) => m.id)).toEqual(["t2i", "i2i"]);
    expect(arch?.variants).toHaveLength(8); // 3.0/3.1/4.0/4.1/4.5/4.6/4.7/5.0
  });
});
