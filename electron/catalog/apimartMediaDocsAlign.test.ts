/**
 * 按 APIMart 官方页对齐的四处（2026-11-07 核），画布路的契约：
 *   ① Gemini Omni 1.2 Flash Ext 有首尾帧（官方 Scenario 3：first_frame_image + last_frame_image）；
 *   ② Omni 1.2 两条通道的比例只有 16:9 | 9:16、默认 16:9，没有「自动」；
 *   ③ Vidu Q4 参考生：1–15 张，1 张也按参考（image_with_roles + role reference_image），不在背后换成图生；
 *   ④ Grok Imagine Image 2.0 官方通道：不带 X-APIMart-Response-Version 头，按平台默认形状 data[0].task_id 取任务号。
 * Run 路（MCP / ProductionRun）由 electron/parity/apimartDocsAlignRunPath.test.ts 与 combineRolesParity.test.ts 钉。
 */
import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext, looksLikeLogicalError } from "../ai/requestPipeline";
import { buildArchetypeInputParams } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { getArchetypeById } from "../shared/modelArchetypes";
import { firstMappedString } from "../tasks/responseParsing";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { ARCHETYPE_WIRE_DEFAULTS } from "./archetypeWireDefaults.generated";
import { applyParamMap } from "./paramTranslate";
import { taskTemplateParams } from "./taskParams";

const FIRST = "https://example.invalid/first.png";
const LAST = "https://example.invalid/last.png";
const REF = "https://example.invalid/ref.png";

type CatalogModel = { modelKey: string; archetypeId?: string; mappings: Array<{ taskKind: string; create: any }> }; // eslint-disable-line @typescript-eslint/no-explicit-any -- 目录 mapping 的原样 JSON

function catalogModel(modelKey: string): CatalogModel {
  const model = [...APIMART_VIDEO_MODELS, ...APIMART_IMAGE_MODELS].find((item) => item.modelKey === modelKey);
  if (!model) throw new Error(`${modelKey} is not declared`);
  return model as CatalogModel;
}

/** 画布路：档案模式的默认参数 + 槽产出的参考字段 → 目录 body 真渲染一遍。 */
function renderCanvasBody(modelKey: string, modeId: string, references: Parameters<typeof buildArchetypeInputParams>[2]) {
  const model = catalogModel(modelKey);
  const archetype = getArchetypeById(model.archetypeId ?? "")!;
  const mode = archetype.modes.find((item) => item.id === modeId)!;
  const taskKind = mode.transportTaskKind ?? archetype.transportTaskKind;
  const mapping = model.mappings.find((item) => item.taskKind === taskKind)!;
  const defaults = Object.fromEntries(mode.params.flatMap((param) => param.defaultValue === undefined ? [] : [[param.key, param.defaultValue]]));
  const inputs = buildArchetypeInputParams({ archetype: { id: archetype.id, modeId } }, archetype, references);
  const request = { kind: taskKind, prompt: "人物转身看向窗外", extras: { ...defaults, ...inputs } };
  const context = buildTemplateContext({
    request: request as never,
    params: applyParamMap(mapping.create.paramMap, taskTemplateParams(request as never)),
    model: { modelKey },
    modelKey,
    apiKey: "TEST_SECRET",
  });
  const built = buildHttpRequest({ baseUrl: "https://api.apimart.ai", authType: "bearer", apiKey: "TEST_SECRET", context, operation: mapping.create });
  return { inputs, body: built.body as Record<string, unknown>, headers: built.headers, mode };
}

describe("① Gemini Omni 1.2 Flash Ext 有首尾帧", () => {
  it("Ext 的方式里有 firstlast：首帧 first_frame_image + 尾帧 last_frame_image，最长 10 秒", () => {
    const ext = getArchetypeById("gemini-omni-1.2-flash-ext")!;
    const firstlast = ext.modes.find((mode) => mode.id === "firstlast");
    expect(firstlast, "Ext 必须有首尾帧方式").toBeTruthy();
    expect(firstlast!.slots.map((slot) => [slot.kind, slot.inputKey])).toEqual([["first_frame", "first_frame_image"], ["last_frame", "last_frame_image"]]);
    expect(firstlast!.params.find((param) => param.key === "duration")?.max).toBe(10);
  });

  it("Ext 首尾帧真渲染：两张图各落在自己的字段上，不发 image_urls / image_with_roles", () => {
    const { body } = renderCanvasBody("gemini-omni-1.2-flash-ext", "firstlast", { firstFrameUrl: FIRST, lastFrameUrl: LAST });
    expect(body.model).toBe("gemini-omni-1.2-flash-ext");
    expect(body.first_frame_image).toBe(FIRST);
    expect(body.last_frame_image).toBe(LAST);
    expect(body).not.toHaveProperty("image_urls");
    expect(body).not.toHaveProperty("image_with_roles");
    expect(body.duration).toBe(10);
  });
});

describe("② Omni 1.2 比例只有 16:9 | 9:16，没有「自动」", () => {
  for (const archetypeId of ["gemini-omni-1.2-flash", "gemini-omni-1.2-flash-ext"]) {
    it(`${archetypeId}：每种方式的比例选项都是 16:9 / 9:16、默认 16:9`, () => {
      const archetype = getArchetypeById(archetypeId)!;
      for (const mode of archetype.modes) {
        const aspect = mode.params.find((param) => param.key === "aspect_ratio");
        expect(aspect, `${archetypeId}/${mode.id} 声明比例`).toBeTruthy();
        expect(aspect!.options.map((option) => option.value), `${archetypeId}/${mode.id}`).toEqual(["16:9", "9:16"]);
        expect(aspect!.defaultValue).toBe("16:9");
      }
      // 生成物（headless 默认值）里也不许有 auto。
      expect(JSON.stringify(ARCHETYPE_WIRE_DEFAULTS[archetypeId] ?? {})).not.toMatch(/"aspect_ratio":"auto"/);
    });
  }

  it("首帧图生照发 aspect_ratio=16:9（以前「自动」靠不发比例实现）", () => {
    const { body } = renderCanvasBody("gemini-omni-1.2-flash", "i2v", { firstFrameUrl: FIRST });
    expect(body.aspect_ratio).toBe("16:9");
    expect(body.first_frame_image).toBe(FIRST);
  });
});

describe("③ Vidu Q4 参考生：1 张也按参考，不在背后换成图生", () => {
  it("参考槽 1–15 张，提示词必填", () => {
    const ref = getArchetypeById("viduq4-preview")!.modes.find((mode) => mode.id === "ref")!;
    const slot = ref.slots.find((item) => item.kind === "image_ref")!;
    expect([slot.min, slot.max]).toEqual([1, 15]);
    expect(ref.promptRequired).toBe(true);
  });

  it("1 张参考图 → image_with_roles 一条 role=reference_image；不发 image_urls / first_frame_image", () => {
    const { body } = renderCanvasBody("viduq4-preview", "ref", { referenceImages: [REF] });
    expect(body.image_with_roles).toEqual([{ url: REF, role: "reference_image" }]);
    expect(body).not.toHaveProperty("image_urls");
    expect(body).not.toHaveProperty("first_frame_image");
    expect(body.aspect_ratio).toBe("16:9");
  });

  it("15 张都带 role；第 16 张截掉（官方上限 15）", () => {
    const urls = Array.from({ length: 16 }, (_, index) => `https://example.invalid/ref-${index}.png`);
    const { body } = renderCanvasBody("viduq4-preview", "ref", { referenceImages: urls });
    const roles = body.image_with_roles as Array<{ url: string; role: string }>;
    expect(roles).toHaveLength(15);
    expect(new Set(roles.map((item) => item.role))).toEqual(new Set(["reference_image"]));
    expect(roles.map((item) => item.url)).toEqual(urls.slice(0, 15));
  });

  it("图生方式 1 张 → 只发 first_frame_image，不带比例（官方：比例只在参考生有效）", () => {
    const { body } = renderCanvasBody("viduq4-preview", "i2v", { firstFrameUrl: FIRST });
    expect(body.first_frame_image).toBe(FIRST);
    expect(body).not.toHaveProperty("image_with_roles");
    expect(body).not.toHaveProperty("image_urls");
    expect(body).not.toHaveProperty("aspect_ratio");
  });
});

// APIMart 平台默认提交形状（Muse Image Ext 页原文示例）与带 X-APIMart-Response-Version 头时的形状。
const DEFAULT_SUBMIT = { code: 200, data: [{ status: "submitted", task_id: "task_01K..." }] };
const VERSIONED_SUBMIT = { code: 202, request_id: "req_example", data: { id: "task_01K...", status: "pending", poll_url: "/v1/tasks/task_01K..." } };
const APIMART_SUCCESS_CODES = [0, 200] as const; // = apimartGenerationProvider.ts 提交时的 logicalSuccessCodes

describe("④ Grok Imagine Image 2.0 官方通道：不带响应版本头，按 data[0].task_id 取", () => {
  it("文生图 / 改图两条 create 都不发 X-APIMart-Response-Version 头，任务号路径是 data.0.task_id", () => {
    const model = catalogModel("grok-imagine-image-2.0");
    for (const mapping of model.mappings) {
      const headers = Object.keys(mapping.create.headers ?? {}).map((key) => key.toLowerCase());
      expect(headers, `${mapping.taskKind}`).not.toContain("x-apimart-response-version");
      expect(mapping.create.response_mapping?.task_id).toBe("data.0.task_id");
      expect(firstMappedString(DEFAULT_SUBMIT, mapping.create.response_mapping, "task_id")).toBe("task_01K...");
    }
    const { headers } = renderCanvasBody("grok-imagine-image-2.0", "t2i", {});
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("x-apimart-response-version");
  });

  it("为什么不带头：带头的提交返回 code 202，目录执行器只认 0 / 200，会当成失败；默认形状照常通过", () => {
    expect(looksLikeLogicalError(VERSIONED_SUBMIT, APIMART_SUCCESS_CODES)).toBe(202);
    expect(looksLikeLogicalError(DEFAULT_SUBMIT, APIMART_SUCCESS_CODES)).toBeNull();
  });

  it("类守卫：APIMart 内置的图片 / 视频型号，没有一条 create 带这个头（带了就和 data.0.task_id、成功码 0/200 冲突）", () => {
    for (const model of [...APIMART_IMAGE_MODELS, ...APIMART_VIDEO_MODELS]) {
      for (const mapping of model.mappings) {
        const headers = Object.keys((mapping.create as { headers?: Record<string, string> }).headers ?? {}).map((key) => key.toLowerCase());
        expect(headers, `${model.modelKey}/${mapping.taskKind}`).not.toContain("x-apimart-response-version");
      }
    }
  });
});
