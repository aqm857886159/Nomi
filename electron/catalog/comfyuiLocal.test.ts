import { describe, expect, it } from "vitest";
import {
  comfyuiHistoryTransform,
  fillEmptyCheckpoint,
  pruneEmptyMediaLoaders,
  COMFYUI_VENDOR_SEED,
  COMFYUI_CURATED_MODELS,
  COMFYUI_CURATED_MAPPINGS,
} from "./comfyuiLocal";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { buildTemplateContext, renderTemplateValue } from "../ai/requestPipeline";
import { taskTemplateParams, applyWireDefaults } from "./taskParams";
import type { CatalogState } from "./types";
import { applyRequestTransform } from "../tasks/requestTransforms";
import { buildProfileHttpRequest } from "./profileHttpRequest";

const ctx = { baseUrl: "http://127.0.0.1:8188" };

describe("comfyui-history 响应变换", () => {
  it("成功：unwrap 动态 prompt_id 键 + 从 outputs 拼 /view URL", () => {
    const res = comfyuiHistoryTransform(
      {
        "abc-123": {
          status: { status_str: "success", completed: true },
          outputs: { "9": { images: [{ filename: "Nomi_00001_.png", subfolder: "", type: "output" }] } },
        },
      },
      ctx,
    ) as { image_url?: string };
    expect(res.image_url).toBe("http://127.0.0.1:8188/view?filename=Nomi_00001_.png&subfolder=&type=output");
  });

  it("成功：subfolder/type 缺省兜底 + baseUrl 尾斜杠归一", () => {
    const res = comfyuiHistoryTransform(
      { id: { outputs: { "9": { images: [{ filename: "x.png" }] } } } },
      { baseUrl: "http://192.168.1.9:8188/" },
    ) as { image_url?: string };
    expect(res.image_url).toBe("http://192.168.1.9:8188/view?filename=x.png&subfolder=&type=output");
  });

  it("成功：多 output 节点取第一个带 images 的", () => {
    const res = comfyuiHistoryTransform(
      {
        id: {
          outputs: {
            "10": { latents: [{ filename: "l.latent" }] },
            "9": { images: [{ filename: "pick.png", subfolder: "sub", type: "output" }] },
          },
        },
      },
      ctx,
    ) as { image_url?: string };
    expect(res.image_url).toContain("filename=pick.png");
    expect(res.image_url).toContain("subfolder=sub");
  });

  it("成功：兼容 data/history 包装和额外顶层字段", () => {
    const res = comfyuiHistoryTransform(
      {
        request_id: "req-1",
        data: {
          history: {
            "abc-123": {
              status: { status_str: "success", completed: true },
              outputs: { "9": { images: [{ filename: "wrapped.png", subfolder: "nested", type: "output" }] } },
            },
          },
        },
      },
      ctx,
    ) as { image_url?: string };
    expect(res.image_url).toContain("filename=wrapped.png");
    expect(res.image_url).toContain("subfolder=nested");
  });

  it("成功：自定义输出键递归识别 filename，并按扩展名分类", () => {
    const res = comfyuiHistoryTransform(
      {
        id: {
          status: { status_str: "success", completed: true },
          outputs: {
            "42": { result: { files: [{ filename: "custom-output.webp", subfolder: "custom", type: "output" }] } },
            "43": { saved_files: [{ filename: "custom-video.mp4", subfolder: "video", type: "output" }] },
          },
        },
      },
      ctx,
    ) as { image_url?: string; video_url?: string };
    expect(res.image_url).toContain("filename=custom-output.webp");
    expect(res.video_url).toContain("filename=custom-video.mp4");
  });

  it("扩展名权威：视频挂在非 gifs/videos 的自定义键仍判成视频（治视频路读 video_url 读空 → 漏拉）", () => {
    const res = comfyuiHistoryTransform(
      {
        id: {
          status: { status_str: "success", completed: true },
          // 某第三方保存节点把 mp4 放在自定义键 media 下（既非 gifs 也非 videos）
          outputs: { "31": { media: [{ filename: "shot_0001.mp4", subfolder: "clips", type: "output" }] } },
        },
      },
      ctx,
    ) as { image_url?: string; video_url?: string };
    expect(res.video_url).toContain("filename=shot_0001.mp4");
    expect(res.image_url).toBeUndefined();
  });

  it("放宽扩展名：少见格式 heic(图) / ts(视频) 各自识别到对应 url", () => {
    const res = comfyuiHistoryTransform(
      {
        id: {
          outputs: {
            "40": { saved: [{ filename: "portrait.heic", subfolder: "", type: "output" }] },
            "41": { clip: [{ filename: "take.ts", subfolder: "v", type: "output" }] },
          },
        },
      },
      ctx,
    ) as { image_url?: string; video_url?: string };
    expect(res.image_url).toContain("filename=portrait.heic");
    expect(res.video_url).toContain("filename=take.ts");
  });

  it("不漏兜底：未知扩展名但带完整 /view 三元组 → 当图片拉（新图片格式不因未枚举而漏）", () => {
    const res = comfyuiHistoryTransform(
      {
        id: {
          status: { status_str: "success", completed: true },
          outputs: { "50": { result: [{ filename: "render_0001.qoi", subfolder: "sub", type: "output" }] } },
        },
      },
      ctx,
    ) as { image_url?: string };
    expect(res.image_url).toBe("http://127.0.0.1:8188/view?filename=render_0001.qoi&subfolder=sub&type=output");
  });

  it("保守守卫：latent 也带 /view 三元组，但按中间产物挡住（不被兜底误当图）", () => {
    const res = comfyuiHistoryTransform(
      {
        id: {
          status: { status_str: "success", completed: true },
          outputs: { "10": { result: [{ filename: "sample_0001.latent", subfolder: "", type: "output" }] } },
        },
      },
      ctx,
    ) as { error?: string; image_url?: string };
    expect(res.error).toContain("没有返回可下载");
    expect(res.image_url).toBeUndefined();
  });

  it("保守守卫：未知扩展名但缺 subfolder/type 三元组 → 不误抓（判 null）", () => {
    const res = comfyuiHistoryTransform(
      {
        id: {
          status: { status_str: "success", completed: true },
          outputs: { "5": { data: [{ filename: "notes.xyz" }] } },
        },
      },
      ctx,
    ) as { error?: string; image_url?: string };
    expect(res.error).toContain("没有返回可下载");
    expect(res.image_url).toBeUndefined();
  });

  it("SaveImageWebsocket 式：完成但输出节点为空（图走 websocket 未落盘）→ 明确失败、提示补保存节点，不静默轮询到超时", () => {
    const res = comfyuiHistoryTransform(
      { id: { status: { status_str: "success", completed: true }, outputs: { "14": {} } } },
      ctx,
    ) as { error?: string; image_url?: string };
    expect(res.error).toContain("没有返回可下载");
    expect(res.image_url).toBeUndefined();
  });

  it("视频：VHS gifs[0]（mp4 也落 gifs 键）→ video_url", () => {
    const res = comfyuiHistoryTransform(
      {
        "vid-1": {
          status: { status_str: "success", completed: true },
          outputs: { "12": { gifs: [{ filename: "Nomi_00001.mp4", subfolder: "video", type: "output" }] } },
        },
      },
      ctx,
    ) as { video_url?: string; image_url?: string };
    expect(res.video_url).toBe("http://127.0.0.1:8188/view?filename=Nomi_00001.mp4&subfolder=video&type=output");
    expect(res.image_url).toBeUndefined();
  });

  it("视频：原生 SaveVideo 落 videos 键 → video_url", () => {
    const res = comfyuiHistoryTransform(
      { id: { outputs: { "20": { videos: [{ filename: "wan.webm", subfolder: "", type: "output" }] } } } },
      ctx,
    ) as { video_url?: string };
    expect(res.video_url).toContain("filename=wan.webm");
  });

  it("视频+预览帧同时出 → video_url 与 image_url 各出各的（mapping 各取所需）", () => {
    const res = comfyuiHistoryTransform(
      {
        id: {
          outputs: {
            "12": { gifs: [{ filename: "clip.mp4", subfolder: "v", type: "output" }] },
            "9": { images: [{ filename: "preview.png", subfolder: "", type: "temp" }] },
          },
        },
      },
      ctx,
    ) as { video_url?: string; image_url?: string };
    expect(res.video_url).toContain("filename=clip.mp4");
    expect(res.image_url).toContain("filename=preview.png");
  });

  it("纯图片路恒等：只有 images → 仅 image_url，无 video_url（不回归）", () => {
    const res = comfyuiHistoryTransform(
      { id: { outputs: { "9": { images: [{ filename: "x.png", subfolder: "", type: "output" }] } } } },
      ctx,
    ) as { image_url?: string; video_url?: string };
    expect(res.image_url).toContain("filename=x.png");
    expect(res.video_url).toBeUndefined();
  });

  it("未完成时有 outputs 但只有 latents → 原样（继续轮询）", () => {
    const res = comfyuiHistoryTransform(
      { id: { status: { status_str: "running", completed: false }, outputs: { "10": { latents: [{ filename: "l.latent" }] } } } },
      ctx,
    ) as { image_url?: string; video_url?: string };
    expect(res.image_url).toBeUndefined();
    expect(res.video_url).toBeUndefined();
  });

  it("已完成但没有可下载文件 → 明确失败，不再一直轮询", () => {
    const res = comfyuiHistoryTransform(
      { id: { status: { status_str: "success", completed: true }, outputs: { "10": { latents: [{ filename: "l.latent" }] } } } },
      ctx,
    ) as { error?: string; image_url?: string };
    expect(res.error).toContain("没有返回可下载");
    expect(res.image_url).toBeUndefined();
  });

  it("失败：status_str=error → { error }（fail fast，带 exception_message）", () => {
    const res = comfyuiHistoryTransform(
      {
        id: {
          status: {
            status_str: "error",
            messages: [["execution_error", { exception_message: "CheckpointLoaderSimple: file not found" }]],
          },
        },
      },
      ctx,
    ) as { error?: string; image_url?: string };
    expect(res.error).toContain("file not found");
    expect(res.image_url).toBeUndefined();
  });

  it("未完成：空 {} → 原样返回（无 image_url，继续轮询）", () => {
    const res = comfyuiHistoryTransform({}, ctx) as { image_url?: string; error?: string };
    expect(res.image_url).toBeUndefined();
    expect(res.error).toBeUndefined();
  });

  it("未完成：有 status 无 outputs → 原样（不误判成功/失败）", () => {
    const input = { id: { status: { status_str: "success", completed: false } } };
    const res = comfyuiHistoryTransform(input, ctx) as { image_url?: string; error?: string };
    expect(res.image_url).toBeUndefined();
    expect(res.error).toBeUndefined();
  });

  it("非对象响应 → 原样（防御）", () => {
    expect(comfyuiHistoryTransform(null, ctx)).toBeNull();
    expect(comfyuiHistoryTransform("boom", ctx)).toBe("boom");
  });
});

describe("comfyui workflow 图注入（真管线，证 comfy_* 键存活 + 数字保持数字）", () => {
  it("headless：defaultParams 合并 → 图里数字节点是 number 不是字符串", () => {
    const create = COMFYUI_CURATED_MAPPINGS[0].create;
    // headless 路：无 UI 填参，applyWireDefaults 把 create.defaultParams 兜到 extras 之下。
    const extras = applyWireDefaults({}, create.defaultParams);
    const params = taskTemplateParams({ extras });
    const context = buildTemplateContext({ request: { prompt: "a cat astronaut", extras }, params, model: {}, modelKey: "comfyui-txt2img", apiKey: "" });
    const body = renderTemplateValue(create.body, context) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
      client_id: string;
    };
    // 正/负提示词注入
    expect(body.prompt["6"].inputs.text).toBe("a cat astronaut");
    expect(body.prompt["7"].inputs.text).toBe("");
    // checkpoint 默认留空（提交前由 "comfyui-prompt" 请求变换按本机 /object_info derive，见 fillEmptyCheckpoint 测试）
    expect(body.prompt["4"].inputs.ckpt_name).toBe("");
    // ★ 关键：数字保持 number（comfy_* 键没被 taskTemplateParams 的标准键派生清成 undefined）
    expect(body.prompt["3"].inputs.seed).toBe(156680208700286);
    expect(typeof body.prompt["3"].inputs.seed).toBe("number");
    expect(body.prompt["3"].inputs.steps).toBe(20);
    expect(body.prompt["3"].inputs.cfg).toBe(7);
    expect(body.prompt["3"].inputs.sampler_name).toBe("euler");
    expect(body.prompt["5"].inputs.width).toBe(512);
    expect(typeof body.prompt["5"].inputs.width).toBe("number");
    expect(body.prompt["5"].inputs.height).toBe(512);
    // 连线数组 ["4",0] 原样不动
    expect(body.prompt["3"].inputs.model).toEqual(["4", 0]);
    expect(body.client_id).toBe("nomi");
  });

  it("UI 填参覆盖默认：改 comfy_width/comfy_seed 生效", () => {
    const create = COMFYUI_CURATED_MAPPINGS[0].create;
    const extras = applyWireDefaults({ comfy_width: 1024, comfy_height: 768, comfy_seed: 42 }, create.defaultParams);
    const params = taskTemplateParams({ extras });
    const context = buildTemplateContext({ request: { prompt: "x", extras }, params, model: {}, modelKey: "comfyui-txt2img", apiKey: "" });
    const body = renderTemplateValue(create.body, context) as { prompt: Record<string, { inputs: Record<string, unknown> }> };
    expect(body.prompt["5"].inputs.width).toBe(1024);
    expect(body.prompt["5"].inputs.height).toBe(768);
    expect(body.prompt["3"].inputs.seed).toBe(42);
  });
});

describe("ComfyUI 内置种子", () => {
  const emptyState = (): CatalogState => ({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState);

  it("种 comfyui-local vendor：authType none + 默认 enabled:false（污染防护）", () => {
    const { state } = applyBuiltinSeeds(emptyState(), "2026-07-04T00:00:00.000Z");
    const vendor = state.vendors.find((v) => v.key === "comfyui-local");
    expect(vendor).toBeDefined();
    expect(vendor?.authType).toBe("none");
    expect(vendor?.enabled).toBe(false);
    expect(vendor?.baseUrlHint).toBe("http://127.0.0.1:8188");
  });

  it("种 txt2img 模型：kind image + meta.parameters 动态控件带过去", () => {
    const { state } = applyBuiltinSeeds(emptyState(), "2026-07-04T00:00:00.000Z");
    const model = state.models.find((m) => m.modelKey === "comfyui-txt2img" && m.vendorKey === "comfyui-local");
    expect(model?.kind).toBe("image");
    const params = (model?.meta as { parameters?: Array<{ key: string }> })?.parameters;
    expect(Array.isArray(params)).toBe(true);
    expect(params?.map((p) => p.key)).toContain("ckpt_name");
    expect(params?.map((p) => p.key)).toContain("comfy_width");
  });

  it("种 mapping：query op 带 response_transform comfyui-history", () => {
    const { state } = applyBuiltinSeeds(emptyState(), "2026-07-04T00:00:00.000Z");
    const mapping = state.mappings.find((m) => m.id === "seed-comfyui-local-txt2img-text_to_image");
    expect(mapping?.taskKind).toBe("text_to_image");
    expect(mapping?.query?.response_transform).toBe("comfyui-history");
    expect(mapping?.create?.response_mapping?.task_id).toBe("prompt_id");
  });

  it("其它 vendor 不被 enabled:false 波及（仍默认 enabled:true）", () => {
    const { state } = applyBuiltinSeeds(emptyState(), "2026-07-04T00:00:00.000Z");
    const kie = state.vendors.find((v) => v.key === COMFYUI_VENDOR_SEED.key ? false : v.key === "kie" || v.key === "apimart");
    expect(kie?.enabled).toBe(true);
  });

  it("幂等：再跑一次不重复插入", () => {
    const first = applyBuiltinSeeds(emptyState(), "2026-07-04T00:00:00.000Z");
    const second = applyBuiltinSeeds(first.state, "2026-07-04T00:00:00.000Z");
    expect(second.changed).toBe(false);
    expect(second.state.vendors.filter((v) => v.key === "comfyui-local")).toHaveLength(1);
    expect(second.state.models.filter((m) => m.modelKey === "comfyui-txt2img")).toHaveLength(1);
  });

  it("导出常量自洽：模型 meta.parameters 的 key 与 mapping 图里的 {{request.params.*}} 对应", () => {
    const paramKeys = new Set(
      (COMFYUI_CURATED_MODELS[0].meta.parameters as unknown as Array<{ key: string }>).map((p) => p.key),
    );
    const bodyStr = JSON.stringify(COMFYUI_CURATED_MAPPINGS[0].create.body);
    // 图里每个 {{request.params.X}} 的 X 都必须在 meta.parameters 里声明（除 request.prompt 走标准槽）
    const tokens = [...bodyStr.matchAll(/\{\{request\.params\.(\w+)\}\}/g)].map((m) => m[1]);
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) expect(paramKeys.has(t)).toBe(true);
  });

  it("内置文生图声明 request_transform=comfyui-prompt（ckpt 留空 derive 的挂点）", () => {
    expect(COMFYUI_CURATED_MAPPINGS[0].create.request_transform).toBe("comfyui-prompt");
  });
});

describe("fillEmptyCheckpoint（ckpt_name 留空 → 本机第一个 checkpoint）", () => {
  const graph = (ckpt: string) => ({
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "hi", clip: ["4", 1] } },
  });

  it("空值 → 填第一个 checkpoint；不改原对象", () => {
    const input = graph("");
    const out = fillEmptyCheckpoint(input, ["a.safetensors", "b.safetensors"]) as typeof input;
    expect(out["4"].inputs.ckpt_name).toBe("a.safetensors");
    expect(input["4"].inputs.ckpt_name).toBe(""); // 纯函数不 mutate
    expect(out["6"]).toBe(input["6"]); // 无关节点原引用
  });

  it("用户手填的名字原样保留（哪怕本机没有——错了由 /prompt 400 的 node_errors 人话报出）", () => {
    const input = graph("my-choice.safetensors");
    const out = fillEmptyCheckpoint(input, ["a.safetensors"]) as typeof input;
    expect(out["4"].inputs.ckpt_name).toBe("my-choice.safetensors");
  });

  it("非 CheckpointLoaderSimple 节点即使有空 ckpt_name 键也不动（只认精确类）", () => {
    const input = { "1": { class_type: "MyCustomLoader", inputs: { ckpt_name: "" } } };
    const out = fillEmptyCheckpoint(input, ["a.safetensors"]) as typeof input;
    expect(out["1"].inputs.ckpt_name).toBe("");
  });
});

describe("pruneEmptyMediaLoaders（缺失可选媒体不阻塞整张工作流）", () => {
  it.each([
    ["LoadImage", "image"],
    ["LoadVideo", "file"],
    ["VHS_LoadVideo", "video"],
    ["LoadAudio", "audio"],
    ["VHS_LoadAudio", "file"],
  ])("清理空的标准 %s loader 及直接下游连线", (classType, inputKey) => {
    const input = {
      "10": { class_type: classType, inputs: { [inputKey]: "  " } },
      "20": { class_type: "Consumer", inputs: { optional_media: ["10", 0], keep: ["30", 0] } },
      "30": { class_type: "Other", inputs: { value: 1 } },
    };
    const out = pruneEmptyMediaLoaders(input) as typeof input;
    expect(out["10"]).toBeUndefined();
    expect(out["20"].inputs.optional_media).toBeUndefined();
    expect(out["20"].inputs.keep).toEqual(["30", 0]);
    expect(input["10"]).toBeDefined();
    expect(input["20"].inputs.optional_media).toEqual(["10", 0]);
  });

  it("清理 Nomi 标记的未知社区 loader，且兼容数字来源节点 ID", () => {
    const out = pruneEmptyMediaLoaders({
      "10": {
        class_type: "CommunityMediaLoader",
        inputs: { custom_path: null, unrelated: "keep" },
        _meta: { nomi_bound_media_input: "custom_path" },
      },
      "20": { class_type: "Consumer", inputs: { media: [10, 0], strength: 0.8 } },
    }) as Record<string, { inputs?: Record<string, unknown> }>;
    expect(out["10"]).toBeUndefined();
    expect(out["20"].inputs).toEqual({ strength: 0.8 });
  });

  it("保留有值 loader、非空作者示例和未标记的未知社区 loader", () => {
    const input = {
      "1": { class_type: "LoadImage", inputs: { image: "uploaded.png" } },
      "2": { class_type: "LoadVideo", inputs: { file: "author-example.mp4" } },
      "3": { class_type: "CommunityMediaLoader", inputs: { custom_path: "" } },
      "4": {
        class_type: "CommunityMediaLoader",
        inputs: { custom_path: "bound.mov" },
        _meta: { nomi_bound_media_input: "custom_path" },
      },
    };
    expect(pruneEmptyMediaLoaders(input)).toBe(input);
  });
});

describe("comfyui-prompt 会话封装", () => {
  it("覆盖固定 client_id、采用预生成 prompt UUID，并保留 extra_pnginfo", async () => {
    const promptId = "123e4567-e89b-42d3-a456-426614174000";
    const workflow = { nodes: [{ id: 1, type: "SaveImage" }] };
    const body = await applyRequestTransform("comfyui-prompt", {
      prompt: { "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "m.safetensors" } } },
      client_id: "nomi",
      extra_data: { extra_pnginfo: { workflow } },
    }, { baseUrl: "http://127.0.0.1:8188", promptId }) as Record<string, unknown>;
    expect(body.client_id).toMatch(/^nomi-[0-9a-f-]{36}$/);
    expect(body.client_id).not.toBe("nomi");
    expect(body.prompt_id).toBe(promptId);
    expect(body.extra_data).toEqual({ extra_pnginfo: { workflow } });
  });

  it("生产 profile 请求对裸 host 补 http 协议", () => {
    const built = buildProfileHttpRequest({
      vendor: { ...COMFYUI_VENDOR_SEED, baseUrlHint: "127.0.0.1:8188/", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      model: { ...COMFYUI_CURATED_MODELS[0], vendorKey: "comfyui-local", enabled: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      apiKey: "",
      request: { kind: "text_to_image", prompt: "test", extras: {} } as never,
      operation: COMFYUI_CURATED_MAPPINGS[0].create,
    });
    expect(built.url).toBe("http://127.0.0.1:8188/prompt");
  });
});

describe("comfyui-history 打断态", () => {
  it("execution_interrupted → 「已取消」人话（不吓人的红失败文案）", () => {
    const out = comfyuiHistoryTransform(
      { "p1": { status: { status_str: "error", completed: false, messages: [["execution_interrupted", { prompt_id: "p1" }]] }, outputs: {} } },
      { baseUrl: "http://127.0.0.1:8188" },
    ) as { error?: string };
    expect(out.error).toContain("已取消");
  });
});

describe("3D 产物（model3d 是 Nomi 一等公民，此前被误挡）", () => {
  it("SaveGLB 出的 .glb → model_url（runtime 的 mappedAssetValues 就读这个键）", () => {
    const res = comfyuiHistoryTransform(
      {
        id: {
          status: { status_str: "success", completed: true },
          outputs: { "12": { "3d": [{ filename: "mesh_00001_.glb", subfolder: "3D", type: "output" }] } },
        },
      },
      ctx,
    ) as { model_url?: string; image_url?: string };
    expect(res.model_url).toBe("http://127.0.0.1:8188/view?filename=mesh_00001_.glb&subfolder=3D&type=output");
    expect(res.image_url).toBeUndefined();
  });

  it("3D 工作流常同时出预览图 → 两个 url 各出各的（mapping 按 kind 各取所需）", () => {
    const res = comfyuiHistoryTransform(
      {
        id: {
          outputs: {
            "12": { result: [{ filename: "model.glb", subfolder: "", type: "output" }] },
            "9": { images: [{ filename: "preview.png", subfolder: "", type: "temp" }] },
          },
        },
      },
      ctx,
    ) as { model_url?: string; image_url?: string };
    expect(res.model_url).toContain("model.glb");
    expect(res.image_url).toContain("preview.png");
  });

  it("其它网格格式也认（obj/ply/fbx）", () => {
    for (const ext of ["obj", "ply", "fbx", "gltf"]) {
      const res = comfyuiHistoryTransform(
        { id: { outputs: { "1": { files: [{ filename: `m.${ext}`, subfolder: "", type: "output" }] } } } },
        ctx,
      ) as { model_url?: string };
      expect(res.model_url, ext).toContain(`m.${ext}`);
    }
  });
});
