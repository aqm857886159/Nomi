// 画面比例（aspect ratio）的单一真相源解析。
// 三处复用同一份逻辑（P4 通用第一）：
//   ① 画布节点图像区（BaseGenerationNode）未生成态按比例显示形状
//   ② 计划清单卡的比例下拉预览（AspectBox 组件）
//   ③ 参数面板的比例预览
// 比例值是 vendor 档案里的字符串（"16:9" / "9:16" / "1:1" …），存在 node.meta。
// 不同档案的 key 命名不一：多数是 `aspect_ratio`，imagen4/qwen 用 `size`，
// Seedream 改图模式用 `image_size`（named bucket 格式，见下方映射表）。
import type { GenerationCanvasEdge, GenerationCanvasNode } from "../model/generationCanvasTypes";

// 比例参数可能用到的 meta key，按常见度排序。
export const ASPECT_RATIO_KEYS = ["aspect_ratio", "size", "ratio", "image_size"] as const;

/**
 * Named bucket → W:H 标准字符串映射。
 * 覆盖 Seedream edit mode 的 image_size 枚举值（portrait_4_3 等）。
 * 值是 W:H 字符串，可直接被 parseAspectRatioValue 解析，也可直接写入 meta.aspect_ratio。
 */
const NAMED_RATIO_TO_WH: Readonly<Record<string, string>> = {
  square:         "1:1",
  square_hd:      "1:1",
  portrait_4_3:   "3:4",
  portrait_3_2:   "2:3",
  portrait_16_9:  "9:16",
  landscape_4_3:  "4:3",
  landscape_3_2:  "3:2",
  landscape_16_9: "16:9",
  landscape_21_9: "21:9",
};

/**
 * 把 "W:H" 比例字符串（或 named bucket）解析成数值宽高比（width / height）。
 * - "16:9" → 1.777…，"9:16" → 0.5625，"1:1" → 1
 * - named bucket（"square_hd" / "portrait_4_3" …）→ 对应 W:H 再解析
 * - 不认识的值（"adaptive" / "auto" / "2K" / "basic" / 空）→ null
 * 支持中文冒号「：」。
 */
export function parseAspectRatioValue(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)$/);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!(width > 0) || !(height > 0)) return null;
    return width / height;
  }
  // named bucket（Seedream edit mode 等）
  const mapped = NAMED_RATIO_TO_WH[trimmed];
  return mapped ? parseAspectRatioValue(mapped) : null;
}

/**
 * 把任意比例值规范化为 "W:H" 字符串。
 * - 已是 W:H → 原样返回
 * - named bucket → 映射到 W:H
 * - 不认识（"auto" / "2K" / …）→ null
 * 用于写参数时同步更新 meta.aspect_ratio（最高优先级读取键），避免跨模式 key 遮蔽。
 */
export function normalizeAspectRatioToWH(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)$/.test(trimmed)) return trimmed;
  return NAMED_RATIO_TO_WH[trimmed] ?? null;
}

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
  const AUTO_LIKE = /^(auto|adaptive|自动|智能)$/i;
  if (AUTO_LIKE.test(rawValue.trim()) || AUTO_LIKE.test(rawLabel.trim())) return -1;
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
