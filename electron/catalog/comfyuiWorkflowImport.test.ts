import { describe, it, expect } from "vitest";
import {
  parseComfyApiWorkflow,
  analyzeComfyWorkflow,
  buildImportedWorkflow,
  buildComfyImportModelMapping,
  importComfyWorkflow,
  slugifyModelKey,
  type ComfyGraph,
} from "./comfyuiWorkflowImport";
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
    expect(built.templatedGraph["90"].inputs!.text).toBe("{{request.prompt}}");
    expect(built.kind).toBe("video");
    expect(built.taskKind).toBe("image_to_video");
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
