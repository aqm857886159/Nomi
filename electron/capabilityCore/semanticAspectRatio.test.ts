// 「Agent 说的比例」落到所选模式的真实键（`docs/plan/2026-10-05-agent-aspect-ratio-semantic.md`）。
//
// 用的是**真档案**（`MODEL_ARCHETYPES`），不是手写的参数表：这一族缺陷的根就在「各家键名不一样」，
// 夹具自己编一个键名就测不到它。四种键名各一家：Z-Image `size`、Nano Banana 2 kie `aspect_ratio` /
// apimart `size`、Agnes 2.1 `ratio`（旁边还有一个叫 `size` 的清晰度控件）、RunningHub 可灵 `aspectRatio`。
import { describe, expect, it } from "vitest";

import { ContractCompilationError, compileExecutionContract, type PlanCandidate } from "./executionContract";
import { normalizeAuthoredCandidate } from "./mcpGenerationVideoResolve";
import { createModuleRegistry } from "./moduleRegistry";
import { resolvePlanPatch } from "./generationPlanPatch";

const capabilities = { submitIdempotency: true, query: true, reconcile: true, cancel: true };
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image", "video"],
  modes: ["text_to_image", "image_edit", "text_to_video", "image_to_video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 14 } },
  providers: [
    { providerId: "apimart", models: [
      { modelId: "z-image-turbo", modes: ["text_to_image"], parameterSchema: {}, capabilities },
      { modelId: "gemini-3.1-flash-image-preview", modes: ["text_to_image"], parameterSchema: {}, capabilities },
    ] },
    { providerId: "kie", models: [{ modelId: "nano-banana-2", modes: ["text_to_image"], parameterSchema: {}, capabilities }] },
    { providerId: "agnes", models: [
      { modelId: "agnes-image-2.1-flash", modes: ["text_to_image"], parameterSchema: {}, capabilities },
      { modelId: "agnes-image-2.0-flash", modes: ["text_to_image"], parameterSchema: {}, capabilities },
    ] },
    { providerId: "runninghub", models: [
      { modelId: "kling-v3.0-pro", modes: ["text_to_video", "image_to_video"], parameterSchema: {}, capabilities },
      { modelId: "seedance-2.0-global", modes: ["text_to_video"], parameterSchema: {}, capabilities },
    ] },
    { providerId: "runway", models: [
      { modelId: "wan/3-0-video", modes: ["text_to_video"], parameterSchema: {}, capabilities },
      { modelId: "veo3.1_fast", modes: ["text_to_video"], parameterSchema: {}, capabilities },
      { modelId: "seedance2_fast", modes: ["text_to_video"], parameterSchema: {}, capabilities },
      { modelId: "gen4_image", modes: ["text_to_image"], parameterSchema: {}, capabilities },
      { modelId: "gemini_image3_pro", modes: ["text_to_image"], parameterSchema: {}, capabilities },
      { modelId: "gpt_image_2", modes: ["text_to_image"], parameterSchema: {}, capabilities },
      { modelId: "seedream5_lite", modes: ["text_to_image"], parameterSchema: {}, capabilities },
    ] },
    // 没有档案、参数表只在目录里的那种模型（自接 / 中转站）：翻译读的是 registry 那一份。
    { providerId: "relay", models: [
      { modelId: "custom-image", modes: ["text_to_image"], parameterSchema: { aspect_ratio: { type: "enum", enum: ["16:9", "1:1"] }, seed: { type: "number" } }, capabilities },
      // 像素档、目录里没声明默认值：同一个比例两档分辨率，判不出要哪一档。
      { modelId: "pixel-image", modes: ["text_to_image"], parameterSchema: { aspect_ratio: { type: "enum", enum: ["1280:720", "1920:1080", "1024:1024"] } }, capabilities },
    ] },
  ],
}]);

const candidate = (providerId: string, modelId: string, mode: string, parameters: Record<string, unknown>): PlanCandidate => ({
  candidateId: "cand-1", revision: 1, moduleId: "generation.single-shot",
  providerId, modelId, mode, prompt: "海边日出", parameters, references: [],
});

const translate = (providerId: string, modelId: string, mode: string, parameters: Record<string, unknown>) =>
  normalizeAuthoredCandidate(candidate(providerId, modelId, mode, parameters), registry, undefined).parameters;

function rejection(run: () => unknown): ContractCompilationError {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(ContractCompilationError);
    return error as ContractCompilationError;
  }
  throw new Error("expected a refusal");
}

describe("语义比例 → 所选模式的真实键", () => {
  it("Z-Image（apimart）落 size：用户说 16:9，候选里就是 size=16:9，不再是出厂 1:1", () => {
    expect(translate("apimart", "z-image-turbo", "text_to_image", { aspectRatio: "16:9" })).toEqual({ size: "16:9" });
  });

  it("Nano Banana 2 落它自己那家的键：kie 叫 aspect_ratio，apimart 叫 size（同一档案、按供应商分层）", () => {
    expect(translate("kie", "nano-banana-2", "text_to_image", { aspectRatio: "1:1" })).toEqual({ aspect_ratio: "1:1" });
    expect(translate("apimart", "gemini-3.1-flash-image-preview", "text_to_image", { aspectRatio: "1:1" })).toEqual({ size: "1:1" });
  });

  it("Agnes 2.1 落 ratio——判据看选项不看键名：旁边那个叫 size 的是清晰度，原样不动", () => {
    expect(translate("agnes", "agnes-image-2.1-flash", "text_to_image", { aspectRatio: "16:9", size: "2K" }))
      .toEqual({ ratio: "16:9", size: "2K" });
  });

  it("真实键本来就叫 aspectRatio 的（RunningHub 可灵）：照样过选项校验，落同名键", () => {
    expect(translate("runninghub", "kling-v3.0-pro", "text_to_video", { aspectRatio: "9:16", duration: "5" }))
      .toEqual({ aspectRatio: "9:16", duration: "5" });
    expect(rejection(() => translate("runninghub", "kling-v3.0-pro", "text_to_video", { aspectRatio: "4:3" })).code)
      .toBe("parameter_not_in_enum");
  });

  it("没有档案的模型读 registry 的参数表", () => {
    expect(translate("relay", "custom-image", "text_to_image", { aspectRatio: "16:9", seed: 3 })).toEqual({ aspect_ratio: "16:9", seed: 3 });
  });

  it("写法宽容：全角冒号、带空格、具名桶都认，落的是选项自己的值", () => {
    expect(translate("apimart", "z-image-turbo", "text_to_image", { aspectRatio: "16：9" })).toEqual({ size: "16:9" });
    expect(translate("apimart", "z-image-turbo", "text_to_image", { aspectRatio: " 9 : 16 " })).toEqual({ size: "9:16" });
    expect(translate("apimart", "z-image-turbo", "text_to_image", { aspectRatio: "landscape_16_9" })).toEqual({ size: "16:9" });
  });

  it("auto 照实送该控件自己的自动档（auto / adaptive）", () => {
    expect(translate("kie", "nano-banana-2", "text_to_image", { aspectRatio: "auto" })).toEqual({ aspect_ratio: "auto" });
    expect(translate("runninghub", "seedance-2.0-global", "text_to_video", { aspectRatio: "auto" })).toEqual({ ratio: "adaptive" });
  });

  it("没写比例：同一个对象原样返回（不碰别的参数）", () => {
    const input = candidate("apimart", "z-image-turbo", "text_to_image", { resolution: "2K" });
    expect(normalizeAuthoredCandidate(input, registry, undefined)).toBe(input);
  });
});

describe("翻不了就当场拒，带合法值，绝不回落默认", () => {
  it("Z-Image 要 21:9：parameter_not_in_enum，allowedValues 是它真有的那几档", () => {
    const error = rejection(() => translate("apimart", "z-image-turbo", "text_to_image", { aspectRatio: "21:9" }));
    expect(error.code).toBe("parameter_not_in_enum");
    expect(error.rejection?.allowedValues).toEqual(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"]);
    expect(error.details?.allowedValues).toBe("1:1,4:3,3:4,16:9,9:16,3:2,2:3");
    expect(error.message).toMatch(/21:9/);
    expect(error.message).toMatch(/size/);
  });

  it("没有自动档的模型要 auto 也拒（Z-Image）", () => {
    expect(rejection(() => translate("apimart", "z-image-turbo", "text_to_image", { aspectRatio: "auto" })).code).toBe("parameter_not_in_enum");
  });

  it("不是比例的写法（「竖屏」）拒，并列出合法值", () => {
    const error = rejection(() => translate("apimart", "z-image-turbo", "text_to_image", { aspectRatio: "竖屏" }));
    expect(error.rejection?.allowedValues).toContain("9:16");
  });

  it("没有比例选择的模式拒：像素尺寸档（Agnes 2.0）、比例跟着输入图走的图生视频（可灵 image 模式）", () => {
    expect(rejection(() => translate("agnes", "agnes-image-2.0-flash", "text_to_image", { aspectRatio: "16:9" })).code).toBe("unknown_parameter");
    expect(rejection(() => translate("runninghub", "kling-v3.0-pro", "image_to_video", { aspectRatio: "16:9" })).code).toBe("unknown_parameter");
  });


  it("同一件事写两处且不一样：aspectRatio 与 parameters 里的真实键 → 拒；一样 → 放行", () => {
    expect(() => translate("apimart", "z-image-turbo", "text_to_image", { aspectRatio: "16:9", size: "1:1" })).toThrow(/two different ratios/);
    expect(translate("apimart", "z-image-turbo", "text_to_image", { aspectRatio: "16:9", size: "16:9" })).toEqual({ size: "16:9" });
  });

  it("类型不对拒", () => {
    expect(rejection(() => translate("apimart", "z-image-turbo", "text_to_image", { aspectRatio: 1.78 })).code).toBe("parameter_type_mismatch");
  });

  it("陷阱拆掉了：漏翻到编译口的 aspectRatio 是未知参数（以前是意图键，continue 掉、不上线缆、不报错）", () => {
    const error = rejection(() => compileExecutionContract(
      candidate("relay", "custom-image", "text_to_image", { aspectRatio: "16:9" }), registry,
    ));
    expect(error.code).toBe("unknown_parameter");
    expect(error.rejection?.closestKey).toBe("aspect_ratio");
  });
});

describe("像素档（Runway 那一层：选项是 1280:720 这种像素串）——比例相等就对上，同比例多档按同一档挑", () => {
  it("视频、精确比例、两档同比例（Veo 3.1）：取和默认 1280:720 同档的；9:16 同理", () => {
    expect(translate("runway", "veo3.1_fast", "text_to_video", { aspectRatio: "16:9" })).toEqual({ aspect_ratio: "1280:720" });
    expect(translate("runway", "veo3.1_fast", "text_to_video", { aspectRatio: "9:16" })).toEqual({ aspect_ratio: "720:1280" });
  });

  it("这一镜写着的那一档优先于默认：已经是 1920:1080 再说 16:9，留在 1080 档（不算两处冲突）", () => {
    expect(translate("runway", "veo3.1_fast", "text_to_video", { aspectRatio: "16:9", aspect_ratio: "1920:1080" })).toEqual({ aspect_ratio: "1920:1080" });
  });

  it("等面积分档（Seedance 2）：1:1 落 960:960、21:9 落 1470:630（都和 1280:720 同档）", () => {
    expect(translate("runway", "seedance2_fast", "text_to_video", { aspectRatio: "1:1" })).toEqual({ aspect_ratio: "960:960" });
    expect(translate("runway", "seedance2_fast", "text_to_video", { aspectRatio: "21:9" })).toEqual({ aspect_ratio: "1470:630" });
  });

  it("按短边分档、带「自动 + 分辨率档」（Wan 3.0）：16:9 → 1280:720，1:1 → 720:720，auto → auto_720p", () => {
    expect(translate("runway", "wan/3-0-video", "text_to_video", { aspectRatio: "16:9" })).toEqual({ aspect_ratio: "1280:720" });
    expect(translate("runway", "wan/3-0-video", "text_to_video", { aspectRatio: "1:1" })).toEqual({ aspect_ratio: "720:720" });
    expect(translate("runway", "wan/3-0-video", "text_to_video", { aspectRatio: "auto" })).toEqual({ aspect_ratio: "auto_720p" });
  });

  it("图片、同档里有精确与近似两项（gen4）：取比例最贴的 1280:720；1:1 就是默认那一档 1024:1024", () => {
    expect(translate("runway", "gen4_image", "text_to_image", { aspectRatio: "16:9" })).toEqual({ aspect_ratio: "1280:720" });
    expect(translate("runway", "gen4_image", "text_to_image", { aspectRatio: "1:1" })).toEqual({ aspect_ratio: "1024:1024" });
  });

  it("供应商取整的近似比例也算同一个比例（Gemini 图像 3 的 16:9 档是 1344:768）", () => {
    expect(translate("runway", "gemini_image3_pro", "text_to_image", { aspectRatio: "16:9" })).toEqual({ aspect_ratio: "1344:768" });
  });

  it("按长边分档的大图（gpt-image-2 默认 1920:1920、Seedream 5 Lite 默认 2048:2048）：取同面积那一档", () => {
    expect(translate("runway", "gpt_image_2", "text_to_image", { aspectRatio: "16:9" })).toEqual({ aspect_ratio: "2560:1440" });
    expect(translate("runway", "seedream5_lite", "text_to_image", { aspectRatio: "16:9" })).toEqual({ aspect_ratio: "2848:1600" });
  });

  it("判不出要哪一档就拒并列出候选（像素档、没有默认值）——不随便挑一个", () => {
    const error = rejection(() => translate("relay", "pixel-image", "text_to_image", { aspectRatio: "16:9" }));
    expect(error.code).toBe("parameter_not_in_enum");
    expect(error.rejection?.allowedValues).toEqual(["1280:720", "1920:1080"]);
    // 只有一档同比例时不需要参照：1:1 就是 1024:1024。
    expect(translate("relay", "pixel-image", "text_to_image", { aspectRatio: "1:1" })).toEqual({ aspect_ratio: "1024:1024" });
  });

  it("像素档里没有这个比例照样拒（Veo 3.1 没有 1:1）", () => {
    expect(rejection(() => translate("runway", "veo3.1_fast", "text_to_video", { aspectRatio: "1:1" })).code).toBe("parameter_not_in_enum");
  });
});

describe("改草稿那一扇门：落盘的是翻译之后的参数", () => {
  it("改比例 → normalizedPatch.parameters 是真实键（只落 userPatch 原样，下一次读盘会把 aspectRatio 当残留清掉）", () => {
    const base = candidate("apimart", "z-image-turbo", "text_to_image", { size: "1:1" });
    const { normalizedPatch } = resolvePlanPatch({ baseCandidate: base, userPatch: { parameters: { aspectRatio: "9:16" } }, registry });
    expect(normalizedPatch.parameters).toEqual({ size: "9:16" });
  });

  it("改草稿时翻不了照样拒", () => {
    const base = candidate("apimart", "z-image-turbo", "text_to_image", {});
    expect(() => resolvePlanPatch({ baseCandidate: base, userPatch: { parameters: { aspectRatio: "21:9" } }, registry }))
      .toThrow(ContractCompilationError);
  });
});
