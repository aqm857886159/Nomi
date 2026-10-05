// 铁律 ⑩「说的 = 摆的」：分镜 / 文稿方案里说的比例，落到画布节点上就是它（2026-10-05，
// 设计卡 docs/plan/2026-10-05-storyboard-ratio-and-merge.md）。
//
// 三张表：
//   ① 落画布：整片 / 行级比例（分镜的比例槽 `aspect_ratio`）× 模型 → 节点上真正会发出去的那个键与值；
//   ② 批量条「这几镜不支持」：只在真的落不下时才说不支持（以前凡是比例键不叫 `aspect_ratio` 的都报不支持）；
//   ③ 文稿方案改一镜：只改点名的参数，null 删键，比例收进比例槽；起草时宿主翻好的真实比例键也收进比例槽。
// 用的是真档案，不手写参数表：这一族缺陷的根就在「各家键名不一样」。
import { describe, expect, it } from "vitest";

import { buildAgentModelEntries } from "./availableModels";
import { buildModelEntryIndex, buildPlannedNodeMeta } from "./plannedNodeMeta";
import type { ModelOption } from "../../../config/models";
import { shotModeControls, unsupportedFilmDefaultKeys } from "../../../../electron/shared/storyboard/storyboardShotScope";
import { patchStoryboardSubject, storyboardSubjectFromCandidate } from "../../../../electron/shared/storyboard/storyboardSubjectAdapter";
import type { PlanShot, StoryboardPlan } from "../../../../electron/shared/storyboard/storyboardPlan";
import type { PlanCandidate } from "../../../../electron/capabilityCore/executionContract";
import { projectShotNode } from "../../creation/storyboard/exec/storyboardProjection";
import type { GenerationCanvasNode } from "../model/generationCanvasTypes";

type Model = { label: string; value: string; vendor: string; archetypeId: string; kind: "image" | "video"; modeId?: string };
const MODELS = {
  zImage: { label: "Z-Image Turbo", value: "z-image-turbo", vendor: "apimart", archetypeId: "z-image-turbo", kind: "image" },
  nanoBananaKie: { label: "Nano Banana 2 (kie)", value: "nano-banana-2", vendor: "kie", archetypeId: "nano-banana-2", kind: "image" },
  nanoBananaApimart: { label: "Nano Banana 2 (apimart)", value: "gemini-3.1-flash-image-preview", vendor: "apimart", archetypeId: "nano-banana-2", kind: "image" },
  agnes21: { label: "Agnes 2.1", value: "agnes-image-2.1-flash", vendor: "agnes", archetypeId: "agnes-image-2.1", kind: "image" },
  veoRunway: { label: "Veo 3.1 (Runway)", value: "veo3.1_fast", vendor: "runway", archetypeId: "veo-3.1", kind: "video", modeId: "t2v" },
  klingImageMode: { label: "可灵 3.0 图生视频", value: "kling-v3.0-pro", vendor: "runninghub", archetypeId: "rh-kling-3.0", kind: "video", modeId: "image" },
} satisfies Record<string, Model>;

const index = buildModelEntryIndex(buildAgentModelEntries(Object.values(MODELS).map((model) => ({
  value: model.value, label: model.label, vendor: model.vendor, kind: model.kind, meta: { archetypeId: model.archetypeId },
}) as ModelOption)));

const land = (model: Model, params: Record<string, unknown>) =>
  buildPlannedNodeMeta({ modelKey: model.value, vendor: model.vendor, ...(model.modeId ? { modeId: model.modeId } : {}), params }, index)!;

describe("① 落画布：说的比例 = 节点上会发出去的那个键与值", () => {
  // [模型, 说的, 期望落在哪个键, 期望的值]；undefined = 这个模式没有这一档，诚实缺席（不发一个供应商不认的键）。
  const MATRIX: Array<[keyof typeof MODELS, string, string, unknown]> = [
    ["zImage", "16:9", "size", "16:9"],
    ["zImage", "9:16", "size", "9:16"],
    ["nanoBananaKie", "1:1", "aspect_ratio", "1:1"],
    ["nanoBananaKie", "auto", "aspect_ratio", "auto"],
    ["nanoBananaApimart", "16:9", "size", "16:9"],
    ["agnes21", "21:9", "ratio", "21:9"],
    ["veoRunway", "16:9", "aspect_ratio", "1280:720"],
    ["veoRunway", "9:16", "aspect_ratio", "720:1280"],
  ];
  for (const [name, said, key, value] of MATRIX) {
    it(`${MODELS[name].label} · 说 ${said} → ${key}=${String(value)}`, () => {
      const meta = land(MODELS[name], { aspect_ratio: said });
      expect(meta[key]).toBe(value);
      if (key !== "aspect_ratio") expect(meta).not.toHaveProperty("aspect_ratio");
    });
  }

  it("模型面的语义键 aspectRatio 同样认", () => {
    expect(land(MODELS.zImage, { aspectRatio: "4:3" })).toMatchObject({ size: "4:3" });
  });

  it("这个模式没有这一档：不硬塞，保留档案默认（Z-Image 没有 21:9 → 出厂 1:1；可灵图生视频没有比例 → 不带比例键）", () => {
    expect(land(MODELS.zImage, { aspect_ratio: "21:9" }).size).toBe("1:1");
    const kling = land(MODELS.klingImageMode, { aspect_ratio: "16:9" });
    expect(kling).not.toHaveProperty("aspect_ratio");
    expect(kling).not.toHaveProperty("aspectRatio");
  });
});

describe("①b 改整片画幅写回已落地的节点（模型没换那条路）：同样翻成节点模式的真实键", () => {
  it("Z-Image 节点：整片改成 16:9 → 节点 size=16:9，不多出一个它不认的 aspect_ratio", () => {
    const target: PlanShot = { index: 1, durationSec: 0, anchorIds: [], prompt: "海边日出", shotKind: "image", shotId: "s1", modelKey: "z-image-turbo", modelVendor: "apimart" };
    const node = { id: "n1", kind: "image", title: "", position: { x: 0, y: 0 }, prompt: "海边日出",
      meta: { modelKey: "z-image-turbo", modelVendor: "apimart", archetype: { id: "z-image-turbo", modeId: "t2i" }, size: "1:1" } } as unknown as GenerationCanvasNode;
    const patch = projectShotNode({ title: "t", anchors: [], shots: [target], aspectRatio: "16:9" }, target, node, "shot", index);
    expect(patch.meta).toMatchObject({ size: "16:9" });
    expect(patch.meta).not.toHaveProperty("aspect_ratio");
  });
});

const shot = (overrides: Partial<PlanShot>): PlanShot => ({ index: 1, durationSec: 0, anchorIds: [], prompt: "海边日出", shotKind: "image", ...overrides });
const plan = (shots: PlanShot[], aspectRatio?: string): StoryboardPlan => ({ title: "t", anchors: [], shots, ...(aspectRatio ? { aspectRatio } : {}) });

describe("② 批量条「不支持」：只在真的落不下时说", () => {
  const controlsOf = (model: Model) => shotModeControls({ modelKey: model.value, modelVendor: model.vendor, ...(model.modeId ? { modeId: model.modeId } : {}) });
  const MATRIX: Array<[keyof typeof MODELS, string, boolean]> = [
    ["zImage", "16:9", false],          // 以前：比例键叫 size → 报「不支持」，落画布时被丢
    ["agnes21", "16:9", false],
    ["veoRunway", "16:9", false],       // 像素档按比例对上
    ["nanoBananaKie", "16:9", false],
    ["zImage", "21:9", true],           // 真没有这一档
    ["klingImageMode", "16:9", true],   // 比例跟着首帧走
  ];
  for (const [name, aspect, unsupported] of MATRIX) {
    it(`${MODELS[name].label} · 整片 ${aspect} → ${unsupported ? "不支持" : "落得下"}`, () => {
      const target = shot({ modelKey: MODELS[name].value, modelVendor: MODELS[name].vendor });
      expect(unsupportedFilmDefaultKeys(plan([target], aspect), target, controlsOf(MODELS[name])).length > 0).toBe(unsupported);
    });
  }
});

describe("③ 文稿方案改一镜：只改点名的，null 删键，比例收进比例槽", () => {
  const stored = shot({ shotId: "s1", modelKey: MODELS.nanoBananaKie.value, modelVendor: "kie", params: { aspect_ratio: "16:9", resolution: "4K" } });
  const revise = (parameters: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    patchStoryboardSubject(plan([stored]), "s1", { parameters, ...extra }) as PlanShot;

  it("说「改竖屏」：比例变，清晰度 4K 留着（以前整份替换，4K 掉回默认）", () => {
    expect(revise({ aspectRatio: "9:16" }).params).toEqual({ aspect_ratio: "9:16", resolution: "4K" });
  });

  it("说「清晰度改 1K」：比例留着", () => {
    expect(revise({ resolution: "1K" }).params).toEqual({ aspect_ratio: "16:9", resolution: "1K" });
  });

  it("null 删掉一个键", () => {
    expect(revise({ resolution: null }).params).toEqual({ aspect_ratio: "16:9" });
  });

  it("Agent 写的是这个模型真实的比例键（Z-Image 的 size）：也收进比例槽，不让一镜的比例住两个键", () => {
    const zShot = shot({ shotId: "s1", modelKey: MODELS.zImage.value, modelVendor: "apimart", params: { aspect_ratio: "16:9", resolution: "2K" } });
    expect((patchStoryboardSubject(plan([zShot]), "s1", { parameters: { size: "9:16" } }) as PlanShot).params)
      .toEqual({ aspect_ratio: "9:16", resolution: "2K" });
  });

  it("起草时宿主已翻成真实键（Z-Image size=16:9）：建方案时收进比例槽，表格与整片默认读得到它", () => {
    const candidate: PlanCandidate = {
      candidateId: "c1", revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "z-image-turbo",
      mode: "text_to_image", modeId: "t2i", prompt: "海边日出", parameters: { size: "16:9", resolution: "2K" }, references: [],
    };
    expect((storyboardSubjectFromCandidate({ shotId: "s1", candidate }, 1) as PlanShot).params).toEqual({ aspect_ratio: "16:9", resolution: "2K" });
  });
});
