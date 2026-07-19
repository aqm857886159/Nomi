import { describe, expect, it } from "vitest";
import {
  comfyuiHistoryTransform,
  COMFYUI_VENDOR_SEED,
  COMFYUI_CURATED_MODELS,
  COMFYUI_CURATED_MAPPINGS,
} from "./comfyuiLocal";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { buildTemplateContext, renderTemplateValue } from "../ai/requestPipeline";
import { taskTemplateParams, applyWireDefaults } from "./taskParams";
import type { CatalogState } from "./types";

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
    // checkpoint 文件名注入
    expect(body.prompt["4"].inputs.ckpt_name).toBe("v1-5-pruned-emaonly.safetensors");
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
      (COMFYUI_CURATED_MODELS[0].meta.parameters as Array<{ key: string }>).map((p) => p.key),
    );
    const bodyStr = JSON.stringify(COMFYUI_CURATED_MAPPINGS[0].create.body);
    // 图里每个 {{request.params.X}} 的 X 都必须在 meta.parameters 里声明（除 request.prompt 走标准槽）
    const tokens = [...bodyStr.matchAll(/\{\{request\.params\.(\w+)\}\}/g)].map((m) => m[1]);
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) expect(paramKeys.has(t)).toBe(true);
  });
});
