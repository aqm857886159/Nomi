// 主进程侧「modelKey → 档案 id」：身份表由档案生成，匹配规则与渲染层 identifierMatchesPattern 同源。
import { describe, expect, it } from "vitest";
import { archetypeIdForModel } from "./archetypeIdentity";
import { nativeWireProfileForArchetype } from "./nativeWireProfiles";
import { hostRootBase } from "../ai/requestPipeline";
import { archetypeParameterControls, EVERY_VARIANT, resolveModelArchetype } from "../shared/modelArchetypes";
import { getArchetypeById } from "../shared/modelArchetypes/builtInCatalog";

describe("archetypeIdForModel", () => {
  it("认出用户那三个 Seedance 2.0 变体，全都落火山档案", () => {
    expect(archetypeIdForModel("doubao-seedance-2-0-260128")).toBe("volcengine-seedance-2");
    expect(archetypeIdForModel("doubao-seedance-2-0-fast-260128")).toBe("volcengine-seedance-2");
    expect(archetypeIdForModel("doubao-seedance-2-0-mini-260615")).toBe("volcengine-seedance-2");
  });

  it("去掉 vendor 前缀后按末段匹配（与渲染层同规则）", () => {
    expect(archetypeIdForModel("bytedance/seedance-2")).toBe("seedance-2");
    expect(archetypeIdForModel("models/seedance-2")).toBe("seedance-2");
  });

  it("精确整串命中优先于末段命中，且不受档案声明顺序影响（认错模型=参数全错）", () => {
    // Tongyi-MAI/Z-Image-Turbo 在 modelscope-image 里列了完整 key；而 z-image-turbo 档案排在更前面、
    // 靠「末段相等」也能命中。单趟遍历会按声明顺序把它判给后者 —— 精确身份必须赢。
    expect(archetypeIdForModel("Tongyi-MAI/Z-Image-Turbo")).toBe("modelscope-image");
    expect(archetypeIdForModel("Tongyi-MAI/Z-Image")).toBe("modelscope-image");
    // 末段匹配本身仍要留着（用户自接时常带 vendor 前缀）。
    expect(archetypeIdForModel("bytedance/seedance-2")).toBe("seedance-2");
  });

  it("同名模型保留官方 key 大小写，分别命中 APIMart 与 KIE 档案", () => {
    expect(archetypeIdForModel("MiniMax-H3")).toBe("minimax-h3-apimart");
    expect(archetypeIdForModel("minimax-h3")).toBe("minimax-h3");
  });

  it("认不出的返回 null（不瞎猜）", () => {
    expect(archetypeIdForModel("some-unknown-model-xyz")).toBeNull();
    expect(archetypeIdForModel("")).toBeNull();
    expect(archetypeIdForModel(null)).toBeNull();
  });
});

describe("nativeWireProfileForArchetype", () => {
  it("火山 Seedance 档案有原生报文配方，且 t2v/i2v/query 都从主机根拼", () => {
    const p = nativeWireProfileForArchetype("volcengine-seedance-2");
    expect(p?.probePath).toBe("/api/v3/contents/generations/tasks");
    expect(p?.create.text_to_video?.pathFrom).toBe("host-root");
    expect(p?.create.image_to_video?.pathFrom).toBe("host-root");
    expect(p?.query?.pathFrom).toBe("host-root");
    // 原生 i2v body 必须真的读得到五类参考（这才是走它的理由）。
    const body = JSON.stringify(p?.create.image_to_video?.body);
    for (const key of [
      "volcengine_first_role_image_content",
      "volcengine_last_role_image_content",
      "volcengine_image_contents",
      "volcengine_video_contents",
      "volcengine_audio_contents",
    ]) {
      expect(body).toContain(key);
    }
  });

  it("火山 Seedream（图像）也有原生报文配方：同步族只有 create/edit、无轮询", () => {
    const p = nativeWireProfileForArchetype("volcengine-seedream");
    expect(p?.probePath).toBe("/api/v3/images/generations");
    expect(p?.create.text_to_image?.pathFrom).toBe("host-root");
    expect(p?.create.image_edit?.pathFrom).toBe("host-root");
    // 图像是同步族：出现轮询反而说明抄错了形状。
    expect(p?.query).toBeUndefined();
    // 走它的理由：改图读得到整组参考图（通用中转会把 Seedream 当**聊天模型**塞进 chat/completions）。
    expect(JSON.stringify(p?.create.image_edit?.body)).toContain("image_urls");
  });

  it("没有原生配方的档案返回 null", () => {
    expect(nativeWireProfileForArchetype("seedance-2")).toBeNull();
    expect(nativeWireProfileForArchetype(undefined)).toBeNull();
  });
});

describe("hostRootBase", () => {
  it("剥掉结尾的版本段，好让 /api/v3 从主机根拼（用户地址填了 /v1）", () => {
    expect(hostRootBase("https://sd.example.com:8443/v1")).toBe("https://sd.example.com:8443");
    expect(hostRootBase("https://sd.example.com:8443/v1/")).toBe("https://sd.example.com:8443");
    expect(hostRootBase("https://sd.example.com:8443")).toBe("https://sd.example.com:8443");
    // 只剥结尾一层：/codex/v1 → /codex（中间段是人家的路由前缀，不能动）
    expect(hostRootBase("https://code.example.com/codex/v1")).toBe("https://code.example.com/codex");
  });
});

// 2026-09-28：`nano-banana-pro` 是 Gemini 3 Pro Image（Nano Banana Pro）的别名，原先误挂在第一代 nano-banana 档案上。
// 自建渠道里叫这个名字的模型（没有显式 archetypeId，全靠身份识别）必须拿到 Gemini 3 Pro Image 的档案与参数面，
// 主进程（archetypeIdForModel，读生成的身份表）与渲染层（resolveModelArchetype，读档案本身）答案一致。
describe("nano-banana-pro 归 Gemini 3 Pro Image", () => {
  const customRow = { modelKey: "nano-banana-pro", modelAlias: null, vendorKey: "my-relay", meta: {} };

  it("两侧身份都认成 gemini-image-3-pro；第一代与原有别名不受影响", () => {
    expect(archetypeIdForModel("nano-banana-pro")).toBe("gemini-image-3-pro");
    expect(archetypeIdForModel("google/nano-banana-pro")).toBe("gemini-image-3-pro");
    expect(resolveModelArchetype(customRow, { variant: EVERY_VARIANT })?.id).toBe("gemini-image-3-pro");
    expect(archetypeIdForModel("nano-banana")).toBe("nano-banana");
    expect(archetypeIdForModel("gemini-3-pro-image-preview")).toBe("gemini-image-3-pro");
  });

  it("自建模型拿到的是 Gemini 3 Pro Image 的参数面，不是第一代 Nano Banana 的", () => {
    const controls = archetypeParameterControls(customRow);
    const gemini3Pro = getArchetypeById("gemini-image-3-pro")!;
    const nanoBanana = getArchetypeById("nano-banana")!;
    const defaultParams = (archetype: typeof gemini3Pro) =>
      archetype.modes.find((mode) => mode.id === archetype.defaultModeId)!.params;
    expect(controls).toEqual(defaultParams(gemini3Pro));
    expect(controls).not.toEqual(defaultParams(nanoBanana));
    // 可见差异：第一代的「格式」控件不在，Gemini 3 Pro 的比例取值（像素比，参考图上限 14）在。
    expect(controls?.some((control) => control.key === "output_format")).toBe(false);
  });
});
