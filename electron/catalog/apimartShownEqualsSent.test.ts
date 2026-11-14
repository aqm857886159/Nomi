import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { getArchetypeById, resolveArchetypeForModel, specializeArchetypeForVariant, specializeArchetypeForVendor } from "../shared/modelArchetypes";
import { declaredModeParams } from "../shared/modelArchetypes/modeParams";
import { modeTransportFor } from "../shared/videoCapabilities";
import { APIMART_AUDIO_MODELS } from "./apimartAudios";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { modelReferenceSelection } from "./modelCatalogListing";
import { applyParamMap, bodyReferencedParamKeys, wireReferencedParamKeys } from "./paramTranslate";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { applyHeadlessParamDefaults, taskTemplateParams } from "./taskParams";
import { selectTaskMapping, type CatalogState, type ProfileKind } from "./types";
import registry from "./apimartShownEqualsSent.known-red.json";

// 「面板上露出的 = 这次请求里发得出去的」——按 APIMart 内置目录全扫，这一类问题的尺子（2026-11-15）。
//
// 格子 = 目录里每个认得档案的 APIMart 模型 × 每个变体 × 每个方式 × 这个方式声明的每个控件
// （declaredModeParams：面板、Agent 说明、发送读的同一份）。每一格要答得出「这次请求里它的去处」：
//   · 这个方式命中的那条映射，body / 进程参数 / multipart 字段直接引用它；或
//   · 映射的翻译规则吃掉它、产出的线上键被引用（改名、omitAuto 之类）。
// 明示 drop、规则产出的键没人引用、方式根本没有映射，都算「露出了却没去处」。今天红的格子登记在
// apimartShownEqualsSent.known-red.json（棘轮：只减不增，见下方三条核对）。新模型、新变体、新方式入库自动进格子。
//
// 下面另有几条按官方原话钉的具体形状（H3 webhook、可灵 / Veo 图模式比例、Seedream auto、GPT 改图 auto、提示词必填），
// 那些是「去处对不对」，全扫只管「有没有去处」。出处见各档案 sources 与设计卡 docs/plan/2026-11-15-archetype-wrong-today.md。

const VENDOR = "apimart";
/** 登记条数上限：只许往下改。修好几格就把登记删几条、这里同步改小。 */
const REGISTERED_AT_MOST = 13;
const KNOWN_RED: Readonly<Record<string, string>> = registry.cells;

type Create = {
  body?: unknown;
  process?: { args?: string[] };
  multipart?: { fields?: Record<string, unknown> };
  paramMap?: { rules?: Array<{ wire: string; from?: string; fromMany?: string[] }>; drops?: string[] };
};

function seededState(): CatalogState {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  return applyBuiltinSeeds(empty, "2026-11-15T00:00:00.000Z").state;
}

/** 这条映射为这个控件留的去处；没有 → null。 */
function wireHomeFor(create: Create, key: string): string | null {
  const referenced = new Set([...wireReferencedParamKeys(create), ...bodyReferencedParamKeys(create.multipart?.fields)]);
  if (referenced.has(key)) return key;
  const rule = (create.paramMap?.rules ?? []).find((candidate) =>
    (candidate.from === key || candidate.fromMany?.includes(key)) && referenced.has(candidate.wire));
  return rule ? rule.wire : null;
}

type Cell = { cell: string; home: string | null };

function scanCatalog(): { cells: Cell[]; scannedModels: string[] } {
  const state = seededState();
  const cells: Cell[] = [];
  const scannedModels: string[] = [];
  for (const model of state.models.filter((row) => row.vendorKey === VENDOR)) {
    const archetype = resolveArchetypeForModel({ modelKey: model.modelKey, modelAlias: model.modelAlias, vendorKey: model.vendorKey, meta: model.meta });
    if (!archetype) continue; // 文本模型不走档案
    scannedModels.push(model.modelKey);
    const variants: Array<string | undefined> = archetype.variants?.length ? archetype.variants.map((variant) => variant.id) : [undefined];
    for (const variantId of variants) {
      for (const mode of archetype.modes) {
        const declared = declaredModeParams({ archetype, variantId, modeId: mode.id });
        if (!declared) continue;
        const taskKind = modeTransportFor(mode, archetype, VENDOR) as ProfileKind;
        const mapping = selectTaskMapping(state.mappings, VENDOR, taskKind, model.modelKey, mode.id);
        for (const control of declared.controls) {
          const cell = `${model.kind} ${model.modelKey}${variantId ? `@${variantId}` : ""}/${mode.id}/${control.key}`;
          cells.push({ cell, home: mapping ? wireHomeFor(mapping.create as Create, control.key) : null });
        }
      }
    }
  }
  return { cells, scannedModels };
}

const scan = scanCatalog();
const red = scan.cells.filter((cell) => cell.home === null).map((cell) => cell.cell).sort();

describe("全扫：APIMart 每个模型 × 变体 × 方式 × 露出的控件，请求里都有去处", () => {
  it("扫的是整份目录，不是点名的几个（每个认得档案的 APIMart 模型都进了格子）", () => {
    // 对照的是目录源头的三张表（不经扫描本身）：扫描改回点名几个，这里当场红。
    const declared = [...APIMART_IMAGE_MODELS, ...APIMART_VIDEO_MODELS, ...APIMART_AUDIO_MODELS].map((model) => model.modelKey);
    expect(declared.filter((modelKey) => !scan.scannedModels.includes(modelKey))).toEqual([]);
    expect(scan.scannedModels.length).toBeGreaterThan(60);
    expect(scan.cells.length).toBeGreaterThan(500);
    for (const kind of ["image", "video", "audio"]) expect(scan.cells.some((cell) => cell.cell.startsWith(`${kind} `)), kind).toBe(true);
  });

  it("今天红的格子都登记过（新红一格 = 露出了发不出去，修它，别登记）", () => {
    const unregistered = red.filter((cell) => !(cell in KNOWN_RED));
    expect(unregistered, `露出了、请求里没有去处：\n${unregistered.join("\n")}`).toEqual([]);
  });

  it("登记过的格子今天都还红（修好了就删掉那一条；不许给发得出去的格子预先登记）", () => {
    const stale = Object.keys(KNOWN_RED).filter((cell) => !red.includes(cell));
    expect(stale, `已经有去处，删掉登记：\n${stale.join("\n")}`).toEqual([]);
  });

  it("登记只减不增：条数不超过上限，每条都写了是什么情况", () => {
    expect(Object.keys(KNOWN_RED).length).toBeLessThanOrEqual(REGISTERED_AT_MOST);
    for (const [cell, why] of Object.entries(KNOWN_RED)) expect(why.trim().length, cell).toBeGreaterThan(0);
  });
});

// ── 按官方原话钉的具体形状 ──

function apimartModes(archetypeId: string) {
  const base = getArchetypeById(archetypeId);
  if (!base) throw new Error(`archetype ${archetypeId} missing`);
  const variants: Array<string | undefined> = base.variants?.length ? base.variants.map((variant) => variant.id) : [undefined];
  return variants.flatMap((variantId) => {
    const archetype = specializeArchetypeForVendor(variantId ? specializeArchetypeForVariant(base, variantId) : base, VENDOR);
    return archetype.modes.map((mode) => ({ where: `${archetypeId}${variantId ? `@${variantId}` : ""}/${mode.id}`, mode }));
  });
}

const keysOf = (mode: { params: ReadonlyArray<{ key: string }> }) => mode.params.map((control) => control.key);

describe("MiniMax H3（APIMart）：webhook 是管道，不露出也不进请求体", () => {
  it("每个方式都不声明 webhook 控件", () => {
    for (const { where, mode } of apimartModes("minimax-h3-apimart")) expect(keysOf(mode), where).not.toContain("webhook");
  });
  it("目录两条映射的 body 都不引用 webhook", () => {
    const model = APIMART_VIDEO_MODELS.find((item) => item.archetypeId === "minimax-h3-apimart")!;
    for (const mapping of model.mappings) expect(bodyReferencedParamKeys(mapping.create.body), mapping.id).not.toContain("webhook");
  });
});

describe("可灵 3.0（APIMart）：图生方式比例跟首 / 尾帧走，不给选", () => {
  it("图生不声明 aspect_ratio，文生仍声明", () => {
    const modes = apimartModes("kling-3.0");
    expect(keysOf(modes.find((row) => row.mode.id === "i2v")!.mode)).not.toContain("aspect_ratio");
    expect(keysOf(modes.find((row) => row.mode.id === "t2v")!.mode)).toContain("aspect_ratio");
  });
});

describe("Veo 3.1（APIMart）：三个方式都露出比例，图模式也真的发出去", () => {
  // 官方 veo3/generation 页：aspect_ratio 16:9 / 9:16 不分方式，请求示例即带 image_urls 的图生请求 + "aspect_ratio": "16:9"。
  it("每个变体 × 每个方式都声明 aspect_ratio，选项是 16:9 / 9:16", () => {
    for (const { where, mode } of apimartModes("veo-3.1")) {
      const control = mode.params.find((item) => item.key === "aspect_ratio");
      expect(control, where).toBeTruthy();
      expect(control!.options.map((option) => option.value), where).toEqual(["16:9", "9:16"]);
    }
  });
  it("图生映射的 body 引用 aspect_ratio，不再明示 drop", () => {
    const model = APIMART_VIDEO_MODELS.find((item) => item.archetypeId === "veo-3.1")!;
    const i2v = model.mappings.find((mapping) => mapping.taskKind === "image_to_video")!;
    expect(bodyReferencedParamKeys(i2v.create.body)).toContain("aspect_ratio");
    expect(i2v.create.paramMap?.drops ?? []).not.toContain("aspect_ratio");
  });
});

describe("Seedream 4.5（APIMart）：比例「auto」只在改图有（auto 要参考图才有得匹配）", () => {
  const sizeOptions = (modeId: string) => {
    const mode = apimartModes("seedream").find((row) => row.mode.id === modeId)!.mode;
    return (mode.params.find((control) => control.key === "size")?.options ?? []).map((option) => option.value);
  };
  it("文生图：比例选项里没有 auto", () => {
    expect(sizeOptions("t2i")).not.toContain("auto");
    expect(sizeOptions("t2i")).toContain("1:1");
  });
  it("改图：比例选项保留 auto", () => {
    expect(sizeOptions("edit")).toContain("auto");
  });
});

describe("GPT Image 2（APIMart）改图：比例「自动」不发 size，具体比例照发；文生 auto 照发", () => {
  // 官方 gpt-image-2/generation 页：「Without `size`, output resolution = input image resolution; with `size`, output is forced
  // to the specified ratio」「When `size` is set to `auto`, the default ratio is `1:1`」。
  const model = APIMART_IMAGE_MODELS.find((item) => item.modelKey === "gpt-image-2")!;
  const body = (taskKind: string, extras: Record<string, unknown>) => {
    const mapping = model.mappings.find((item) => item.taskKind === taskKind)!;
    const request = {
      kind: taskKind, prompt: "a quiet sunrise",
      extras: {
        ...applyHeadlessParamDefaults(
          { modelKey: model.modelKey, ...extras },
          modelReferenceSelection(VENDOR, { modelKey: model.modelKey, meta: { archetypeId: model.archetypeId } }, taskKind as never),
          mapping.create.defaultParams, mapping.create.body,
        ),
        ...extras,
      },
    };
    const context = buildTemplateContext({
      request: request as never, params: applyParamMap(mapping.create.paramMap, taskTemplateParams(request as never)),
      model: { modelKey: model.modelKey }, modelKey: model.modelKey, apiKey: "TEST_SECRET",
    });
    return buildHttpRequest({ baseUrl: "https://api.apimart.ai", authType: "bearer", apiKey: "TEST_SECRET", context, operation: mapping.create }).body as Record<string, unknown>;
  };
  const REF = { input_urls: ["https://example.invalid/ref.png"] };
  it("改图默认（自动）：请求里没有 size", () => {
    expect(body("image_edit", REF)).not.toHaveProperty("size");
    expect(body("image_edit", { ...REF, aspect_ratio: "auto" })).not.toHaveProperty("size");
  });
  it("改图选了 16:9：size 照发", () => {
    expect(body("image_edit", { ...REF, aspect_ratio: "16:9" }).size).toBe("16:9");
  });
  it("文生图 auto：照旧发 size:auto（文生没有输入图可跟）", () => {
    expect(body("text_to_image", { aspect_ratio: "auto" }).size).toBe("auto");
  });
});

describe("Seedance 2.0 / Wan 3.0（APIMart）：只有文生要求提示词", () => {
  for (const archetypeId of ["seedance-2-apimart", "wan-3.0-apimart", "wan-3.0-prime-apimart"]) {
    it(archetypeId, () => {
      for (const { where, mode } of apimartModes(archetypeId)) {
        expect(mode.promptRequired, where).toBe(mode.intent === "text");
      }
    });
  }
});
