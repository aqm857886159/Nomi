import type { ModelParameterControl } from "./types";

/**
 * **Runway 视频 union 的线缆事实：唯一真相源。**
 *
 * 依据 = Runway 官方 OpenAPI 规范（一手、机读）：
 *   https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json
 *   API version `2024-11-06`，checkedAt `2026-08-30`。
 *   `/v1/text_to_video` 与 `/v1/image_to_video` 都是 `oneOf` 判别联合，discriminator = `model`，
 *   每个变体各自声明 `properties.ratio.enum` / `duration` / 有没有 references 字段。
 *
 * **为什么这张表必须住在 shared/ 而不是留在 catalog/**：同一组事实此前有**两个作者**——
 * `runwayOfficial.ts` 的传输层归一器（`normalizeRunwayVideoContract`）按 family 硬编码了比例枚举与
 * veo 的 4/6/8 时长夹取，而能力面（档案 `vendorParams.runway`）要给用户看的正是同一组合法值。
 * 两处各写一份 = 必然漂移：UI 提供 `16:9`、传输层把它改写成 `1280:720`（或直接删掉），用户看到的
 * 与真正发出去的不是一回事。这正是本轮修的那类病（一个事实两个作者）。
 *
 * 依赖方向（分层纪律 R26）：**catalog 可以 import shared；shared 永远不 import catalog。**
 * 故这张表住 shared，两个消费者各自 import：
 *   1. 能力面：各档案的 `mode.vendorParams["runway"]` 由 `runwayRatioControl()` 等**构建**（不重打一遍）；
 *   2. 传输边界：`electron/catalog/runwayOfficial.ts` 的 `normalizeRunwayVideoContract` import 同一张表，
 *      对绕过 UI 的调用方（headless / MCP）做纵深防御校验。
 */

/** Runway 视频 union 的判别族——每族一组独立的 ratio 枚举与字段集。 */
export type RunwayVideoFamily = "seedance" | "wan" | "hailuo" | "grok" | "veo" | "happyhorse" | "gemini";

/**
 * 每族的合法 `ratio` 枚举，逐字抄自官方 OpenAPI 各变体的 `properties.ratio.enum`。
 *
 * 注意 hailuo / grok 用的是「朝向式」比例串（`16:9`），其余族用**像素式**（`1280:720`）——
 * 这不是我们的归一，是官方 union 里就这么分的。归一器与能力面都按这张表走，故两侧天然一致。
 */
export const RUNWAY_VIDEO_RATIO_ENUMS: Record<RunwayVideoFamily, readonly string[]> = {
  seedance: ["992:432", "864:496", "752:560", "640:640", "560:752", "496:864", "1470:630", "1280:720", "1112:834", "960:960", "834:1112", "720:1280", "2206:946", "1920:1080", "1664:1248", "1440:1440", "1248:1664", "1080:1920", "3840:1646", "3840:2160", "3840:2880", "3840:3840", "2880:3840", "2160:3840"],
  wan: ["832:480", "640:480", "480:480", "480:640", "480:832", "1280:720", "960:720", "720:720", "720:960", "720:1280", "1920:1080", "1440:1080", "1080:1080", "1080:1440", "1080:1920", "auto_480p", "auto_720p", "auto_1080p"],
  hailuo: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  grok: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
  veo: ["1280:720", "720:1280", "1080:1920", "1920:1080"],
  happyhorse: ["1280:720", "720:1280", "960:960", "1108:832", "832:1108", "1920:1080", "1080:1920", "1440:1440", "1662:1248", "1248:1662"],
  gemini: ["1280:720", "720:1280"],
};

/**
 * **族内还要再分的那几个模型**——同族但官方 enum 不同的变体，逐字抄自各自的 OpenAPI 变体。
 *
 * 为什么需要这一层：`ratio` 的判别粒度是**模型**，不是族。seedance 族里只有满血 `seedance2`
 * 收下 1920/3840 系高分辨率；`_fast` / `_mini` 的变体 enum 到 720p 就截止，`seedance2_5` 则是
 * 另一套（`854:480` 而非 `864:496`）。2026-09-02 实测：给 `_fast` / `_mini` 发共享控件暴露的
 * `1920:1080` 恒 400。族表当默认、本表当覆盖，既保留「一个事实一个作者」，又不把精度磨平。
 *
 * 未在此登记的模型 = 族表就是它的 enum（上面 `RUNWAY_VIDEO_RATIO_ENUMS` 已逐字对账）。
 */
const RUNWAY_VIDEO_RATIO_ENUMS_BY_MODEL: Record<string, readonly string[]> = {
  seedance2_fast: ["992:432", "864:496", "752:560", "640:640", "560:752", "496:864", "1470:630", "1280:720", "1112:834", "960:960", "834:1112", "720:1280"],
  seedance2_mini: ["992:432", "864:496", "752:560", "640:640", "560:752", "496:864", "1470:630", "1280:720", "1112:834", "960:960", "834:1112", "720:1280"],
  seedance2_5: ["992:432", "854:480", "752:560", "640:640", "560:752", "480:854", "1470:630", "1280:720", "1112:834", "960:960", "834:1112", "720:1280", "2206:946", "1920:1080", "1664:1248", "1440:1440", "1248:1664", "1080:1920"],
};

/**
 * 某个 Runway `model` 判别串的合法 ratio enum：**先问模型，再退回族**。
 * 传输侧归一器（`normalizeRunwayVideoRatio`）与能力面都从这一个入口问，故两侧不可能漂移。
 */
export function runwayVideoRatioEnumForModel(model: string): readonly string[] | undefined {
  const key = String(model || "").trim();
  const perModel = RUNWAY_VIDEO_RATIO_ENUMS_BY_MODEL[key];
  if (perModel) return perModel;
  const family = runwayVideoFamilyForModel(key);
  return family ? RUNWAY_VIDEO_RATIO_ENUMS[family] : undefined;
}

/**
 * 每族的 `duration` 约束。
 * - `veo`：官方 union 只接受 4 / 6 / 8 秒（枚举，不是区间）——发别的值必 400。
 * - 其余族：官方是区间，各档案自己的 duration 控件已经在区间内，无需本表收窄（故不登记）。
 */
export const RUNWAY_VIDEO_DURATION_ENUMS: Partial<Record<RunwayVideoFamily, readonly number[]>> = {
  veo: [4, 6, 8],
};

/** veo 时长非法时的落点：取最便宜的合法值，而不是发一个保证 400 的数。 */
export const RUNWAY_VEO_FALLBACK_DURATION = 4;

/**
 * `model`（Runway 的判别串）→ 它属于哪一族。**判别逻辑的唯一副本**——
 * 归一器与能力面构建都从这里问，不各写一串 `startsWith` 链。
 */
export function runwayVideoFamilyForModel(model: string): RunwayVideoFamily | null {
  const key = String(model || "").trim();
  if (key.startsWith("seedance2")) return "seedance";
  if (key === "wan3") return "wan";
  if (key === "hailuo3") return "hailuo";
  if (key === "grok_imagine_1_5") return "grok";
  if (key.startsWith("veo3.1")) return "veo";
  if (key === "happyhorse_1_0") return "happyhorse";
  if (key === "gemini_omni_flash") return "gemini";
  return null;
}

/**
 * 只有这几族的 union 发布了 references / referenceVideos / referenceAudio 数组字段。
 * veo / happyhorse / gemini 的变体里**没有** reference 字段——它们只有 `promptImage` 单图位。
 */
export const RUNWAY_FAMILIES_WITH_IMAGE_REFS: readonly RunwayVideoFamily[] = ["seedance", "wan", "hailuo", "grok"];
export const RUNWAY_FAMILIES_WITH_VIDEO_REFS: readonly RunwayVideoFamily[] = ["seedance", "wan", "hailuo"];

/**
 * 该族的 image-to-video 变体**没有** `ratio` 属性（比例由参考图决定）。
 * 官方 happyhorse 的 image_to_video 变体确实不含该属性——发过去就是未知字段。
 */
export const RUNWAY_FAMILIES_WITHOUT_IMAGE_RATIO: readonly RunwayVideoFamily[] = ["happyhorse"];

// ---------------------------------------------------------------------------
// 能力面构建器：由上面同一张表 derive 出 `vendorParams.runway` 用的控件。
// 「构建」不是「重抄」——改官方枚举只改上面那张表，UI 与传输层同时跟着变。
// ---------------------------------------------------------------------------

/** 把一组值做成 select 控件的 options（label = value，比例/时长本就是自解释的串）。 */
const toOptions = (values: readonly (string | number)[]): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

/**
 * 某族在 Runway 上的**比例**控件——选项即官方 enum，用户选得到的就是发得出去的。
 *
 * `defaultValue` 取该族 enum 里的**横屏首选**（若在），否则取第一项：横屏是视频创作的常见默认，
 * 且必定合法（选项来自 enum 本身）。
 */
export function runwayRatioControl(family: RunwayVideoFamily, label = "比例"): ModelParameterControl {
  const values = RUNWAY_VIDEO_RATIO_ENUMS[family];
  const preferred = ["16:9", "1280:720"].find((value) => values.includes(value));
  return {
    key: "aspect_ratio",
    label,
    type: "select",
    options: toOptions(values),
    defaultValue: preferred ?? values[0],
  };
}

/**
 * 某族在 Runway 上的**时长**控件。有枚举约束（veo 的 4/6/8）→ 出 select，用户只选得到合法值；
 * 无枚举约束 → 返回 `null`，调用方沿用档案自己的 duration 控件（不无谓地收窄）。
 */
export function runwayDurationControl(family: RunwayVideoFamily, label = "时长(秒)"): ModelParameterControl | null {
  const values = RUNWAY_VIDEO_DURATION_ENUMS[family];
  if (!values) return null;
  return {
    key: "duration",
    label,
    type: "select",
    options: toOptions(values),
    defaultValue: RUNWAY_VEO_FALLBACK_DURATION,
  };
}

/** Runway 各族都发 `generate_audio`（音频开关）的那几族用同一个控件声明。 */
export const RUNWAY_GENERATE_AUDIO_CONTROL: ModelParameterControl = {
  key: "generate_audio",
  label: "生成音频",
  type: "boolean",
  options: [],
  defaultValue: true,
};
