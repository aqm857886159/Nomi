import type { ModelParameterControl } from "../videoCapabilities/types";

/**
 * **Runway 图像 union 的线缆事实：唯一真相源。**（视频侧 `runwayWireFacts.ts` 的图像对偶）
 *
 * 依据 = Runway 官方 OpenAPI 规范（一手、机读）：
 *   https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json
 *   API version `2024-11-06`，checkedAt `2026-09-02`。
 *   `/v1/text_to_image` 是 **10 变体的 `oneOf` 判别联合**，discriminator = `model`，
 *   每个变体各自声明 `properties.ratio.enum` / 有没有 `outputCount`（及其 min/max）/
 *   `referenceImages.maxItems` / `referenceImages` 是否在 `required` 里。
 *   下面每张表都是逐字抄自该 spec，不是记忆、不是推断。
 *
 * **为什么这张表必须存在**（2026-09-02 实测的缺陷）：此前 9 个不同的 Runway 图像产品共用一个
 * **平台档案** `runway-image`，它声明**一套**共享比例列表
 * （`1024:1024 / 1280:720 / 720:1280 / 1360:768 / 768:1360 / auto_1k / auto_2k`）。
 * 拿这张表逐模型对账，**10 个模型里 10 个都至少有一个非法值**——`1360:768` 与 `768:1360`
 * 在**全部 10 个变体**的 enum 里都不存在，`gpt_image_2` / `muse_image` / `seedream5_lite` /
 * `gemini_2.5_flash` 连 `1024:1024` 都不收。于是传输层只好偷偷改写（`RUNWAY_IMAGE_RATIO_REMAP`
 * 按朝向重映射三个模型），**UI 提供的值和真正发出去的值不是一回事**：用户选了 `1280:720`
 * 却得到 `2560:1440`，或者选中一个恒 400 的值而毫不知情。
 * 这正是视频侧修过的那类病——**一个事实两个作者，必然漂移**。
 *
 * 依赖方向（分层纪律 R26）：**catalog 可以 import shared；shared 永远不 import catalog；
 * src/ 只可以 import `electron/shared/`（`.dependency-cruiser.mjs` 的 `src-no-import-electron`
 * 规则显式 `pathNot: '^electron/shared/'` 开了这个口子）。**
 * 图像档案住 `src/config/modelArchetypes/`、传输归一器住 `electron/catalog/`——两侧唯一
 * 都够得着的中立地就是 `electron/shared/`，故这张表住这里。两个消费者：
 *   1. 能力面：各图像档案的 `mode.vendorParams["runway"]` 由 `runwayImageRatioControl()` 等
 *      **构建**（不重打一遍字面量），UI 只给得出合法值；
 *   2. 传输边界：`electron/catalog/runwayOfficial.ts` 的 `normalizeRunwayImageReferences`
 *      import 同一张表做纵深防御校验（防绕过 UI 的 headless / MCP 调用方）。
 */

/** Runway `/v1/text_to_image` union 的 10 个 `model` 判别串。 */
export type RunwayImageModelKey =
  | "gen4_image"
  | "gen4_image_turbo"
  | "gpt_image_2"
  | "gemini_image3_pro"
  | "gemini_image3.1_flash"
  | "muse_image"
  | "seedream5_pro"
  | "seedream5_lite"
  | "grok_imagine_image_2"
  | "gemini_2.5_flash";

/**
 * 每个模型的合法 `ratio` 枚举，**逐字抄自官方 OpenAPI 各变体的 `properties.ratio.enum`**
 * （顺序也照抄，便于与 spec 逐行 diff 对账）。
 *
 * 判别粒度是**模型**，不是族：`gen4_image` 与 `gen4_image_turbo` 共享同一套 16 值；
 * 而同为 gemini 的三个（`gemini_image3_pro` / `gemini_image3.1_flash` / `gemini_2.5_flash`）
 * enum 差异极大（30 / 56 / 10 个值），所以不做「族」这层抽象——图像侧就是纯逐模型表。
 */
export const RUNWAY_IMAGE_RATIO_ENUMS: Record<RunwayImageModelKey, readonly string[]> = {
  gen4_image: ["1024:1024", "1080:1080", "1168:880", "1360:768", "1440:1080", "1080:1440", "1808:768", "1920:1080", "1080:1920", "2112:912", "1280:720", "720:1280", "720:720", "960:720", "720:960", "1680:720"],
  gen4_image_turbo: ["1024:1024", "1080:1080", "1168:880", "1360:768", "1440:1080", "1080:1440", "1808:768", "1920:1080", "1080:1920", "2112:912", "1280:720", "720:1280", "720:720", "960:720", "720:960", "1680:720"],
  gpt_image_2: ["2048:880", "1920:1088", "1920:1280", "1920:1440", "1920:1536", "1920:1920", "1536:1920", "1440:1920", "1280:1920", "1088:1920", "2912:1248", "2560:1440", "2560:1712", "2560:1920", "2560:2048", "2560:2560", "2048:2560", "1920:2560", "1712:2560", "1440:2560", "3840:1648", "3840:2160", "3504:2336", "3264:2448", "3200:2560", "2880:2880", "2560:3200", "2448:3264", "2336:3504", "2160:3840", "auto"],
  gemini_image3_pro: ["1344:768", "768:1344", "1024:1024", "1184:864", "864:1184", "1536:672", "832:1248", "1248:832", "896:1152", "1152:896", "2048:2048", "1696:2528", "2528:1696", "1792:2400", "2400:1792", "1856:2304", "2304:1856", "1536:2752", "2752:1536", "3168:1344", "4096:4096", "3392:5056", "5056:3392", "3584:4800", "4800:3584", "3712:4608", "4608:3712", "3072:5504", "5504:3072", "6336:2688"],
  "gemini_image3.1_flash": ["512:512", "416:624", "624:416", "432:592", "592:432", "448:576", "576:448", "384:672", "672:384", "768:336", "256:1024", "1024:256", "176:1408", "1408:176", "1024:1024", "832:1248", "1248:832", "864:1184", "1184:864", "896:1152", "1152:896", "768:1344", "1344:768", "1536:672", "512:2048", "2048:512", "352:2816", "2816:352", "2048:2048", "1696:2528", "2528:1696", "1792:2400", "2400:1792", "1856:2304", "2304:1856", "1536:2752", "2752:1536", "3168:1344", "1024:4096", "4096:1024", "704:5632", "5632:704", "4096:4096", "3392:5056", "5056:3392", "3584:4800", "4800:3584", "3712:4608", "4608:3712", "3072:5504", "5504:3072", "6336:2688", "2048:8192", "8192:2048", "1408:11264", "11264:1408"],
  muse_image: ["2352:1008", "2016:1152", "1920:1280", "1792:1344", "1600:1600", "1344:1792", "1280:1920", "1152:2016", "auto"],
  seedream5_pro: ["1024:1024", "1184:896", "896:1184", "1376:768", "768:1376", "1296:864", "864:1296", "2048:2048", "2304:1728", "1728:2304", "2720:1530", "1530:2720", "2496:1664", "1664:2496", "auto_1k", "auto_2k"],
  seedream5_lite: ["2048:2048", "2304:1728", "1728:2304", "2848:1600", "1600:2848", "2496:1664", "1664:2496", "3136:1344", "3072:3072", "3456:2592", "2592:3456", "4096:2304", "2304:4096", "3744:2496", "2496:3744", "4704:2016"],
  grok_imagine_image_2: ["1024:1024", "1280:720", "720:1280", "1152:864", "864:1152", "1248:832", "832:1248", "1248:576", "576:1248", "1280:576", "576:1280", "1408:704", "704:1408", "2048:2048", "2816:1584", "1584:2816", "2368:1776", "1776:2368", "2496:1664", "1664:2496", "2912:1344", "1344:2912", "3200:1440", "1440:3200", "2912:1456", "1456:2912", "auto_1k", "auto_2k"],
  "gemini_2.5_flash": ["1344:768", "768:1344", "1024:1024", "1184:864", "864:1184", "1536:672", "832:1248", "1248:832", "896:1152", "1152:896"],
};

/**
 * 每个模型的 `referenceImages.maxItems`（逐字抄自 spec）。
 *
 * 注意这与此前传输层硬编码的「一律 max 3」**冲突**：`gpt_image_2` 官方收 16 张、
 * `gemini_image3_pro` / `gemini_image3.1_flash` / `seedream5_lite` 收 14 张、
 * `muse_image` / `seedream5_pro` 收 10 张。旧的统一 3 张上限会把用户第 4 张之后的参考图
 * **直接报错拒掉**，而官方明明收得下。
 */
export const RUNWAY_IMAGE_REFERENCE_MAX: Record<RunwayImageModelKey, number> = {
  gen4_image: 3,
  gen4_image_turbo: 3,
  gpt_image_2: 16,
  gemini_image3_pro: 14,
  "gemini_image3.1_flash": 14,
  muse_image: 10,
  seedream5_pro: 10,
  seedream5_lite: 14,
  grok_imagine_image_2: 3,
  "gemini_2.5_flash": 3,
};

/**
 * `referenceImages` 在该变体的 `required` 里 —— 即**没有纯文生图形态**，必须带参考图。
 * spec 里只有 `gen4_image_turbo` 一个（`required: [promptText, ratio, referenceImages, model]`）。
 */
export const RUNWAY_IMAGE_REFERENCE_REQUIRED: readonly RunwayImageModelKey[] = ["gen4_image_turbo"];

/**
 * 该变体**发布了 `outputCount` 属性**及其上限（逐字抄自 spec 的 `properties.outputCount`）。
 * 未登记的模型 = 变体里根本没有这个属性，发过去就是未知字段 → 能力面不许出这个控件。
 *
 * 注：`gemini_image3_pro` 与 `gemini_image3.1_flash` 的 spec 里 `outputCount` 属性**存在但没有
 * min/max 约束**（空对象）。此时按「属性存在即支持」处理，上限取 Runway 图像侧通用的 10
 * ——这是本文件里**唯一一处 spec 没给死数字**的地方，故在此显式标注，不假装它有出处。
 */
export const RUNWAY_IMAGE_OUTPUT_COUNT_MAX: Partial<Record<RunwayImageModelKey, number>> = {
  gpt_image_2: 10,
  muse_image: 10,
  seedream5_pro: 4,
  seedream5_lite: 4,
  grok_imagine_image_2: 4,
  gemini_image3_pro: 10,
  "gemini_image3.1_flash": 10,
};

/** 该 `model` 判别串是不是我们已建模的 Runway 图像模型（窄化用）。 */
export function isRunwayImageModel(model: string): model is RunwayImageModelKey {
  return Object.prototype.hasOwnProperty.call(RUNWAY_IMAGE_RATIO_ENUMS, String(model || "").trim());
}

/**
 * 某个 Runway `model` 判别串的合法 ratio enum。
 * 传输侧归一器与能力面都从这一个入口问，故两侧不可能漂移。
 */
export function runwayImageRatioEnumForModel(model: string): readonly string[] | undefined {
  const key = String(model || "").trim();
  return isRunwayImageModel(key) ? RUNWAY_IMAGE_RATIO_ENUMS[key] : undefined;
}

// ---------------------------------------------------------------------------
// 能力面构建器：由上面同一张表 derive 出 `vendorParams.runway` 用的控件。
// 「构建」不是「重抄」——改官方枚举只改上面那张表，UI 与传输层同时跟着变。
// ---------------------------------------------------------------------------

const toOptions = (values: readonly (string | number)[]): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

/**
 * 某模型在 Runway 上的**比例**控件——选项即官方 enum，用户选得到的就是发得出去的。
 *
 * `defaultValue` 取该 enum 里的首个**方形**值（若在），否则取第一项：方形是图像创作最中性的
 * 默认，且必定合法（选项来自 enum 本身）。`auto*` 不作默认——它把尺寸交给模型猜，
 * 用户看不出自己选了什么。
 */
export function runwayImageRatioControl(model: RunwayImageModelKey, label = "比例"): ModelParameterControl {
  const values = RUNWAY_IMAGE_RATIO_ENUMS[model];
  const square = values.find((value) => {
    const m = value.match(/^(\d+):(\d+)$/);
    return m ? m[1] === m[2] : false;
  });
  return {
    key: "aspect_ratio",
    label,
    type: "select",
    options: toOptions(values),
    defaultValue: square ?? values[0],
  };
}

/**
 * 某模型在 Runway 上的**张数**控件。spec 没发布 `outputCount` 的模型返回 `null`，
 * 调用方据此**不放**这个控件（发过去是未知字段）。
 */
export function runwayImageOutputCountControl(model: RunwayImageModelKey, label = "张数"): ModelParameterControl | null {
  const max = RUNWAY_IMAGE_OUTPUT_COUNT_MAX[model];
  if (!max) return null;
  return { key: "output_count", label, type: "number", options: [], min: 1, max, defaultValue: 1 };
}

/** 某模型在 Runway 上的完整参数集（比例 + 张数，后者按 spec 有无而定）。 */
export function runwayImageParams(model: RunwayImageModelKey): ModelParameterControl[] {
  const outputCount = runwayImageOutputCountControl(model);
  return outputCount ? [runwayImageRatioControl(model), outputCount] : [runwayImageRatioControl(model)];
}
