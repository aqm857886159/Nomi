import { describe, it, expect } from "vitest";
import {
  parseComfyApiWorkflow,
  analyzeComfyWorkflow,
  buildImportedWorkflow,
  buildComfyImportModelMapping,
  collectGraphEnumOptions,
  importComfyWorkflow,
  normalizeWorkflowBinding,
  reconcileComfyWorkflow,
  slugifyModelKey,
  type ComfyGraph,
} from "./comfyuiWorkflowImport";
import { parseObjectInfoIndex } from "../comfyuiObjectInfo";
import { buildTemplateContext, renderTemplateValue } from "../ai/requestPipeline";
import { taskTemplateParams, applyWireDefaults } from "./taskParams";

// SD 文生图（API 格式，CLIPTextEncode 正/负 + SaveImage）。
const SD_T2I: ComfyGraph = {
  "3": { class_type: "KSampler", inputs: { seed: 42, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd.safetensors" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "a cat", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "bad", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "x", images: ["8", 0] } },
};

// WAN 图生视频（LoadImage 首帧 + VHS_VideoCombine 输出）。
const WAN_I2V: ComfyGraph = {
  "1": { class_type: "LoadImage", inputs: { image: "start.png", upload: "image" } },
  "2": { class_type: "CLIPTextEncode", _meta: { title: "Positive" }, inputs: { text: "a dragon flying", clip: ["5", 0] } },
  "3": { class_type: "KSampler", inputs: { seed: 123, steps: 30, cfg: 6, model: ["6", 0], positive: ["2", 0], negative: ["7", 0], latent_image: ["8", 0] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["5", 0] } },
  "8": { class_type: "Wan22ImageToVideoLatent", inputs: { width: 640, height: 640, length: 49, start_image: ["1", 0] } },
  "9": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["6", 2] } },
  "10": { class_type: "VHS_VideoCombine", inputs: { images: ["9", 0], frame_rate: 24, filename_prefix: "wan" } },
};

// Krea2 风格：正向 CLIPTextEncode.text 不是直接字符串，而是经过 switch/preview/text-generate/concat 后接到用户输入节点。
const KREA2_LINKED_PROMPT: ComfyGraph = {
  "29": { class_type: "SaveImage", inputs: { filename_prefix: "Krea2_turbo", images: ["30:8", 0] } },
  "30:3": { class_type: "KSampler", inputs: { seed: 261447842805908, steps: 8, cfg: 1, positive: ["30:6", 0], negative: ["30:13", 0], latent_image: ["30:5", 0] } },
  "30:6": { class_type: "CLIPTextEncode", inputs: { text: ["30:28", 0], clip: ["30:11", 0] } },
  "30:8": { class_type: "VAEDecode", inputs: { samples: ["30:3", 0], vae: ["30:12", 0] } },
  "30:13": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["30:6", 0] } },
  "30:16": { class_type: "TextGenerate", inputs: { prompt: ["30:17", 0], clip: ["30:11", 0] } },
  "30:17": { class_type: "StringConcatenate", inputs: { string_a: ["30:18", 0], string_b: ["30:19", 0], delimiter: "" } },
  "30:18": { class_type: "PrimitiveStringMultiline", _meta: { title: "Text String (System Prompt)" }, inputs: { value: "system prompt" } },
  "30:19": { class_type: "PrimitiveStringMultiline", _meta: { title: "Text String (User Prompt)" }, inputs: { value: "" } },
  "30:20": { class_type: "PreviewAny", inputs: { source: ["30:21", 0] } },
  "30:21": { class_type: "ComfySwitchNode", inputs: { switch: ["30:24", 0], on_false: ["30:19", 0], on_true: ["30:16", 0] } },
  "30:23": { class_type: "PrimitiveBoolean", inputs: { value: false } },
  "30:24": { class_type: "PrimitiveBoolean", inputs: { value: false } },
  "30:27": { class_type: "StringConcatenate", inputs: { string_a: ["30:20", 0], string_b: "", delimiter: ", " } },
  "30:28": { class_type: "ComfySwitchNode", inputs: { switch: ["30:23", 0], on_false: ["30:20", 0], on_true: ["30:27", 0] } },
};

const WAN_FIRST_LAST_FRAME: ComfyGraph = {
  "72": { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" } },
  "78": { class_type: "CLIPTextEncode", inputs: { text: "bad quality", clip: ["72", 0] } },
  "79": { class_type: "VAELoader", inputs: { vae_name: "wan_2.1_vae.safetensors" } },
  "80": { class_type: "LoadImage", inputs: { image: "pasted/start.png" } },
  "81": {
    class_type: "WanFirstLastFrameToVideo",
    inputs: {
      width: 640,
      height: 640,
      length: 81,
      batch_size: 1,
      positive: ["90", 0],
      negative: ["78", 0],
      vae: ["79", 0],
      start_image: ["80", 0],
      end_image: ["89", 0],
    },
  },
  "83": { class_type: "SaveVideo", inputs: { filename_prefix: "video/ComfyUI", video: ["86", 0] } },
  "86": { class_type: "CreateVideo", inputs: { fps: 16, images: ["85", 0] } },
  "89": { class_type: "LoadImage", inputs: { image: "pasted/end.png" } },
  "90": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["72", 0] } },
};

// LTX 2.3 常见形态：UI 里显示 WIDTH/HEIGHT/FPS/seconds，但真正接入图的是常量节点 value。
const LTX_CONSTANT_PARAMS: ComfyGraph = {
  "108": { class_type: "LTXVImgToVideo", inputs: { width: ["292", 0], height: ["293", 0], length: ["287", 0], positive: ["110", 0], image: ["200", 0] } },
  "110": { class_type: "CLIPTextEncode", inputs: { text: "default prompt", clip: ["111", 0] } },
  "111": { class_type: "CLIPLoader", inputs: { clip_name: "t5xxl_fp16.safetensors" } },
  "200": { class_type: "LoadImage", inputs: { image: "start.png" } },
  "285": { class_type: "PrimitiveFloat", _meta: { title: "FPS" }, inputs: { value: 24 } },
  "287": { class_type: "SimpleCalculatorKJ", inputs: { a: ["291", 0], b: ["285", 0], operation: "multiply" } },
  "291": { class_type: "INTConstant", _meta: { title: "LENGTH (in seconds)" }, inputs: { value: 5 } },
  "292": { class_type: "INTConstant", _meta: { title: "WIDTH" }, inputs: { value: 960 } },
  "293": { class_type: "INTConstant", _meta: { title: "HEIGHT" }, inputs: { value: 544 } },
  "300": { class_type: "SaveVideo", inputs: { video: ["108", 0], filename_prefix: "ltx" } },
};

describe("parseComfyApiWorkflow", () => {
  it("接受 API 格式", () => {
    expect(Object.keys(parseComfyApiWorkflow(JSON.stringify(SD_T2I)))).toContain("3");
  });
  it("拒 UI 保存格式（nodes[]/links[]）→ 教用户改导 API 格式", () => {
    expect(() => parseComfyApiWorkflow(JSON.stringify({ nodes: [], links: [], version: 0.4 }))).toThrow(/Export \(API\)/);
  });
  it("拒非法 JSON / 空 / 缺 class_type", () => {
    expect(() => parseComfyApiWorkflow("{not json")).toThrow(/JSON/);
    expect(() => parseComfyApiWorkflow("{}")).toThrow(/空/);
    expect(() => parseComfyApiWorkflow(JSON.stringify({ "1": { inputs: {} } }))).toThrow(/class_type/);
  });
});

describe("analyzeComfyWorkflow", () => {
  it("SD 文生图：正向提示词=被 positive 连的节点(6)、无首帧、输出图片、数值候选", () => {
    const a = analyzeComfyWorkflow(SD_T2I);
    expect(a.suggested.promptNodeId).toBe("6"); // node3.positive → ["6",0]
    expect(a.suggested.firstFrameNodeId).toBeUndefined();
    expect(a.suggested.outputKind).toBe("image");
    expect(a.suggested.numeric.map((n) => n.inputKey)).toEqual(expect.arrayContaining(["seed", "steps", "cfg", "width", "height"]));
  });
  it("WAN 图生视频：识别首帧(LoadImage 1)、正向提示词(2)、视频输出(VHS 10)", () => {
    const a = analyzeComfyWorkflow(WAN_I2V);
    expect(a.suggested.firstFrameNodeId).toBe("1");
    expect(a.suggested.firstFrameInputKey).toBe("image");
    expect(a.suggested.promptNodeId).toBe("2");
    expect(a.suggested.outputNodeId).toBe("10");
    expect(a.suggested.outputKind).toBe("video");
    expect(a.suggested.numeric.map((n) => n.inputKey)).toEqual(expect.arrayContaining(["seed", "length", "frame_rate"]));
  });
  it("Krea2：沿 positive 的 CLIPTextEncode.text 连线追到用户输入 PrimitiveStringMultiline.value", () => {
    const a = analyzeComfyWorkflow(KREA2_LINKED_PROMPT);
    expect(a.textInputs.map((t) => `${t.nodeId}.${t.inputKey}`)).toContain("30:19.value");
    expect(a.suggested.promptNodeId).toBe("30:19");
    expect(a.suggested.promptInputKey).toBe("value");
    expect(a.suggested.outputNodeId).toBe("29");
    expect(a.suggested.outputKind).toBe("image");
  });
  it("WAN 首尾帧：按 start_image/end_image 识别首帧和尾帧 LoadImage", () => {
    const a = analyzeComfyWorkflow(WAN_FIRST_LAST_FRAME);
    expect(a.suggested.promptNodeId).toBe("90");
    expect(a.suggested.firstFrameNodeId).toBe("80");
    expect(a.suggested.firstFrameInputKey).toBe("image");
    expect(a.suggested.lastFrameNodeId).toBe("89");
    expect(a.suggested.lastFrameInputKey).toBe("image");
    expect(a.suggested.outputNodeId).toBe("83");
    expect(a.suggested.outputKind).toBe("video");
  });
  it("LTX 常量节点：把 WIDTH/HEIGHT/FPS/seconds 暴露为可手动选择的 widget 输入", () => {
    const a = analyzeComfyWorkflow(LTX_CONSTANT_PARAMS);
    expect(a.widgetInputs.map((n) => `${n.nodeId}.${n.inputKey}`)).toEqual(expect.arrayContaining(["292.value", "293.value", "285.value", "291.value"]));
    expect(a.suggested.numeric.map((n) => `${n.nodeId}.${n.inputKey}`)).not.toEqual(expect.arrayContaining(["292.value", "293.value", "285.value", "291.value"]));
  });
});

describe("normalizeWorkflowBinding", () => {
  const graph: ComfyGraph = {
    "1": { class_type: "Sampler", inputs: { seed: 7, steps: 20, enabled: true, model: ["9", 0] } },
    "2": { class_type: "TextInput", inputs: { text: "author prompt" } },
  };

  it("只保留真实标量目标，并拒绝重复目标、连线、缺失目标和角色冲突", () => {
    const normalized = normalizeWorkflowBinding({
      promptNodeId: "2",
      promptInputKey: "text",
      params: [
        { nodeId: "1", inputKey: "seed", paramKey: "123 bad key", label: "", type: "number" },
        { nodeId: "1", inputKey: "seed", paramKey: "duplicate-target", label: "重复", type: "number", default: 99 },
        { nodeId: "1", inputKey: "steps", paramKey: "123 bad key", label: "Steps", type: "number" },
        { nodeId: "1", inputKey: "enabled", paramKey: "enabled", label: "Enabled", type: "wrong" },
        { nodeId: "1", inputKey: "model", paramKey: "model", label: "连线", type: "text", default: "bad" },
        { nodeId: "missing", inputKey: "seed", paramKey: "missing", label: "缺节点", type: "number", default: 1 },
        { nodeId: "2", inputKey: "text", paramKey: "prompt", label: "角色冲突", type: "text", default: "bad" },
        null,
      ],
    }, graph);

    expect(normalized.params).toEqual([
      { nodeId: "1", inputKey: "seed", paramKey: "comfy__123_bad_key", label: "seed", type: "number", default: 7 },
      { nodeId: "1", inputKey: "steps", paramKey: "comfy__123_bad_key_2", label: "Steps", type: "number", default: 20 },
      { nodeId: "1", inputKey: "enabled", paramKey: "comfy_enabled", label: "Enabled", type: "boolean", default: true },
    ]);
    expect(normalized.params?.every((param) => /^comfy_[A-Za-z0-9_]+$/.test(param.paramKey))).toBe(true);
  });

  it("params 字段只要存在就不复活 numeric；显式空数组和坏形状都归一为空", () => {
    const numeric = [{ nodeId: "1", inputKey: "seed", paramKey: "comfy_seed", label: "Seed", default: 7 }];
    expect(normalizeWorkflowBinding({ params: [], numeric }, graph).params).toEqual([]);
    expect(normalizeWorkflowBinding({ params: null, numeric }, graph).params).toEqual([]);
  });

  it("同一个 widget 不能同时承担多个角色，按提示词、首帧、尾帧、源视频顺序保留第一个", () => {
    const mediaGraph: ComfyGraph = {
      "1": { class_type: "LoadImage", inputs: { image: "author.png" } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const normalized = normalizeWorkflowBinding({
      firstFrameNodeId: "1", firstFrameInputKey: "image",
      lastFrameNodeId: "1", lastFrameInputKey: "image",
      sourceVideoNodeId: "missing", sourceVideoInputKey: "file",
      outputNodeId: "2", outputKind: "image", params: [],
    }, mediaGraph);
    // 老角色读时折进 images[]，且同一个 widget **只保留第一个**——不能同时当首帧和尾帧。
    expect(normalized.images).toEqual([
      { nodeId: "1", inputKey: "image", paramKey: "first_frame_url", label: "image", mediaKind: "image" },
    ]);
    // 迁移后老字段从产物里消失：写路径与消费路径只认 images[]，不留并行版（P1）。
    expect(normalized).not.toHaveProperty("firstFrameNodeId");
    expect(normalized).not.toHaveProperty("lastFrameNodeId");
    expect(normalized).not.toHaveProperty("sourceVideoNodeId");

    const built = buildImportedWorkflow(mediaGraph, normalized);
    expect(built.templatedGraph["1"].inputs?.image).toBe("{{request.params.first_frame_url}}");
  });

  it("normalize 幂等：binding 反复过一遍（IPC→落库→读出），保留键不被再套一层 comfy_ 命名空间", () => {
    // 反例代价很实在：first_frame_url 第二遍变成 comfy_first_frame_url，
    // 模板图里写死的占位当场对不上 → 图静默收不到素材，界面上还看不出任何异常。
    const mediaGraph: ComfyGraph = {
      "1": { class_type: "LoadImage", inputs: { image: "author.png" } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const once = normalizeWorkflowBinding({
      firstFrameNodeId: "1", firstFrameInputKey: "image", outputNodeId: "2", outputKind: "image", params: [],
    }, mediaGraph);
    const twice = normalizeWorkflowBinding(once, mediaGraph);
    expect(twice).toEqual(once);
    expect(twice.images?.[0]?.paramKey).toBe("first_frame_url");
  });

  it("声明几个图像输入就出几条 images——多参工作流不再被压成首/尾帧两个角色", () => {
    // 群反馈 2026-08-20 G2#421：多参工作流「连一个图片就不能再连」。
    // ComfyUI 侧一张工作流就是 N 个 LoadImage，各自一个 image widget（官方 workflow API format），
    // 所以三个图像输入必须出三条，各自注各自的参。
    const threeImageGraph: ComfyGraph = {
      "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
      "2": { class_type: "LoadImage", inputs: { image: "b.png" } },
      "3": { class_type: "LoadImage", inputs: { image: "c.png" } },
      "9": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const normalized = normalizeWorkflowBinding({
      images: [
        { nodeId: "1", inputKey: "image", paramKey: "ref_a", label: "参考图 A", mediaKind: "image" },
        { nodeId: "2", inputKey: "image", paramKey: "ref_b", label: "参考图 B", mediaKind: "image" },
        { nodeId: "3", inputKey: "image", paramKey: "ref_c", label: "参考图 C", mediaKind: "image" },
      ],
      outputNodeId: "9", outputKind: "image", params: [],
    }, threeImageGraph);
    expect(normalized.images).toHaveLength(3);

    const built = buildImportedWorkflow(threeImageGraph, normalized);
    expect(built.templatedGraph["1"].inputs?.image).toBe("{{request.params.comfy_ref_a}}");
    expect(built.templatedGraph["2"].inputs?.image).toBe("{{request.params.comfy_ref_b}}");
    expect(built.templatedGraph["3"].inputs?.image).toBe("{{request.params.comfy_ref_c}}");
    // 每条都进 parameters[] 且标成 image-url —— 画布的通用出槽器据此长出 3 个槽。
    const imageParams = built.parameters.filter((p) => p.type === "image-url");
    expect(imageParams.map((p) => p.key)).toEqual(["comfy_ref_a", "comfy_ref_b", "comfy_ref_c"]);
  });

  it("一个图像输入都没声明 → 一条都不出，绝不瞎猜首/尾帧", () => {
    const textOnlyGraph: ComfyGraph = {
      "1": { class_type: "CLIPTextEncode", inputs: { text: "hi" } },
      "9": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const normalized = normalizeWorkflowBinding({ outputNodeId: "9", outputKind: "image", params: [] }, textOnlyGraph);
    expect(normalized.images).toEqual([]);
    expect(buildImportedWorkflow(textOnlyGraph, normalized).parameters.filter((p) => p.type === "image-url")).toEqual([]);
  });

  it("params 缺失时迁移 legacy numeric，缺省值可从原图安全补齐且不再保留 numeric", () => {
    const normalized = normalizeWorkflowBinding({
      outputNodeId: "9",
      outputKind: "image",
      numeric: [{ nodeId: "1", inputKey: "seed", paramKey: "comfy_seed", label: "Seed" }],
    }, graph);
    expect(normalized).toEqual({
      outputNodeId: "9",
      outputKind: "image",
      images: [],
      params: [{ nodeId: "1", inputKey: "seed", paramKey: "comfy_seed", label: "Seed", type: "number", default: 7 }],
    });
    expect(normalized).not.toHaveProperty("numeric");
  });

  it("合法的标准请求键也强制进入 comfy_ 命名空间，模板渲染时不会被 request.width 覆盖", () => {
    const widthGraph: ComfyGraph = {
      "1": { class_type: "EmptyImage", inputs: { width: 512, height: 512, batch_size: 1 } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const binding = normalizeWorkflowBinding({
      outputNodeId: "2",
      outputKind: "image",
      params: [{ nodeId: "1", inputKey: "width", paramKey: "width", label: "Width", type: "number", default: 1024 }],
    }, widthGraph);
    expect(binding.params?.[0]?.paramKey).toBe("comfy_width");

    const built = buildImportedWorkflow(widthGraph, binding);
    const extras = applyWireDefaults({}, Object.fromEntries(built.parameters.map((param) => [param.key, param.default])));
    const params = taskTemplateParams({ extras });
    const context = buildTemplateContext({ request: { prompt: "", extras }, params, model: {}, modelKey: "generic", apiKey: "" });
    const rendered = renderTemplateValue({ prompt: built.templatedGraph }, context) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(params.comfy_width).toBe(1024);
    expect(rendered.prompt["1"].inputs.width).toBe(1024);
  });
});

describe("buildImportedWorkflow", () => {
  it("WAN i2v：提示词/首帧/数值 → {{}} 占位；连线不动；kind/taskKind 正确", () => {
    const a = analyzeComfyWorkflow(WAN_I2V);
    const built = buildImportedWorkflow(WAN_I2V, a.suggested);
    expect(built.templatedGraph["2"].inputs!.text).toBe("{{request.prompt}}");
    expect(built.templatedGraph["1"].inputs!.image).toBe("{{request.params.first_frame_url}}");
    expect(built.templatedGraph["3"].inputs!.seed).toBe("{{request.params.comfy_seed}}");
    expect(built.templatedGraph["8"].inputs!.length).toBe("{{request.params.comfy_length}}");
    expect(built.templatedGraph["10"].inputs!.frame_rate).toBe("{{request.params.comfy_frame_rate}}");
    // 连线原样不动
    expect(built.templatedGraph["3"].inputs!.model).toEqual(["6", 0]);
    expect(built.templatedGraph["8"].inputs!.start_image).toEqual(["1", 0]);
    expect(built.kind).toBe("video");
    expect(built.taskKind).toBe("image_to_video");
    expect(built.parameters.find((p) => p.key === "comfy_seed")?.default).toBe(123);
    expect(built.parameters.find((p) => p.key === "comfy_length")?.default).toBe(49);
    // 不改原图（深拷贝）
    expect(WAN_I2V["2"].inputs!.text).toBe("a dragon flying");
  });
  it("SD t2i：无首帧 → taskKind text_to_image / kind image", () => {
    const a = analyzeComfyWorkflow(SD_T2I);
    const built = buildImportedWorkflow(SD_T2I, a.suggested);
    expect(built.kind).toBe("image");
    expect(built.taskKind).toBe("text_to_image");
    expect(built.templatedGraph["6"].inputs!.text).toBe("{{request.prompt}}");
  });
  it("Krea2：把 request.prompt 注入到上游用户输入节点，保留 CLIPTextEncode 连线", () => {
    const a = analyzeComfyWorkflow(KREA2_LINKED_PROMPT);
    const built = buildImportedWorkflow(KREA2_LINKED_PROMPT, a.suggested);
    expect(built.templatedGraph["30:19"].inputs!.value).toBe("{{request.prompt}}");
    expect(built.templatedGraph["30:6"].inputs!.text).toEqual(["30:28", 0]);
    expect(built.kind).toBe("image");
    expect(built.taskKind).toBe("text_to_image");
  });
  it("WAN 首尾帧：首帧/尾帧分别注入 first_frame_url / last_frame_url", () => {
    const a = analyzeComfyWorkflow(WAN_FIRST_LAST_FRAME);
    const built = buildImportedWorkflow(WAN_FIRST_LAST_FRAME, a.suggested);
    expect(built.templatedGraph["80"].inputs!.image).toBe("{{request.params.first_frame_url}}");
    expect(built.templatedGraph["89"].inputs!.image).toBe("{{request.params.last_frame_url}}");
    expect(built.templatedGraph["80"]._meta?.nomi_bound_media_input).toBe("image");
    expect(built.templatedGraph["89"]._meta?.nomi_bound_media_input).toBe("image");
    expect(built.templatedGraph["90"].inputs!.text).toBe("{{request.prompt}}");
    expect(built.kind).toBe("video");
    expect(built.taskKind).toBe("image_to_video");
  });
  it("旧 numeric 绑定仍兼容：没有 params 时继续生成 number 参数", () => {
    const built = buildImportedWorkflow(WAN_I2V, {
      promptNodeId: "2",
      promptInputKey: "text",
      outputNodeId: "10",
      outputKind: "video",
      numeric: [{ nodeId: "3", inputKey: "seed", paramKey: "comfy_seed", label: "随机种子", default: 123 }],
    });
    expect(built.templatedGraph["3"].inputs!.seed).toBe("{{request.params.comfy_seed}}");
    expect(built.parameters).toEqual([{ key: "comfy_seed", label: "随机种子", type: "number", default: 123 }]);
  });
  it("显式 params 空数组优先于旧 numeric：用户删除全部参数后不会自动恢复", () => {
    const built = buildImportedWorkflow(WAN_I2V, {
      promptNodeId: "2",
      promptInputKey: "text",
      outputNodeId: "10",
      outputKind: "video",
      numeric: [{ nodeId: "3", inputKey: "seed", paramKey: "comfy_seed", label: "随机种子", default: 123 }],
      params: [],
    });
    expect(built.templatedGraph["3"].inputs!.seed).toBe(123);
    expect(built.parameters).toEqual([]);
  });
  it("LTX 手动参数：常量节点 value 可映射成生成时参数", () => {
    const a = analyzeComfyWorkflow(LTX_CONSTANT_PARAMS);
    const built = buildImportedWorkflow(LTX_CONSTANT_PARAMS, {
      ...a.suggested,
      params: [
        { nodeId: "292", inputKey: "value", paramKey: "comfy_width", label: "宽度", type: "number", default: 960 },
        { nodeId: "293", inputKey: "value", paramKey: "comfy_height", label: "高度", type: "number", default: 544 },
        { nodeId: "291", inputKey: "value", paramKey: "comfy_seconds", label: "秒数", type: "number", default: 5 },
        { nodeId: "285", inputKey: "value", paramKey: "comfy_fps", label: "帧率", type: "number", default: 24 },
      ],
    });
    expect(built.templatedGraph["292"].inputs!.value).toBe("{{request.params.comfy_width}}");
    expect(built.templatedGraph["293"].inputs!.value).toBe("{{request.params.comfy_height}}");
    expect(built.templatedGraph["291"].inputs!.value).toBe("{{request.params.comfy_seconds}}");
    expect(built.templatedGraph["285"].inputs!.value).toBe("{{request.params.comfy_fps}}");
    // 图像输入现在也是一条声明参数（type:'image-url'，排在数值参数前）——画布据此出槽。
    expect(built.parameters.map((p) => p.key)).toEqual(["first_frame_url", "comfy_width", "comfy_height", "comfy_seconds", "comfy_fps"]);
  });

  it("媒体所有权标记保留作者已有的 _meta", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "LoadImage", inputs: { image: "author.png" }, _meta: { title: "Reference image" } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const built = buildImportedWorkflow(graph, {
      firstFrameNodeId: "1",
      firstFrameInputKey: "image",
      outputNodeId: "2",
      outputKind: "image",
      params: [],
    });
    expect(built.templatedGraph["1"]._meta).toEqual({ title: "Reference image", nomi_bound_media_input: "image" });
    expect(graph["1"]._meta).toEqual({ title: "Reference image" });
  });
});

describe("buildComfyImportModelMapping", () => {
  it("视频工作流 → model kind video + mapping i2v + query 读 video_url + comfyui-history 变换", () => {
    const built = buildImportedWorkflow(WAN_I2V, analyzeComfyWorkflow(WAN_I2V).suggested);
    const { model, mapping } = buildComfyImportModelMapping(built, { modelKey: "comfy-wan-i2v", labelZh: "本地 WAN 图生视频" });
    expect(model.vendorKey).toBe("comfyui-local");
    expect(model.kind).toBe("video");
    expect((model.meta as { parameters: unknown[] }).parameters.length).toBeGreaterThan(0);
    expect(mapping.taskKind).toBe("image_to_video");
    const query = mapping.query as { response_transform: string; response_mapping: Record<string, string> };
    expect(query.response_transform).toBe("comfyui-history");
    expect(query.response_mapping.video_url).toBe("video_url");
    const create = mapping.create as { body: { prompt: unknown; client_id: string }; defaultParams: Record<string, unknown> };
    expect(create.body.client_id).toBe("nomi");
    expect(create.defaultParams.comfy_seed).toBe(123);
  });

  it("UI workflow 与 API prompt 分开保存：执行用 prompt，可复现元数据进 extra_pnginfo", () => {
    const built = buildImportedWorkflow(SD_T2I, analyzeComfyWorkflow(SD_T2I).suggested);
    const uiWorkflow = { nodes: [{ id: 9, type: "SaveImage" }], links: [] };
    const { model, mapping } = buildComfyImportModelMapping(built, {
      modelKey: "comfy-ui-source",
      labelZh: "UI source",
      draft: { text: JSON.stringify(SD_T2I), binding: analyzeComfyWorkflow(SD_T2I).suggested, uiWorkflowText: JSON.stringify(uiWorkflow) },
    });
    const body = (mapping.create as { body: Record<string, unknown> }).body;
    expect(body.prompt).toEqual(built.templatedGraph);
    expect(body.extra_data).toEqual({ extra_pnginfo: { workflow: uiWorkflow } });
    expect(body.partial_execution_targets).toEqual([analyzeComfyWorkflow(SD_T2I).suggested.outputNodeId]);
    expect((model.meta as { comfyWorkflowImport: { uiWorkflowText?: string } }).comfyWorkflowImport.uiWorkflowText)
      .toBe(JSON.stringify(uiWorkflow));
    expect((mapping.create as { request_transform?: string }).request_transform).toBe("comfyui-prompt");
  });
});

describe("导入的图跑通真注参管线（证 {{}} 全被填、数字保持数字、连线不动）", () => {
  it("WAN i2v：prompt/first_frame/数值都注入，model/latent 连线原样", () => {
    const built = buildImportedWorkflow(WAN_I2V, analyzeComfyWorkflow(WAN_I2V).suggested);
    const { mapping } = buildComfyImportModelMapping(built, { modelKey: "comfy-wan-i2v", labelZh: "WAN i2v" });
    const create = mapping.create as { body: unknown; defaultParams: Record<string, unknown> };
    // 模拟运行：first_frame_url 已由 S2 上传换成 ComfyUI 文件名 "in/frame.png"
    const extras = applyWireDefaults({ firstFrameUrl: "in/frame.png" }, create.defaultParams);
    const params = taskTemplateParams({ extras });
    const context = buildTemplateContext({ request: { prompt: "a dragon flying", extras }, params, model: {}, modelKey: "comfy-wan-i2v", apiKey: "" });
    const body = renderTemplateValue(create.body, context) as { prompt: Record<string, { inputs: Record<string, unknown> }> };
    expect(body.prompt["2"].inputs.text).toBe("a dragon flying");
    expect(body.prompt["1"].inputs.image).toBe("in/frame.png");
    expect(body.prompt["3"].inputs.seed).toBe(123);
    expect(typeof body.prompt["3"].inputs.seed).toBe("number");
    expect(body.prompt["8"].inputs.length).toBe(49);
    expect(body.prompt["3"].inputs.model).toEqual(["6", 0]);
  });
  it("WAN 首尾帧：模板渲染后首尾帧都是 ComfyUI 上传文件名", () => {
    const built = buildImportedWorkflow(WAN_FIRST_LAST_FRAME, analyzeComfyWorkflow(WAN_FIRST_LAST_FRAME).suggested);
    const { mapping } = buildComfyImportModelMapping(built, { modelKey: "comfy-wan-flf", labelZh: "WAN 首尾帧" });
    const create = mapping.create as { body: unknown; defaultParams: Record<string, unknown> };
    const extras = applyWireDefaults({ firstFrameUrl: "input/start.png", lastFrameUrl: "input/end.png" }, create.defaultParams);
    const params = taskTemplateParams({ extras });
    const context = buildTemplateContext({ request: { prompt: "a camera move", extras }, params, model: {}, modelKey: "comfy-wan-flf", apiKey: "" });
    const body = renderTemplateValue(create.body, context) as { prompt: Record<string, { inputs: Record<string, unknown> }> };
    expect(body.prompt["80"].inputs.image).toBe("input/start.png");
    expect(body.prompt["89"].inputs.image).toBe("input/end.png");
  });
  it("LTX 手动参数：模板渲染后尺寸/秒数/FPS 保持数字", () => {
    const built = buildImportedWorkflow(LTX_CONSTANT_PARAMS, {
      ...analyzeComfyWorkflow(LTX_CONSTANT_PARAMS).suggested,
      params: [
        { nodeId: "292", inputKey: "value", paramKey: "comfy_width", label: "宽度", type: "number", default: 960 },
        { nodeId: "293", inputKey: "value", paramKey: "comfy_height", label: "高度", type: "number", default: 544 },
        { nodeId: "291", inputKey: "value", paramKey: "comfy_seconds", label: "秒数", type: "number", default: 5 },
        { nodeId: "285", inputKey: "value", paramKey: "comfy_fps", label: "帧率", type: "number", default: 24 },
      ],
    });
    const { mapping } = buildComfyImportModelMapping(built, { modelKey: "comfy-ltx", labelZh: "LTX" });
    const create = mapping.create as { body: unknown; defaultParams: Record<string, unknown> };
    const extras = applyWireDefaults({ comfy_width: 1280, comfy_height: 720, comfy_seconds: 6, comfy_fps: 30, firstFrameUrl: "input/start.png" }, create.defaultParams);
    const params = taskTemplateParams({ extras });
    const context = buildTemplateContext({ request: { prompt: "new prompt", extras }, params, model: {}, modelKey: "comfy-ltx", apiKey: "" });
    const body = renderTemplateValue(create.body, context) as { prompt: Record<string, { inputs: Record<string, unknown> }> };
    expect(body.prompt["110"].inputs.text).toBe("new prompt");
    expect(body.prompt["200"].inputs.image).toBe("input/start.png");
    expect(body.prompt["292"].inputs.value).toBe(1280);
    expect(body.prompt["293"].inputs.value).toBe(720);
    expect(body.prompt["291"].inputs.value).toBe(6);
    expect(body.prompt["285"].inputs.value).toBe(30);
  });
});

describe("importComfyWorkflow / slugifyModelKey", () => {
  it("slug 化：ASCII 名→干净 key；中文/空 → 兜底", () => {
    expect(slugifyModelKey("WAN i2v", "abc")).toBe("comfy-wan-i2v-abc");
    expect(slugifyModelKey("本地视频", "xyz")).toBe("comfy-workflow-xyz");
  });
  it("编排：解析→建图→upsert model+mapping（注入 mock）", () => {
    const models: Record<string, unknown>[] = [];
    const mappings: Record<string, unknown>[] = [];
    const r = importComfyWorkflow(
      { text: JSON.stringify(WAN_I2V), binding: analyzeComfyWorkflow(WAN_I2V).suggested, labelZh: "WAN i2v", modelKey: "comfy-wan-i2v-1" },
      (m) => models.push(m),
      (m) => mappings.push(m),
    );
    expect(r).toEqual({ modelKey: "comfy-wan-i2v-1", kind: "video", taskKind: "image_to_video" });
    expect(models[0].modelKey).toBe("comfy-wan-i2v-1");
    expect(mappings[0].taskKind).toBe("image_to_video");
  });
  it("编排：坏 JSON 冒泡报错，不 upsert", () => {
    const boom = () => { throw new Error("should not be called"); };
    expect(() => importComfyWorkflow({ text: "{bad", binding: { numeric: [] }, labelZh: "x", modelKey: "k" }, boom, boom)).toThrow(/JSON/);
  });
});

describe("reconcileComfyWorkflow（导入时缺件对账：图 vs 本机 /object_info）", () => {
  const index = parseObjectInfoIndex({
    KSampler: { input: { required: { sampler_name: [["euler", "ddim"]], seed: ["INT", {}] } } },
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [["local.safetensors"]] } } },
    CLIPTextEncode: { input: { required: {} } },
    EmptyLatentImage: { input: { required: {} } },
    SaveImage: { input: { required: {} } },
  });

  it("全齐 → 零告警", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "local.safetensors" } },
      "2": { class_type: "KSampler", inputs: { sampler_name: "euler", seed: 1, model: ["1", 0] } },
    };
    const r = reconcileComfyWorkflow(graph, index);
    expect(r.unknownNodeTypes).toEqual([]);
    expect(r.missingEnumValues).toEqual([]);
  });

  it("缺自定义节点类 → unknownNodeTypes（去重），且缺类节点不再核枚举", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "WanVideoWrapperSampler", inputs: { ckpt: "x" } },
      "2": { class_type: "WanVideoWrapperSampler", inputs: {} },
      "3": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "local.safetensors" } },
    };
    const r = reconcileComfyWorkflow(graph, index);
    expect(r.unknownNodeTypes).toEqual(["WanVideoWrapperSampler"]);
    expect(r.missingEnumValues).toEqual([]);
  });

  it("引用了本机没有的文件/选项 → missingEnumValues 带节点定位；连线/空值/模板占位不核", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "CheckpointLoaderSimple", _meta: { title: "主模型" }, inputs: { ckpt_name: "author-only.safetensors" } },
      "2": { class_type: "KSampler", inputs: { sampler_name: "euler", model: ["1", 0] } },
      "3": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "" } }, // 空值不核（内置 derive 语义）
      "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "{{request.params.x}}" } }, // 模板占位不核
    };
    const r = reconcileComfyWorkflow(graph, index);
    expect(r.missingEnumValues).toEqual([
      { nodeId: "1", classType: "CheckpointLoaderSimple", title: "主模型", inputKey: "ckpt_name", value: "author-only.safetensors" },
    ]);
  });

  it("类存在但该输入无枚举（自由文本/数值）→ 不核", () => {
    const graph: ComfyGraph = { "1": { class_type: "CLIPTextEncode", inputs: { text: "whatever" } } };
    expect(reconcileComfyWorkflow(graph, index).missingEnumValues).toEqual([]);
  });
});

describe("combo 真实选项烤入（collectGraphEnumOptions + buildImportedWorkflow select 化）", () => {
  const index = parseObjectInfoIndex({
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [["a.safetensors", "b.safetensors"]] } } },
    LoraLoaderModelOnly: { input: { required: { lora_name: [["x.safetensors"]], strength_model: ["FLOAT", {}] } } },
    KSampler: { input: { required: { sampler_name: [["euler", "ddim"]], seed: ["INT", {}] } } },
    CLIPTextEncode: { input: { required: {} } },
  });
  const graph: ComfyGraph = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "a.safetensors" } },
    "2": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "x.safetensors", strength_model: 1 } },
    "3": { class_type: "KSampler", inputs: { sampler_name: "euler", seed: 5, model: ["2", 0] } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "hi", clip: ["1", 1] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "x", images: ["3", 0] } },
  };

  it("收集：只收图里出现的 (class,input) 且值为字符串的 combo；数值/无枚举/未知类不收", () => {
    const options = collectGraphEnumOptions(graph, index);
    const keys = options.map((o) => `${o.classType}.${o.inputKey}`).sort();
    expect(keys).toEqual(["CheckpointLoaderSimple.ckpt_name", "KSampler.sampler_name", "LoraLoaderModelOnly.lora_name"]);
    expect(options.find((o) => o.inputKey === "ckpt_name")?.options).toEqual(["a.safetensors", "b.safetensors"]);
  });

  it("烤入：文本型参数命中 combo → select + 真实选项；default 在选项里不重复前置", () => {
    const binding = {
      outputNodeId: "9", outputKind: "image" as const,
      params: [{ nodeId: "1", inputKey: "ckpt_name", paramKey: "comfy_ckpt", label: "模型", type: "text" as const, default: "a.safetensors" }],
    };
    const built = buildImportedWorkflow(graph, binding, collectGraphEnumOptions(graph, index));
    const control = built.parameters.find((p) => p.key === "comfy_ckpt");
    expect(control?.type).toBe("select");
    expect(control?.options).toEqual(["a.safetensors", "b.safetensors"]);
    expect(control?.default).toBe("a.safetensors");
    expect(built.templatedGraph["1"].inputs?.ckpt_name).toBe("{{request.params.comfy_ckpt}}");
  });

  it("烤入：default 不在本机选项里（离线导入的作者值）→ 前置保留，绝不静默丢", () => {
    const binding = {
      outputNodeId: "9", outputKind: "image" as const,
      params: [{ nodeId: "1", inputKey: "ckpt_name", paramKey: "comfy_ckpt", label: "模型", type: "text" as const, default: "author-only.safetensors" }],
    };
    const built = buildImportedWorkflow(graph, binding, collectGraphEnumOptions(graph, index));
    expect(built.parameters[0].options).toEqual(["author-only.safetensors", "a.safetensors", "b.safetensors"]);
  });

  it("回归：不传 enumOptions（离线）→ 维持 text；数值参数即使类有枚举也不动", () => {
    const binding = {
      outputNodeId: "9", outputKind: "image" as const,
      params: [
        { nodeId: "1", inputKey: "ckpt_name", paramKey: "comfy_ckpt", label: "模型", type: "text" as const, default: "a.safetensors" },
        { nodeId: "3", inputKey: "seed", paramKey: "comfy_seed", label: "种子", type: "number" as const, default: 5 },
      ],
    };
    const offline = buildImportedWorkflow(graph, binding);
    expect(offline.parameters[0].type).toBe("text");
    const online = buildImportedWorkflow(graph, binding, collectGraphEnumOptions(graph, index));
    expect(online.parameters.find((p) => p.key === "comfy_seed")?.type).toBe("number");
  });
});

describe("识别缺口三根因（259 张真实官方模板语料实测逼出来的）", () => {
  it("根因A：云端 API 节点把 prompt 直接写在自己节点上（无独立 CLIPTextEncode）也要认", () => {
    // ByteDance/Grok/Gemini/Kling/Runway 等云端节点形态：语料里 112/154 张失败都是这个
    const graph: ComfyGraph = {
      "1": { class_type: "ByteDanceImageNode", inputs: { model: "seedream-4", prompt: "一只在雨中奔跑的橘猫，电影感", size: "2K" } },
      "2": { class_type: "SaveImage", inputs: { filename_prefix: "x", images: ["1", 0] } },
    };
    const a = analyzeComfyWorkflow(graph);
    expect(a.suggested.promptNodeId).toBe("1");
    expect(a.suggested.promptInputKey).toBe("prompt");
  });

  it("根因A 边界：文件名/路径样的字符串不能被当成提示词", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "SomeLoader", inputs: { prompt: "model_v2.safetensors" } },
      "2": { class_type: "SomeSaver", inputs: { text: "video/ComfyUI" } },
      "9": { class_type: "SaveImage", inputs: { filename_prefix: "x" } },
    };
    expect(analyzeComfyWorkflow(graph).suggested.promptNodeId).toBeUndefined();
  });

  it("根因A 排序：多个 prompt 时取最长的（云端节点里正向通常比负向长）", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "ApiNode", inputs: { prompt: "短的" } },
      "2": { class_type: "ApiNode", inputs: { prompt: "很长很长的正向提示词，描述了完整的画面内容与镜头语言" } },
      "9": { class_type: "SaveImage", inputs: { filename_prefix: "x" } },
    };
    expect(analyzeComfyWorkflow(graph).suggested.promptNodeId).toBe("2");
  });

  it("根因B：PreviewImage/MaskPreview 也是输出（纯图工作流此前被判「无输出」整张不可导入）", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
      "2": { class_type: "PreviewImage", inputs: { images: ["1", 0] } },
    };
    const a = analyzeComfyWorkflow(graph);
    expect(a.suggested.outputNodeId).toBe("2");
    expect(a.suggested.outputKind).toBe("image");
  });

  it("根因B 诚实边界：真存不下的（音频）标 unsupported，绝不硬塞成图", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "CLIPTextEncode", inputs: { text: "a chair" } },
      "3": { class_type: "SaveAudioMP3", inputs: { audio: ["1", 0] } },
    };
    const a = analyzeComfyWorkflow(graph);
    expect(a.outputNodes.map((o) => o.kind)).toEqual(["unsupported"]);
    // 不进建议绑定 → UI 侧据此提示「产出类型 Nomi 暂不支持」，而不是导入个存不下的东西
    expect(a.suggested.outputNodeId).toBeUndefined();
    expect(a.suggested.outputKind).toBeUndefined();
  });

  it("根因C：LoadVideo 也是媒体输入 —— 但键是 file 不是 image（旧 fixture 是我编的，真机 object_info 才是准的）", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "LoadVideo", inputs: { file: "input.mp4" } },
      "2": { class_type: "SaveVideo", inputs: { video: ["1", 0] } },
    };
    const a = analyzeComfyWorkflow(graph);
    expect(a.imageInputs.map((i) => i.nodeId)).toContain("1");
    // 收视频 → 进源视频槽，不是首帧图槽
    expect(a.suggested.sourceVideoNodeId).toBe("1");
    expect(a.suggested.firstFrameNodeId).toBeUndefined();
  });

  it("根因D：text-encode 变体多文本键（Flux clip_l/t5xxl、音频 tags/lyrics）", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "CLIPTextEncodeFlux", inputs: { clip_l: "a fox", t5xxl: "a fox in snow, cinematic" } },
      "9": { class_type: "SaveImage", inputs: { filename_prefix: "x", images: ["1", 0] } },
    };
    expect(analyzeComfyWorkflow(graph).textInputs.map((t) => t.inputKey).sort()).toEqual(["clip_l", "t5xxl"]);
  });

  it("根因E：独立字符串节点直接摆提示词（没连去 text-encode）", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "PrimitiveStringMultiline", inputs: { value: "赛博朋克街景，霓虹灯" } },
      "9": { class_type: "SaveImage", inputs: { filename_prefix: "x" } },
    };
    expect(analyzeComfyWorkflow(graph).suggested.promptNodeId).toBe("1");
  });

  it("不回归：标准 SD 图仍走 positive 连线追溯（语义最准的那条路优先）", () => {
    const a = analyzeComfyWorkflow(SD_T2I);
    expect(a.suggested.promptNodeId).toBe("6");
    expect(a.suggested.outputNodeId).toBe("9");
  });
});

describe("提示词键名按规则派生（不再用追不完的白名单）", () => {
  it("认得出真实存在的各种变体（实测本机 ComfyUI 全量 object_info 扫出来的）", async () => {
    const { isPromptLikeKey } = await import("./comfyuiWorkflowImport");
    for (const k of ["prompt", "text", "description", "prompt_text", "user_prompt", "structured_prompt",
      "text_prompt", "texture_prompt", "text_style_prompt", "positive_prompt", "PROMPT"]) {
      expect(isPromptLikeKey(k), k).toBe(true);
    }
  });

  it("排除明确不是正向的（负向 30 个节点类 / 系统提示词 9 个）", async () => {
    const { isPromptLikeKey } = await import("./comfyuiWorkflowImport");
    for (const k of ["negative_prompt", "system_prompt", "negative", "negative_text"]) {
      expect(isPromptLikeKey(k), k).toBe(false);
    }
  });

  it("不误伤无关键名", async () => {
    const { isPromptLikeKey } = await import("./comfyuiWorkflowImport");
    for (const k of ["ckpt_name", "filename_prefix", "seed", "sampler_name", "image"]) {
      expect(isPromptLikeKey(k), k).toBe(false);
    }
  });

  it("端到端：Minimax 文生视频（prompt_text）现在能识别出提示词", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "MinimaxTextToVideoNode", inputs: { prompt_text: "A stunning young woman in a golden wheat field", model: "T2V-01" } },
      "2": { class_type: "SaveVideo", inputs: { video: ["1", 0], filename_prefix: "video/ComfyUI" } },
    };
    const a = analyzeComfyWorkflow(graph);
    expect(a.suggested.promptNodeId).toBe("1");
    expect(a.suggested.promptInputKey).toBe("prompt_text");
  });
});

describe("3D 产物打通（此前是我自己凭记忆挡的门 —— Nomi 本就有 model3d 一等公民）", () => {
  it("SaveGLB → 认成 3D 产物，taskKind=text_to_3d", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "CLIPTextEncode", inputs: { text: "a wooden chair" } },
      "2": { class_type: "SaveGLB", inputs: { model_file: ["1", 0] } },
    };
    const a = analyzeComfyWorkflow(graph);
    expect(a.outputNodes.map((o) => o.kind)).toEqual(["model3d"]);
    expect(a.suggested.outputNodeId).toBe("2");
    expect(a.suggested.outputKind).toBe("model3d");
    const built = buildImportedWorkflow(graph, a.suggested);
    expect(built.kind).toBe("model3d");
    expect(built.taskKind).toBe("text_to_3d");
    const { model, mapping } = buildComfyImportModelMapping(built, { modelKey: "comfy-3d", labelZh: "文生 3D" });
    expect((model as { kind: string }).kind).toBe("model3d");
    expect((mapping as { taskKind: string }).taskKind).toBe("text_to_3d");
    // runtime 的 mappedAssetValues 认 model_url —— 读错键 = 生成完了拿不到东西
    expect((mapping as { query: { response_mapping: Record<string, string> } }).query.response_mapping.model_url).toBe("model_url");
  });

  it("图生 3D（单图转模型是最常见那种）→ image_to_3d，首帧槽还在", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "LoadImage", inputs: { image: "chair.png" } },
      "2": { class_type: "Hunyuan3Dv2", inputs: { image: ["1", 0] } },
      "3": { class_type: "Preview3D", inputs: { model_file: ["2", 0] } },
    };
    const a = analyzeComfyWorkflow(graph);
    expect(a.suggested.outputKind).toBe("model3d");
    const built = buildImportedWorkflow(graph, a.suggested);
    expect(built.taskKind).toBe("image_to_3d");
    expect(built.kind).toBe("model3d");
    // 首帧槽真被占位替换了（不是只在 taskKind 上写了个名字）
    expect(JSON.stringify(built.templatedGraph)).toContain("{{request.params.first_frame_url}}");
  });

  it("3D 工作流常同时挂 SaveImage 预览 → 优先认 3D（不退化成一张图）", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "LoadImage", inputs: { image: "x.png" } },
      "8": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
      "9": { class_type: "SaveGLB", inputs: { model_file: ["1", 0] } },
    };
    expect(analyzeComfyWorkflow(graph).suggested.outputKind).toBe("model3d");
  });
});

describe("SaveWEBM 是视频（取回侧一直当视频，识别侧却挡着 —— 同一类自设的门）", () => {
  it("透明背景视频（Bria 那张官方模板）→ 认成 video 而非 unsupported", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "LoadVideo", inputs: { video: "in.mp4" } },
      "2": { class_type: "BriaTransparentVideoBackground", inputs: { video: ["1", 0] } },
      "3": { class_type: "SaveWEBM", inputs: { images: ["2", 0] } },
    };
    const a = analyzeComfyWorkflow(graph);
    expect(a.suggested.outputKind).toBe("video");
    expect(a.outputNodes.find((o) => o.classType === "SaveWEBM")?.kind).toBe("video");
  });
});

describe("正向/负向不能搞反（搞反 = 用户打的字全进反向槽，生成的正好是他不想要的）", () => {
  // WAN/LTX/Flux 通用链形：KSampler.positive → 中间条件节点 → CLIPTextEncode
  const CHAINED_POSITIVE: ComfyGraph = {
    "107": { class_type: "CLIPTextEncode", _meta: { title: "Positive Prompt" }, inputs: { text: "一只小鹰", clip: ["105", 0] } },
    "125": { class_type: "CLIPTextEncode", _meta: { title: "Negative Prompt" }, inputs: { text: "色调艳丽，过曝，静态，细节模糊不清，字幕，最差质量，低质量，丑陋的，残缺的", clip: ["105", 0] } },
    "128": { class_type: "WanImageToVideo", inputs: { positive: ["107", 0], negative: ["125", 0], start_image: ["97", 0] } },
    "110": { class_type: "KSamplerAdvanced", inputs: { positive: ["128", 0], negative: ["128", 1] } },
    "97": { class_type: "LoadImage", inputs: { image: "start.png" } },
    "108": { class_type: "SaveVideo", inputs: { video: ["110", 0] } },
  };

  it("多跳追 positive 链：穿过 WanImageToVideo 落到 107，不是停在中间节点", () => {
    expect(analyzeComfyWorkflow(CHAINED_POSITIVE).suggested.promptNodeId).toBe("107");
  });

  it("退到启发式时也不选负向：负向更长，但标题写着 Negative → 仍选正向", () => {
    // 去掉 positive 连线（云端 API 节点形态），只剩两个并列文本节点
    const noLink: ComfyGraph = {
      "107": CHAINED_POSITIVE["107"],
      "125": CHAINED_POSITIVE["125"],
      "108": { class_type: "SaveImage", inputs: { filename_prefix: "x" } },
    };
    const a = analyzeComfyWorkflow(noLink);
    expect(String(a.textInputs.find((t) => t.nodeId === "125")?.value).length)
      .toBeGreaterThan(String(a.textInputs.find((t) => t.nodeId === "107")?.value).length); // 负向确实更长
    expect(a.suggested.promptNodeId).toBe("107");
  });

  it("负向键名同样排除（negative_prompt 摆在节点上的云端形态）", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "KlingTextToVideoNode", inputs: { prompt: "猫", negative_prompt: "模糊，低质量，扭曲的手，多余的手指，水印，字幕" } },
      "2": { class_type: "SaveVideo", inputs: { video: ["1", 0] } },
    };
    expect(analyzeComfyWorkflow(graph).suggested.promptInputKey).toBe("prompt");
  });
});

describe("视频输入通道（补帧/视频超分/视频去背景 —— 语料 29 张，此前一张都绑不上）", () => {
  // 真机 /object_info 实测：核心 LoadVideo 的输入键叫 file（不是 image）。
  const FRAME_INTERP: ComfyGraph = {
    "1": { class_type: "LoadVideo", inputs: { file: "clip.mp4" } },
    "2": { class_type: "FrameInterpolationModelLoader", inputs: { ckpt_name: "rife47.pth" } },
    "3": { class_type: "FrameInterpolate", inputs: { video: ["1", 0], model: ["2", 0], multiplier: 2 } },
    "4": { class_type: "SaveVideo", inputs: { video: ["3", 0], filename_prefix: "interp" } },
  };

  it("LoadVideo.file 认得出来（写死 inputKey==='image' 时它整个隐形）", () => {
    const a = analyzeComfyWorkflow(FRAME_INTERP);
    expect(a.imageInputs.map((i) => `${i.nodeId}.${i.inputKey}`)).toContain("1.file");
    expect(a.imageInputs.find((i) => i.nodeId === "1")?.mediaKind).toBe("video");
  });

  it("视频输入进**源视频**槽，不冒充首帧图（当首帧发 = 把 mp4 当图片上传，必失败）", () => {
    const a = analyzeComfyWorkflow(FRAME_INTERP);
    expect(a.suggested.sourceVideoNodeId).toBe("1");
    expect(a.suggested.sourceVideoInputKey).toBe("file");
    expect(a.suggested.firstFrameNodeId).toBeUndefined();
  });

  it("建图时注入 source_video_url 占位（上传后是 ComfyUI 自己的文件名）", () => {
    const built = buildImportedWorkflow(FRAME_INTERP, analyzeComfyWorkflow(FRAME_INTERP).suggested);
    expect(built.templatedGraph["1"]?.inputs?.file).toBe("{{request.params.source_video_url}}");
    expect(built.templatedGraph["1"]?._meta?.nomi_bound_media_input).toBe("file");
    expect(built.kind).toBe("video");
    // 无图输入 → text_to_video，与画布 resolveTaskKind 算出来的一致（对不上就选不到 mapping）
    expect(built.taskKind).toBe("text_to_video");
  });

  it("不回归：LoadImage.image 仍走首帧槽、不被误判成视频", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "LoadImage", inputs: { image: "start.png" } },
      "9": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "x" } },
    };
    const a = analyzeComfyWorkflow(graph);
    expect(a.suggested.firstFrameNodeId).toBe("1");
    expect(a.suggested.sourceVideoNodeId).toBeUndefined();
    expect(a.imageInputs[0]?.mediaKind).toBe("image");
  });

  it("图和视频都有（视频超分带参考图那种）→ 各进各的槽", () => {
    const graph: ComfyGraph = {
      "1": { class_type: "LoadVideo", inputs: { file: "in.mp4" } },
      "2": { class_type: "LoadImage", inputs: { image: "ref.png" } },
      "9": { class_type: "SaveVideo", inputs: { video: ["1", 0] } },
    };
    const a = analyzeComfyWorkflow(graph);
    expect(a.suggested.sourceVideoNodeId).toBe("1");
    expect(a.suggested.firstFrameNodeId).toBe("2");
  });
});
