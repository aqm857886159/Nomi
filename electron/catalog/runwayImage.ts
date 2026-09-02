/**
 * Runway 图像目录（`/v1/text_to_image`）—— 从 runwayOfficial.ts 拆出（R9 巨壳门岗）。
 *
 * 这里住三件事，它们是同一个关注点的三面：
 *   1. 每一行目录挂哪个**模型身份档案**（RUNWAY_IMAGE_SPECS）；
 *   2. 由该行生成的 mapping（runwayImageModel）；
 *   3. 出站报文的归一 / 纵深校验（normalizeRunwayImageReferences）。
 *
 * 合法取值本身**不在这里**：唯一真相源是
 * `electron/shared/imageCapabilities/runwayImageWireFacts.ts`（逐字抄自官方 OpenAPI），
 * 同时被本文件与各档案的 `vendorParams.runway` 消费——UI 选得到的就是发得出去的。
 */
import { registerRequestTransform } from "../tasks/requestTransforms";
import { desktopT } from "../i18n";
import { pickRunwayImageRatioForOrientation, runwayRatioOrientation } from "./runwayRatio";
import {
  isRunwayImageModel,
  runwayImageRatioEnumForModel,
  RUNWAY_IMAGE_REFERENCE_MAX,
  RUNWAY_IMAGE_REFERENCE_REQUIRED,
  type RunwayImageModelKey,
} from "../shared/imageCapabilities/runwayImageWireFacts";
import type { HttpOperation } from "./types";
import { RUNWAY_HEADERS, runwayImagePoll, runwayImageResult, runwayMapping, runwayUriArray, type RunwayModel } from "./runwayShared";

/**
 * 各接收方档案的参考槽键（见 RUNWAY_IMAGE_SPECS.referenceKey）。归一器要在这几个键里认参考图，
 * 因为 body 读哪个键由**接收方档案的槽 inputKey** 决定（复用既有模型档案的必然结果）。
 * 全部整形成官方的 `referenceImages: [{uri}]` —— 键的差异到此为止，不外泄给 Runway。
 */
const RUNWAY_IMAGE_REFERENCE_KEYS = ["reference_image_urls", "image_urls", "input_urls"] as const;

/**
 * **纵深防御**：绕过 UI 的调用方（headless / MCP）也要被同一张官方表校验。
 *
 * 与能力面同源（`runwayImageWireFacts.ts`）：UI 侧 `vendorParams.runway` 由那张表构建，
 * 这里再用同一张表验一遍。此前这里做的是「按朝向**偷偷改写**三个模型的 ratio」——
 * 那是平台档案给出非法值后的**打补丁**，用户选的和发出去的不是一回事。现在能力面只给得出
 * 合法值，故这里退化成**校验**：合法就原样透传；不合法（只可能来自 headless/MCP 手写参数）
 * 就按朝向落到该模型 enum 内最接近的合法值，而不是发一个保证 400 的数。
 */
function normalizeRunwayImageReferences(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(desktopT("runway.imageBody"));
  const input = body as Record<string, unknown>;
  const model = String(input.model || "").trim();

  const images: string[] = [];
  for (const key of RUNWAY_IMAGE_REFERENCE_KEYS) {
    if (input[key] === undefined) continue;
    images.push(...runwayUriArray(input[key]));
    delete input[key];
  }
  if (RUNWAY_IMAGE_REFERENCE_REQUIRED.includes(model as RunwayImageModelKey) && images.length === 0) {
    throw new Error(desktopT("runway.gen4ReferenceRequired"));
  }
  // 上限**逐模型**取官方 referenceImages.maxItems（3/10/14/16），不再一刀切 3 张：
  // 旧的统一 3 张会把 gpt_image_2（官方收 16 张）的第 4 张起直接报错拒掉。
  const max = isRunwayImageModel(model) ? RUNWAY_IMAGE_REFERENCE_MAX[model] : 3;
  if (images.length > max) throw new Error(desktopT("runway.maxImageReferences", { count: max }));
  if (images.length) input.referenceImages = images.map((uri) => ({ uri }));

  const enumValues = runwayImageRatioEnumForModel(model);
  const ratio = typeof input.ratio === "string" ? input.ratio.trim() : "";
  if (enumValues && ratio && !enumValues.includes(ratio)) {
    // 把**请求的宽高比**一并交给落点器：保形状优先（`1280:720` → `2560:1440` 而不是 21:9 的 `2048:880`）。
    const m = ratio.match(/^(\d+)\s*[:x]\s*(\d+)$/);
    const requested = m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : undefined;
    const fallback = pickRunwayImageRatioForOrientation(enumValues, runwayRatioOrientation(ratio), requested);
    if (fallback) input.ratio = fallback; else delete input.ratio;
  }
  return input;
}

registerRequestTransform("runway-image-references", normalizeRunwayImageReferences, (body) => {
  normalizeRunwayImageReferences(body);
});


/**
 * Runway 图像目录行 → **模型身份档案**（P4：一个模型一个档案主人，供应商无关）。
 *
 * 2026-09-02 拆平台档案：这 10 行原先全部挂在 `runway-image` / `runway-image-reference`
 * 两个**平台档案**上（一个档案罩 9 个不同产品），它们声明一套共享比例
 * （1024:1024 / 1280:720 / 720:1280 / 1360:768 / 768:1360 / auto_1k / auto_2k）喂给全部模型。
 * 按官方 OpenAPI 逐模型对账：**10 个变体里 10 个**都至少有一个非法值（`1360:768`/`768:1360`
 * 在全部 10 个变体的 enum 里都不存在），传输层只好按朝向偷偷改写三个模型 —— 能力面与 wire
 * 两个作者、必然漂移。现在每行挂自己的模型档案，合法取值由
 * `electron/shared/imageCapabilities/runwayImageWireFacts.ts` 单一真相源供给两侧。
 *
 * `archetypeId` 与 `modeId` / `referenceKey` 的对应关系是**接收方档案说了算**：
 * 复用已有档案（gpt-image-2 / seedream-5-pro / kie-seedream-5-lite / nano-banana）时，
 * 该档案的改图模式叫什么（`i2i` 还是 `edit`）、参考槽的 `inputKey` 是什么
 * （`input_urls` / `image_urls` / `reference_image_urls`），本行就得照着发——
 * 否则 `modeSlotReach` 判该槽 reach=none（实测：键不匹配 = 参考图静默发不出去）。
 */
type RunwayImageSpec = {
  modelKey: string;
  labelZh: string;
  /** 接收方模型档案 id（P4：模型身份，不是「Runway 的档案」）。 */
  archetypeId: string;
  /** 该档案里「参考/改图」模式的 id（复用既有档案时必须照抄它的命名）。 */
  editModeId: string;
  /** 该档案参考槽声明的 inputKey —— body 必须读这个键，否则槽不可达。 */
  referenceKey: string;
  allowReferences?: boolean;
  outputCount?: boolean;
  requiresReferences?: boolean;
};
export const RUNWAY_IMAGE_SPECS: RunwayImageSpec[] = [
  // ── 复用既有模型档案（这四个产品我们本来就有档案主人，不再造 Runway 专属孪生档案）──
  { modelKey: "gpt_image_2", labelZh: "Runway GPT Image 2", archetypeId: "gpt-image-2", editModeId: "i2i", referenceKey: "input_urls", allowReferences: true, outputCount: true },
  { modelKey: "seedream5_pro", labelZh: "Runway Seedream 5 Pro", archetypeId: "seedream-5-pro", editModeId: "edit", referenceKey: "image_urls", allowReferences: true, outputCount: true },
  { modelKey: "seedream5_lite", labelZh: "Runway Seedream 5 Lite", archetypeId: "kie-seedream-5-lite", editModeId: "edit", referenceKey: "image_urls", allowReferences: true, outputCount: true },
  { modelKey: "gemini_2.5_flash", labelZh: "Runway Gemini 2.5 Flash Image", archetypeId: "nano-banana", editModeId: "edit", referenceKey: "image_urls", allowReferences: true },
  // ── 仓里尚无档案主人的产品：本轮各建一个**单产品**档案（runwayNativeImage.ts）──
  { modelKey: "muse_image", labelZh: "Runway Muse Image", archetypeId: "runway-muse-image", editModeId: "i2i", referenceKey: "reference_image_urls", allowReferences: true, outputCount: true },
  { modelKey: "grok_imagine_image_2", labelZh: "Runway Grok Imagine Image 2", archetypeId: "grok-imagine-image-2", editModeId: "i2i", referenceKey: "reference_image_urls", allowReferences: true, outputCount: true },
  { modelKey: "gen4_image", labelZh: "Runway Gen-4 Image", archetypeId: "runway-gen4-image", editModeId: "i2i", referenceKey: "reference_image_urls", allowReferences: true },
  { modelKey: "gen4_image_turbo", labelZh: "Runway Gen-4 Image Turbo", archetypeId: "runway-gen4-image-turbo", editModeId: "i2i", referenceKey: "reference_image_urls", allowReferences: true, requiresReferences: true },
  { modelKey: "gemini_image3_pro", labelZh: "Runway Gemini Image 3 Pro", archetypeId: "gemini-image-3-pro", editModeId: "i2i", referenceKey: "reference_image_urls", allowReferences: true, outputCount: true },
  { modelKey: "gemini_image3.1_flash", labelZh: "Runway Gemini Image 3.1 Flash", archetypeId: "gemini-image-3.1-flash", editModeId: "i2i", referenceKey: "reference_image_urls", allowReferences: true, outputCount: true },
];

export function runwayImageModel(spec: RunwayImageSpec): RunwayModel {
  const operation = (withReferences: boolean): HttpOperation => ({
    method: "POST",
    path: "/v1/text_to_image",
    headers: RUNWAY_HEADERS,
    body: {
      promptText: "{{request.prompt}}",
      ratio: "{{request.params.aspect_ratio}}",
      ...(spec.outputCount ? { outputCount: "{{request.params.output_count}}" } : {}),
      // 参考键**跟着接收方档案的槽 inputKey 走**（gpt-image-2 是 input_urls、seedream/nano-banana 是
      // image_urls、Runway 一手档案是 reference_image_urls）。写死一个键会让另外几个档案的参考槽
      // reach=none —— 用户连了图、UI 也显示连上了，请求里却一张都没有。归一器按同一张 spec 表
      // 把这些键统一整形成官方的 referenceImages: [{uri}]。
      ...(withReferences || spec.requiresReferences ? { [spec.referenceKey]: `{{request.params.${spec.referenceKey}}}` } : {}),
      model: spec.modelKey,
    },
    // 始终挂 runway-image-references：它现在同时承载**按模型判别的 ratio 重映射**（muse/gpt/seedream5_lite
    // 的枚举不含共享默认比例 → 不映射就恒 400）。纯 t2i（无参考）过去不挂它，正是这三个模型文生图挂掉的原因。
    request_transform: "runway-image-references",
    ...(!spec.outputCount ? { paramMap: { drops: ["output_count"], rules: [] } } : {}),
    response_mapping: { task_id: "id" },
    provider_meta_mapping: { task_id: "id" },
  });
  const mappings: RunwayModel["mappings"] = [];
  if (!spec.requiresReferences) {
    const t2i = runwayMapping(`seed-runway-${spec.modelKey.replace(/\./g, "-")}-t2i`, "t2i", "text_to_image", `${spec.labelZh} · 文生图`, operation(false));
    t2i.query = runwayImagePoll;
    t2i.result = runwayImageResult;
    mappings.push(t2i);
  }
  if (spec.allowReferences) {
    // mappingId 保持 `-i2i` 后缀（认证台账与既有收据按它索引），但 **modeId 必须是接收方档案里
    // 真实存在的模式 id**（seedream/nano-banana 系叫 `edit`）——否则 selectTaskMapping 取不到线缆。
    const i2i = runwayMapping(`seed-runway-${spec.modelKey.replace(/\./g, "-")}-i2i`, spec.editModeId, "image_edit", `${spec.labelZh} · 参考/改图`, operation(true));
    i2i.query = runwayImagePoll;
    i2i.result = runwayImageResult;
    mappings.push(i2i);
  }
  return { modelKey: spec.modelKey, labelZh: spec.labelZh, kind: "image", archetypeId: spec.archetypeId, mappings } as RunwayModel;
}

