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
 * 图像侧：在某模型的**官方 ratio 枚举**里挑一个与目标朝向匹配的合法值（视频侧 `pickRatioForOrientation`
 * 的图像出口）。枚举本身不在这里——唯一真相源是
 * `electron/shared/imageCapabilities/runwayImageWireFacts.ts`（与档案的 `vendorParams.runway` 同源）。
 *
 * **这个函数取代了原先的 `RUNWAY_IMAGE_RATIO_REMAP`**（2026-09-02 拆平台档案时删）。那张表是
 * 「平台档案 `runway-image` 给全部 9 个产品发同一套比例」的**打补丁**：能力面给非法值 → 传输层
 * 按朝向偷偷改写三个模型（muse / gpt_image_2 / seedream5_lite）。补丁本身还漏——照官方 spec 逐模型
 * 对账，**10 个变体里 10 个**都至少有一个非法值（`1360:768`/`768:1360` 全员不收），只补三个远远不够。
 * 现在能力面（各模型档案的 `vendorParams.runway`）只给得出该模型 enum 内的值，这里退化为
 * **纵深防御**：只有绕过 UI 的 headless / MCP 手写参数才会走到落点逻辑。
 *
 * **落点判据是「形状最接近」，不是视频侧的「面积最接近」**——这个差别是有意的，别照抄视频侧。
 * 图像模型的 enum 常常同时提供 16:9(1.78) 与 21:9(2.33) 这类同朝向但画幅迥异的档，且各档面积
 * 跨度极大（gpt_image_2 从 1.8M 到 6.3M 像素）。按面积挑会把用户要的 `1280:720`(16:9) 落到
 * `2048:880`(2.33)——朝向"对"了，画幅整个变形。按**宽高比**挑则落到 `2560:1440`，正好是 16:9。
 * （这也正是被删的手工表 `RUNWAY_IMAGE_RATIO_REMAP` 当初挑的那三个值：它编码的就是"保形状"。）
 * 同宽高比多档时取**面积最接近 1280×720** 的那个作次级判据，避免无谓地跳到 4K 档。
 */
export function pickRunwayImageRatioForOrientation(
  enumValues: readonly string[],
  orientation: "square" | "landscape" | "portrait",
  targetAspect?: number,
): string | undefined {
  const ideal = targetAspect ?? (orientation === "square" ? 1 : orientation === "landscape" ? 16 / 9 : 9 / 16);
  let best: string | undefined;
  let bestAspectScore = Infinity;
  let bestAreaScore = Infinity;
  for (const value of enumValues) {
    const m = value.match(/^(\d+)\s*[:x]\s*(\d+)$/);
    if (!m) continue; // auto / auto_1k / auto_2k 不参与形状匹配
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!a || !b) continue;
    const o = a === b ? "square" : a > b ? "landscape" : "portrait";
    if (o !== orientation) continue;
    const aspectScore = Math.abs(a / b - ideal);
    const areaScore = Math.abs(a * b - 1280 * 720);
    // 先比形状；形状实质相同（差 <0.01）时再比面积。
    if (aspectScore < bestAspectScore - 0.01 || (Math.abs(aspectScore - bestAspectScore) <= 0.01 && areaScore < bestAreaScore)) {
      best = value;
      bestAspectScore = Math.min(aspectScore, bestAspectScore);
      bestAreaScore = areaScore;
    }
  }
  return best;
}

/** 从共享 ratio（"1024:1024" / "1280:720" / "auto_1k"…）判朝向。auto_* 视为方形。 */
export function runwayRatioOrientation(ratio: string): "square" | "landscape" | "portrait" {
  const m = ratio.match(/^(\d+)\s*[:x]\s*(\d+)$/);
  if (!m) return "square"; // auto_1k / auto_2k / 未知 → 方
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h || w === h) return "square";
  return w > h ? "landscape" : "portrait";
}
