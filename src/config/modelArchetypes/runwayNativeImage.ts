import type { ModelArchetype } from "./types";
import {
  runwayImageParams,
  RUNWAY_IMAGE_REFERENCE_MAX,
} from "../../../electron/shared/imageCapabilities/runwayImageWireFacts";

/**
 * **Runway 一手图像模型的模型身份档案**（一个模型一个档案，P4）。
 *
 * 这里放的是「目前只有 Runway 一家提供、我们仓里没有别的档案主人」的五个产品：
 * Gen-4 Image（含 Turbo 变体）、Muse Image、Grok Imagine Image 2、Gemini Image 3 Pro、
 * Gemini Image 3.1 Flash。**它们不是「Runway 平台档案」**——每个档案只罩一个产品，
 * 声明的能力面就是那个产品官方 spec 的能力面。若日后别家也提供同一模型，这些档案原地
 * 加 `identifierPatterns` + `vendorParams` 即可服务多家（与 gpt-image-2 同形状），
 * 不需要再建第二个档案。
 *
 * 参数取值**不在这里重打**：全部由 `runwayImageParams()` 从
 * `electron/shared/imageCapabilities/runwayImageWireFacts.ts` 那张官方 OpenAPI 逐字表**构建**。
 * 于是「UI 给得出的」与「传输层发得出的」由同一个作者产出，不可能漂移——这正是被删掉的
 * 平台档案 `runway-image` 犯的错（它给全部 9 个产品发同一套比例，实测 10 个变体里
 * **10 个**都至少有一个非法值，传输层只好偷偷改写）。
 *
 * 参考图槽的 `inputKey` 一律用模型契约的规范键 `reference_image_urls`——这正是 Runway
 * `/v1/text_to_image` 的 mapping body 所读的键（`runwayOfficial.ts` 的
 * `normalizeRunwayImageReferences` 再把它整形成官方的 `referenceImages: [{uri}]`）。
 * 槽上限取官方 `referenceImages.maxItems`（逐模型不同：3 / 10 / 14 / 16）。
 *
 * 依据：https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json
 *       API version 2024-11-06，checkedAt 2026-09-02，`/v1/text_to_image` 的 10 变体 oneOf。
 */

const RUNWAY_OPENAPI_SOURCE = {
  url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json",
  checkedAt: "2026-09-02",
  vendorKey: "runway",
} as const;

/** 该模型的两个模式（文生图 + 参考/改图）。参数与槽上限全部 derive 自官方 wire 表。 */
function runwayImageModes(
  model: Parameters<typeof runwayImageParams>[0],
  refLabel = "参考图",
): ModelArchetype["modes"] {
  const params = runwayImageParams(model);
  const max = RUNWAY_IMAGE_REFERENCE_MAX[model];
  return [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "用文字生成图片",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params,
    },
    {
      id: "i2i",
      intent: "single",
      vendorTerm: "参考图/改图",
      hint: `用参考图（最多 ${max} 张）指导或编辑图片`,
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: refLabel, min: 1, max, inputKey: "reference_image_urls" }],
      params,
    },
  ];
}

/**
 * Gen-4 Image —— Runway 自家图像模型。
 *
 * **Turbo 是它的变体，不是另一个产品**：官方 spec 里 `gen4_image` 与 `gen4_image_turbo`
 * 的 ratio enum 逐字相同（16 个值）、referenceImages 同为 max 3，唯一差别是 Turbo 把
 * `referenceImages` 放进了 `required`（必须带参考图，没有纯文生形态）。
 * 故两者共用本档案：Turbo 行在目录里指向同一 archetypeId，靠 `defaultModeId` 与
 * 目录只发布 i2i 一条 mapping 表达「必须带参考图」这件事。
 */
export const RUNWAY_GEN4_IMAGE_ARCHETYPE: ModelArchetype = {
  id: "runway-gen4-image",
  family: "runway-gen4-image",
  label: "Runway Gen-4 Image",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["gen4_image"],
  // 存量画布节点持久化的是 meta.archetype.id="runway-image"（已删的平台档案）；
  // 靠 legacyIds + 模型身份匹配迁到这里（读时映射，不写库）。
  legacyIds: ["runway-image"],
  sources: [
    {
      ...RUNWAY_OPENAPI_SOURCE,
      covers:
        "/v1/text_to_image 的 gen4_image 变体：ratio 16 值枚举（1024:1024…1680:720）、referenceImages maxItems 3、无 outputCount 属性、required=[promptText,ratio,model]",
    },
  ],
  modes: runwayImageModes("gen4_image"),
};

/**
 * Gen-4 Image Turbo —— 与 Gen-4 Image 同 enum、同参考上限，但**参考图必填**
 * （官方 `required` 含 `referenceImages`），故只有 i2i 一个模式、默认模式即 i2i。
 * 独立档案而非变体：它在目录里是独立一行、且**没有**纯文生能力，
 * 用一个只含 i2i 的档案表达「这个产品就是参考图驱动的」最诚实。
 */
export const RUNWAY_GEN4_IMAGE_TURBO_ARCHETYPE: ModelArchetype = {
  id: "runway-gen4-image-turbo",
  family: "runway-gen4-image",
  label: "Runway Gen-4 Image Turbo",
  kind: "image",
  defaultModeId: "i2i",
  transportTaskKind: "image_edit",
  identifierPatterns: ["gen4_image_turbo"],
  // 这一行原挂 runway-image-reference（已删）。
  legacyIds: ["runway-image-reference"],
  sources: [
    {
      ...RUNWAY_OPENAPI_SOURCE,
      covers:
        "/v1/text_to_image 的 gen4_image_turbo 变体：ratio enum 与 gen4_image 逐字相同、referenceImages maxItems 3 且**在 required 里**（无纯文生形态）、无 outputCount",
    },
  ],
  modes: [runwayImageModes("gen4_image_turbo")[1]],
};

/** Muse Image —— Runway 自家模型。ratio 全是大尺寸（1600:1600 起，含 auto），outputCount ≤10。 */
export const RUNWAY_MUSE_IMAGE_ARCHETYPE: ModelArchetype = {
  id: "runway-muse-image",
  family: "runway-muse",
  label: "Runway Muse Image",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["muse_image"],
  legacyIds: ["runway-image"],
  sources: [
    {
      ...RUNWAY_OPENAPI_SOURCE,
      covers:
        "/v1/text_to_image 的 muse_image 变体：ratio 9 值（2352:1008 / 2016:1152 / 1920:1280 / 1792:1344 / 1600:1600 / 1344:1792 / 1280:1920 / 1152:2016 / auto，**不含 1024:1024**）、referenceImages maxItems 10、outputCount 1–10",
    },
  ],
  modes: runwayImageModes("muse_image"),
};

/**
 * Grok Imagine Image 2 —— xAI 的图像模型，目前仓里只有 Runway 一条接入线。
 * （视频侧的 `grok-imagine-1.5-video` 是**另一个产品**，不共用档案。）
 */
export const GROK_IMAGINE_IMAGE_2_ARCHETYPE: ModelArchetype = {
  id: "grok-imagine-image-2",
  family: "grok-imagine",
  label: "Grok Imagine Image 2",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["grok_imagine_image_2"],
  legacyIds: ["runway-image"],
  sources: [
    {
      ...RUNWAY_OPENAPI_SOURCE,
      covers:
        "/v1/text_to_image 的 grok_imagine_image_2 变体：ratio 28 值（含 1024:1024 / 1280:720 / auto_1k / auto_2k，**不含 1360:768、768:1360**）、referenceImages maxItems 3、outputCount 1–4",
    },
  ],
  modes: runwayImageModes("grok_imagine_image_2"),
};

/** Gemini Image 3 Pro —— Google 的图像模型（与 `nano-banana` 的 Gemini 2.5 Flash Image 是不同产品）。 */
export const GEMINI_IMAGE_3_PRO_ARCHETYPE: ModelArchetype = {
  id: "gemini-image-3-pro",
  family: "gemini-image-3",
  label: "Gemini Image 3 Pro",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["gemini_image3_pro"],
  legacyIds: ["runway-image"],
  sources: [
    {
      ...RUNWAY_OPENAPI_SOURCE,
      covers:
        "/v1/text_to_image 的 gemini_image3_pro 变体：ratio 30 值（1344:768 起，含 1024:1024，**不含 1280:720 / 1360:768 / auto_1k / auto_2k**）、referenceImages maxItems 14、outputCount 属性存在但 spec 未给 min/max",
    },
  ],
  modes: runwayImageModes("gemini_image3_pro"),
};

/** Gemini Image 3.1 Flash —— ratio enum 最长的一个（56 值，含 11264:1408 这类极端画幅）。 */
export const GEMINI_IMAGE_31_FLASH_ARCHETYPE: ModelArchetype = {
  id: "gemini-image-3.1-flash",
  family: "gemini-image-3",
  label: "Gemini Image 3.1 Flash",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["gemini_image3.1_flash"],
  legacyIds: ["runway-image"],
  sources: [
    {
      ...RUNWAY_OPENAPI_SOURCE,
      covers:
        "/v1/text_to_image 的 gemini_image3.1_flash 变体：ratio 56 值（512:512 起至 11264:1408，含 1024:1024，**不含 1280:720 / 1360:768 / auto_1k / auto_2k**）、referenceImages maxItems 14、outputCount 属性存在但 spec 未给 min/max",
    },
  ],
  modes: runwayImageModes("gemini_image3.1_flash"),
};

export const RUNWAY_NATIVE_IMAGE_ARCHETYPES: ModelArchetype[] = [
  RUNWAY_GEN4_IMAGE_ARCHETYPE,
  RUNWAY_GEN4_IMAGE_TURBO_ARCHETYPE,
  RUNWAY_MUSE_IMAGE_ARCHETYPE,
  GROK_IMAGINE_IMAGE_2_ARCHETYPE,
  GEMINI_IMAGE_3_PRO_ARCHETYPE,
  GEMINI_IMAGE_31_FLASH_ARCHETYPE,
];
