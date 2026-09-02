/**
 * Runway ratio geometry — orientation-based normalization, split from runwayOfficial.ts
 * (R9 size gate). Video + image duals live together here.
 *
 * **视频侧的枚举与判别不住在这里**：它们是「Runway union 的线缆事实」，唯一真相源在
 * `electron/shared/videoCapabilities/runwayWireFacts.ts`——因为**能力面**（各档案的
 * `vendorParams.runway`，住 shared/）与**传输侧归一器**（本文件的消费者 runwayOfficial.ts）
 * 说的必须是同一组值：UI 选得到的就得是发得出去的。分层纪律 R26 规定 `electron/shared/` 不得
 * import `electron/catalog/`，所以那张表只能住 shared，本文件**消费**它而不再自持副本。
 * （此前两处各有一份 = 一个事实两个作者，正是本轮合并要消掉的 P1 并行实现。）
 *
 * 图像侧的 `RUNWAY_IMAGE_RATIO_REMAP` / `runwayRatioOrientation` 与视频侧无重叠，继续住这里。
 * 字段对账见 docs/research/2026-09-02-docaudit-fal-runway-etc.md。
 */
import { runwayVideoRatioEnumForModel } from "../shared/videoCapabilities/runwayWireFacts";

/**
 * 从任意 Runway ratio 值（像素 `<w>:<h>` 或友好 `16:9`/`1:1` 或 `auto_720p`）判朝向。
 * `adaptive`/`auto*`/未知 → 方形。像素与友好都走同一个 `<a>:<b>` 解析（`16:9` 也命中）。
 */
function runwayVideoRatioOrientation(ratio: string): "square" | "landscape" | "portrait" {
  const m = ratio.match(/^(\d+)\s*[:x]\s*(\d+)$/);
  if (!m) return "square";
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!a || !b || a === b) return "square";
  return a > b ? "landscape" : "portrait";
}

/**
 * 在某模型的合法枚举里挑一个与目标朝向匹配的比例。枚举里既可能是像素比例（`1280:720`），也可能是友好比例
 * （`16:9`）——两者都用 `<a>:<b>` 判朝向。像素值在同朝向内取面积最接近 targetArea 的；友好值（无面积）作兜底：
 * 同朝向友好值优先取最"常规"的（宽高比最接近 16:9 / 9:16 / 1:1）。枚举里非 `<a>:<b>` 值（`adaptive`/`auto_*`）不参与。
 */
function pickRatioForOrientation(enumValues: readonly string[], orientation: "square" | "landscape" | "portrait", targetArea: number): string | undefined {
  let bestPixel: string | undefined;
  let bestPixelScore = Infinity;
  let bestFriendly: string | undefined;
  let bestFriendlyScore = Infinity;
  const idealAspect = orientation === "square" ? 1 : orientation === "landscape" ? 16 / 9 : 9 / 16;
  for (const value of enumValues) {
    const m = value.match(/^(\d+)\s*[:x]\s*(\d+)$/);
    if (!m) continue; // adaptive/auto_* 不参与朝向匹配
    const a = Number(m[1]);
    const b = Number(m[2]);
    const o = a === b ? "square" : a > b ? "landscape" : "portrait";
    if (o !== orientation) continue;
    if (a >= 100 || b >= 100) {
      // 像素比例：取面积最接近 targetArea 的。
      const score = Math.abs(a * b - targetArea);
      if (score < bestPixelScore) { bestPixelScore = score; bestPixel = value; }
    } else {
      // 友好比例（如 16:9）：取宽高比最接近该朝向理想值的。
      const score = Math.abs(a / b - idealAspect);
      if (score < bestFriendlyScore) { bestFriendlyScore = score; bestFriendly = value; }
    }
  }
  return bestPixel ?? bestFriendly;
}

/**
 * 单一 per-model Runway 视频 ratio 归一化点。ratio 已是该模型合法枚举成员 → 原样返回；否则按朝向映射到枚举内
 * 面积最接近 1280×720 的合法像素值；连朝向都无匹配 → 返回 undefined（调用方据此 delete，让 Runway 用默认）。
 * `adaptive`（对含 adaptive 的族如 hailuo 是合法值 → 直接保留；对不含的族按方形归一）。
 */
export function normalizeRunwayVideoRatio(model: string, ratio: string): string | undefined {
  const enumValues = runwayVideoRatioEnumForModel(model);
  if (!enumValues) return ratio || undefined; // 未建模的模型不动
  const trimmed = ratio.trim();
  if (!trimmed) return undefined;
  if (enumValues.includes(trimmed)) return trimmed; // 已合法
  const orientation = runwayVideoRatioOrientation(trimmed);
  return pickRatioForOrientation(enumValues, orientation, 1280 * 720);
}

/**
 * Runway 的 `/v1/text_to_image` 是**按模型判别的 union**：每个 image 模型有各自的 `ratio` 枚举，
 * 共享 archetype 的比例列表（1024:1024 / 1280:720 / …）**只是其中一部分模型的合法值**。
 * 依据 = Runway 官方 OpenAPI 规范（一手、机读，2026-09-01 照
 *   https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json 对账；`/v1/text_to_image` 为 10-变体
 *   `oneOf`，discriminator=`model`，各变体 `properties.ratio.enum` 逐一列出）：
 *     muse_image  → ["2352:1008","2016:1152","1920:1280","1792:1344","1600:1600","1344:1792","1280:1920","1152:2016","auto"]（**无 1024:1024**）
 *     gpt_image_2 → ["2048:880","1920:1088",…,"1920:1920",…,"2560:1440",…,"1440:2560",…,"auto"]（**无 1024:1024**，2048 系起）
 *     seedream5_lite → ["2048:2048","2304:1728","1728:2304","2848:1600","1600:2848","2496:1664","1664:2496",…]（**无 1024:1024**，全 ≥ 400 万像素）
 *   （反例：seedream5_pro / grok_imagine_image_2 / gen4_image 的 enum **含** 1024:1024 → 不 remap，原样透传。）
 * 2026-09-01 真发 t2i 实测复核（提交即 DELETE，见 /tmp/runway-ratio-probe.mjs）：这三个模型发共享默认 `1024:1024`
 * 全 400 `Validation of body failed`；发下方各自映射值全 ACCEPTED（含 seedream5_pro/grok/gen4 发 1024:1024 仍 ACCEPTED，
 * 证明只该动这三个）。视频侧同类问题早已由 normalizeRunwayVideoContract 的 ratioFamilies 解，图像侧一直漏了。
 * 这里按**朝向**把共享比例映射到各模型 enum 里的合法值（视频侧 ratioFamilies 的图像对偶）。
 *
 * 注·seedream5_lite「freeform」：OpenAPI 把它的 ratio 标成**严格 enum**（上列），但 2026-09-01 实测该模型
 *   **也接受 enum 外的自由 `<w>:<h>`**（如 `2720:1530` 亦 ACCEPTED，只要满足 ~3.68M–16.7M 像素窗）——即活网关比
 *   spec 宽松。**此处仍取 spec 列出的 `2848:1600`/`1600:2848`**（既在 enum、又实测通过），对未来收严 fail-safe，
 *   不押注未文档化的宽松行为。
 */
export const RUNWAY_IMAGE_RATIO_REMAP: Record<string, { square: string; landscape: string; portrait: string }> = {
  // muse_image enum：方=1600:1600、横=2016:1152、竖=1152:2016（均 spec 列出 + 实测 ACCEPTED）。
  muse_image: { square: "1600:1600", landscape: "2016:1152", portrait: "1152:2016" },
  // gpt_image_2 enum（2048 系起）：方=1920:1920、横=2560:1440、竖=1440:2560（均 spec 列出 + 实测 ACCEPTED）。
  gpt_image_2: { square: "1920:1920", landscape: "2560:1440", portrait: "1440:2560" },
  // seedream5_lite enum（全 ≥3.68M px）：方=2048:2048、横=2848:1600、竖=1600:2848（均 spec 列出 + 实测 ACCEPTED）。
  seedream5_lite: { square: "2048:2048", landscape: "2848:1600", portrait: "1600:2848" },
};

/** 从共享 ratio（"1024:1024" / "1280:720" / "auto_1k"…）判朝向。auto_* 视为方形。 */
export function runwayRatioOrientation(ratio: string): "square" | "landscape" | "portrait" {
  const m = ratio.match(/^(\d+)\s*[:x]\s*(\d+)$/);
  if (!m) return "square"; // auto_1k / auto_2k / 未知 → 方
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h || w === h) return "square";
  return w > h ? "landscape" : "portrait";
}
