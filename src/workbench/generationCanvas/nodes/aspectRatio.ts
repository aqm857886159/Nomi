// 画布节点上的画面比例（aspect ratio）读法。「什么值算比例」的判据住
// `electron/shared/aspectRatioValue.ts`（宿主准入层也读它，2026-10-05 从这里搬过去）。
// 三处复用同一份逻辑（P4 通用第一）：
//   ① 画布节点图像区（BaseGenerationNode）未生成态按比例显示形状
//   ② 计划清单卡的比例下拉预览（AspectBox 组件）
//   ③ 参数面板的比例预览
// 比例值是 vendor 档案里的字符串（"16:9" / "9:16" / "1:1" …），存在 node.meta。
// 不同档案的 key 命名不一：多数是 `aspect_ratio`，imagen4/qwen 用 `size`，
// Seedream 改图模式用 `image_size`（named bucket 格式，映射表在 shared 那份）。
import type { GenerationCanvasEdge, GenerationCanvasNode } from "../model/generationCanvasTypes";
import { isAutoOptionValue, normalizeAspectRatioToWH, parseAspectRatioValue } from "../../../../electron/shared/aspectRatioValue";

// 比例参数可能用到的 meta key，按常见度排序。
export const ASPECT_RATIO_KEYS = ["aspect_ratio", "size", "ratio", "image_size"] as const;

/**
 * 从节点 meta 读出当前选定的画面比例（数值）。读不到（未选模型 / 该模型无比例参数）返回 null。
 * 按 ASPECT_RATIO_KEYS 顺序找第一个能解析成 W:H 的值——非比例的 size 值（如 "2K"）会被自动跳过。
 */
export function readNodeAspectRatio(node: GenerationCanvasNode): number | null {
  const meta = node.meta;
  if (!meta || typeof meta !== "object") return null;
  const bag = meta as Record<string, unknown>;
  for (const key of ASPECT_RATIO_KEYS) {
    const ratio = parseAspectRatioValue(bag[key]);
    if (ratio) return ratio;
  }
  return null;
}

/** 常用比例的展示优先序（2026-07-17 用户拍板：常用的排最上，16:9 领头）。不在表内的保持声明序殿后。 */
export const COMMON_RATIO_ORDER: readonly string[] = [
  "16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21", "2:1", "1:2",
];

/**
 * 比例选项排序键：auto/adaptive 这类「自动」语义恒最前（-1，它是所有下拉的默认惯例位），
 * 常用表内按表序，未知比例排最后（大数，调用方用稳定排序保持声明相对序）。
 */
export function commonRatioSortKey(rawValue: string, rawLabel: string): number {
  if (isAutoOptionValue(rawValue) || isAutoOptionValue(rawLabel)) return -1;
  const wh = normalizeAspectRatioToWH(rawValue) ?? normalizeAspectRatioToWH(rawLabel);
  if (!wh) return COMMON_RATIO_ORDER.length + 1;
  const idx = COMMON_RATIO_ORDER.indexOf(wh);
  return idx >= 0 ? idx : COMMON_RATIO_ORDER.length;
}

/**
 * 视频默认比例（2026-07-17 用户拍板）：首选 16:9；仅当**已连接的输入图全部为竖构图**（ratio<1，
 * 至少一个可读）才默认 9:16。输入一个都读不出（未连/素材无比例）→ 16:9。
 */
export function preferredVideoAspect(inputRatios: readonly number[]): "16:9" | "9:16" {
  const readable = inputRatios.filter((r) => Number.isFinite(r) && r > 0);
  if (readable.length > 0 && readable.every((r) => r < 1)) return "9:16";
  return "16:9";
}

/** 采集节点已连接输入（首帧/尾帧/参考）的上游比例（可读的）。供 preferredVideoAspect 用。 */
const INPUT_EDGE_MODES = new Set<string>(["first_frame", "last_frame", "reference"]);
export function collectInputAspectRatios(
  nodeId: string,
  edges: readonly GenerationCanvasEdge[],
  nodes: readonly GenerationCanvasNode[],
): number[] {
  return edges
    .filter((e) => e.target === nodeId && INPUT_EDGE_MODES.has(String(e.mode || "")))
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is GenerationCanvasNode => Boolean(n))
    .map((n) => readNodeAspectRatio(n))
    .filter((r): r is number => r !== null);
}
