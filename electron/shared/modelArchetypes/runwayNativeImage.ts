import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";
import {
  runwayImageParams,
  RUNWAY_IMAGE_REFERENCE_MAX,
} from "../imageCapabilities/runwayImageWireFacts";

/**
 * **Runway 一手图像模型的模型身份档案**（一个模型一个档案，P4）。
 *
 * 这里放的是「目前只有 Runway 一家提供、我们仓里没有别的档案主人」的五个产品：
 * Gen-4 Image（含 Turbo 变体，Runway 自家出品）、Muse Image（Meta 出品）、Grok Imagine Image 2、
 * Gemini Image 3 Pro、Gemini Image 3.1 Flash。**它们不是「Runway 平台档案」**——每个档案只罩一个产品，
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

/** 该模型的两个模式（文生图 + 参考/改图）。参数与槽上限全部 derive 自官方 wire 表。
 *
 *  `apimart` 参数（B 分层）：这两个产品 2026-09-18 起也经 APIMart 接入（见 GROK / GEMINI 两处档案的
 *  sources）。APIMart 的比例是朝向式 `size`（`16:9`），Runway 是像素式 `ratio`（`1920:1080`），
 *  **一个值在另一家都不合法**，故必须按 vendor 分声明——这正是本文件头写的「日后别家也提供同一模型，
 *  原地加 identifierPatterns + vendorParams 即可」，不新建第二个档案（P4）。
 *  `apimartT2iOnly`：该模型在 APIMart 侧**没有改图端点**（Grok Imagine 2.0 Ext 文档明确列
 *  "Not supported: image-to-image"）→ 只给 t2i 挂 apimart 参数，改图模式仍归 Runway。
 */
function runwayImageModes(
  model: Parameters<typeof runwayImageParams>[0],
  refLabel = "参考图",
  apimart?: { params: ModelParameterControl[]; t2iOnly?: boolean },
): ModelArchetype["modes"] {
  const params = runwayImageParams(model);
  const max = RUNWAY_IMAGE_REFERENCE_MAX[model];
  const apimartT2i = apimart ? { vendorParams: { apimart: apimart.params } } : {};
  const apimartI2i = apimart && !apimart.t2iOnly ? { vendorParams: { apimart: apimart.params } } : {};
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
      ...apimartT2i,
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
      ...apimartI2i,
    },
  ];
}

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

/** APIMart 的 Grok Imagine 2.0 Ext：`size` 7 档朝向式。
 *  **不声明 resolution**：文档里该字段唯一合法值是 `"quality"`（且明写「never use public quality field」），
 *  一个只有一个值的下拉是纯噪音（R2）——不发即走平台默认。
 *  **不声明 n**（1–12）：一个生成节点产出一张图是全站语义。 */
const APIMART_GROK_IMAGINE_2_PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["1:1", "2:3", "3:2", "3:4", "4:3", "16:9", "9:16"]), defaultValue: "16:9" },
];

/** APIMart 的 Gemini 3 Pro Image：`size` 11 档 + `resolution` 大写 1K/2K/4K。
 *  **不声明 n**：文档写死 "Range: 1"。
 *  **不声明 official_fallback**：它是渠道降级开关不是创作参数，且与 -official 型号互斥。
 *  默认比例取 `16:9` 而非 `auto`：文档自己提醒 auto 在文生图会在 1:1/16:9 之间摇摆、
 *  「We recommend specifying an aspect ratio」——默认值不该让同一组参数产出不同画幅。 */
const APIMART_GEMINI_3_PRO_PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]), defaultValue: "16:9" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1K", "2K", "4K"]), defaultValue: "1K" },
];

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

/**
 * Muse Image —— **Meta 的模型**（Meta Superintelligence Labs 2026-07-07 发布），Runway 是转售渠道之一，
 * 不是 Runway 自家出品（此前这里写错成「Runway 自家模型」）。身份按模型走：modelCanonicalIds 里
 * `muse_image` → "muse image"，以后别家接同一个模型能自动并成一条。
 * `id` / `family` 保持原样：它们是已落盘节点 meta 里的档案指针，改了老节点就认不回来。
 * ratio 全是大尺寸（1600:1600 起，含 auto），outputCount ≤10——这些是 Runway 那条线缆的事实。
 */
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
    {
      url: "https://ai.meta.com/blog/introducing-muse-image-muse-video-msl/",
      checkedAt: "2026-09-29",
      covers: "出品方：Meta Superintelligence Labs 开发的 Muse Image，发布于 2026-07-07（页面只提 Meta 自家产品里的可用性，不涉及 Runway）",
    },
    {
      url: "https://about.fb.com/news/2026/07/introducing-muse-image-meta-ai/",
      checkedAt: "2026-09-29",
      covers: "Meta 新闻稿 2026-07-07：Muse Image 是 Meta Superintelligence Labs 的第一个图像生成模型",
    },
  ],
  modes: runwayImageModes("muse_image"),
};

/**
 * Grok Imagine Image 2 —— xAI 的图像模型。**两条接入线**：Runway（文生图 + 参考图）与
 * APIMart 的 `grok-imagine-2.0-ext`（**只有文生图**）。
 * （视频侧的 `grok-imagine-1.5-video` 是**另一个产品**，不共用档案。）
 *
 * ⚠️ 否定式判断：APIMart 文档「Not supported: Image-to-image」是白纸黑字的**拒绝**，不是没写到，
 * 故 APIMart 侧**不注册 image_edit mapping**、改图模式也不挂 apimart 参数。档案仍保留改图模式
 * （Runway 那条线支持），选中 APIMart 行再切改图会在运行时明确报错——与 veo31.ts 记的
 * 「变体×模式禁忌未做门控、错误透传」同一处置，尚无 vendor×mode 的门控轴。
 */
export const GROK_IMAGINE_IMAGE_2_ARCHETYPE: ModelArchetype = {
  id: "grok-imagine-image-2",
  family: "grok-imagine",
  label: "Grok Imagine Image 2",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["grok_imagine_image_2", "grok-imagine-2.0-ext"],
  legacyIds: ["runway-image"],
  sources: [
    {
      ...RUNWAY_OPENAPI_SOURCE,
      covers:
        "/v1/text_to_image 的 grok_imagine_image_2 变体：ratio 28 值（含 1024:1024 / 1280:720 / auto_1k / auto_2k，**不含 1360:768、768:1360**）、referenceImages maxItems 3、outputCount 1–4",
    },
    {
      url: "https://docs.apimart.ai/en/api-reference/images/grok-imagine-2.0-ext/generation.md",
      checkedAt: "2026-09-18",
      vendorKey: "apimart",
      covers:
        "POST /v1/images/generations，model 固定 `grok-imagine-2.0-ext`；size 7 档 1:1|2:3|3:2|3:4|4:3|9:16|16:9（亦收像素别名）；" +
        "n 1–12(默认 1)；resolution 唯一合法值 `quality`（文档另注「never use public quality field」）；" +
        "response_format 仅 `url`；nsfw_check 布尔(默认 false)；**文档明确 Not supported: Image-to-image / streaming / base64 输出**；" +
        "计价 $0.08 / 成功出图；提交返回 202 + data.id，轮询 GET /v1/tasks/{id}，图 URL 有效期 72 小时",
    },
  ],
  modes: runwayImageModes("grok_imagine_image_2", "参考图", { params: APIMART_GROK_IMAGINE_2_PARAMS, t2iOnly: true }),
};

/** Gemini Image 3 Pro —— Google 的图像模型（与 `nano-banana` 的 Gemini 2.5 Flash Image 是不同产品）。
 *  **两条接入线**：Runway 与 APIMart 的 `gemini-3-pro-image-preview`（两家都是参考图上限 14，
 *  这不是巧合——它是模型本身的能力，两家如实转述）。
 *
 *  ⚠️ 只接 APIMart 的 `-preview`（常规通道），**不接 `-official`**：同页两条是同一个模型的两条渠道，
 *  official 走官方直连、贵且限流严，需要时用户可自建自定义模型指过去，不占 curated 名额——
 *  与 nanoBanana2.ts 对 `gemini-3.1-flash-image-preview-official` 的既有拍板逐字一致（D4 极简）。
 */
export const GEMINI_IMAGE_3_PRO_ARCHETYPE: ModelArchetype = {
  id: "gemini-image-3-pro",
  family: "gemini-image-3",
  label: "Gemini Image 3 Pro",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  // `nano-banana-pro` = 同一个模型的另一个名字（Nano Banana Pro；APIMart 文档里是 -official 那条的别名）。
  // 原先误挂在第一代 nano-banana 档案上，2026-09-28 挪到这里。
  identifierPatterns: ["gemini_image3_pro", "gemini-3-pro-image-preview", "nano-banana-pro"],
  legacyIds: ["runway-image"],
  sources: [
    {
      ...RUNWAY_OPENAPI_SOURCE,
      covers:
        "/v1/text_to_image 的 gemini_image3_pro 变体：ratio 30 值（1344:768 起，含 1024:1024，**不含 1280:720 / 1360:768 / auto_1k / auto_2k**）、referenceImages maxItems 14、outputCount 属性存在但 spec 未给 min/max",
    },
    {
      url: "https://docs.apimart.ai/en/api-reference/images/gemini-3-pro/generation.md",
      checkedAt: "2026-09-18",
      vendorKey: "apimart",
      covers:
        "POST /v1/images/generations；model `gemini-3-pro-image-preview`（别名 nano-banana-pro-ext）或 " +
        "`gemini-3-pro-image-preview-official`（别名 nano-banana-pro，**我们不接**）；size 11 档 " +
        "auto|1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|21:9（文档提醒 auto 在文生图会在 1:1/16:9 间摇摆，建议显式指定）；" +
        "resolution **大写** 1K(默认)|2K|4K；**n 取值范围只有 1**；image_urls **最多 14 张**（URL 或完整 " +
        "data: URI，单张 ≤30MB，格式 jpeg/jpg/png/webp）；official_fallback 布尔（与 -official 型号互斥）；" +
        "nsfw_check 布尔(默认 false)；响应 data[0].task_id 异步轮询",
    },
  ],
  modes: runwayImageModes("gemini_image3_pro", "参考图", { params: APIMART_GEMINI_3_PRO_PARAMS }),
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
