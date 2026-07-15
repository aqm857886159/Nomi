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
