// 图层分离（一张图 → 底图 + 若干透明图层）这件能力的通用名字（设计卡 docs/plan/2026-11-26-layer-split.md）。
//
// 能力住在档案方式上（`ArchetypeMode.layerSplit`），不认供应商：哪家的线缆真发得出，只看它的 create body 读不读
// `LAYER_SPLIT_WIRE_KEY` 这个通用参数键（`layerSplitWireReady`）。发送口与入口问同一句话——UI 说能拆、发出去却是一次普通改图，
// 这种「花了钱只拿回一张图」的事从结构上做不出来。
import type { ArchetypeMode, ModelArchetype } from "./types";

/** 图层分离方式的 id（各档案同名：换模型时人选的「拆图层」这件事跟着走）。 */
export const LAYER_SPLIT_MODE_ID = "layers";
/** 方式固定参数里的开关键：线缆 body 读它 = 这家发得出图层分离。 */
export const LAYER_SPLIT_WIRE_KEY = "layer_decomposition";
/** 拆成几层（含底图，是上限）。 */
export const LAYER_COUNT_KEY = "layer_count";
/** 清晰度档（auto / 1K / 1.5K / 2K）。和普通改图的比例 `size` 分开存，免得比例值串进分层请求。 */
export const LAYER_SIZE_KEY = "layer_size";
/** 识别文字（文字层带出识别到的字）。 */
export const TEXT_RECOGNITION_KEY = "text_recognition";
/** 层数达到这个数就提醒「层数多就贵」（只提醒，不拦）。 */
export const LAYER_COUNT_COST_REMINDER_AT = 50;

/**
 * 一层的通用描述（主进程 `readTaskLayers` 读出、随 TaskResult.assets 按下标平行送到渲染层；渲染层只认它，不读供应商原始响应）。
 * `box` 是底图像素坐标 [左, 上, 右, 下]；没有框 = 铺满底图（底图本身）。
 */
export type TaskResultLayer = {
  zIndex: number;
  name?: string;
  text?: string;
  box?: { left: number; top: number; right: number; bottom: number };
};

/** 这个方式是不是图层分离。 */
export function isLayerSplitMode(mode: Pick<ArchetypeMode, "layerSplit"> | null | undefined): boolean {
  return Boolean(mode?.layerSplit);
}

/** 档案里的图层分离方式；没有 → undefined。 */
export function layerSplitModeOf(archetype: Pick<ModelArchetype, "modes"> | null | undefined): ArchetypeMode | undefined {
  return archetype?.modes.find((mode) => isLayerSplitMode(mode));
}

/** 这条线缆（create op 读到的参数键）发不发得出图层分离。 */
export function layerSplitWireReady(wireParamKeys: readonly string[] | null | undefined): boolean {
  return Boolean(wireParamKeys?.includes(LAYER_SPLIT_WIRE_KEY));
}

/**
 * 这次要拆几层（含底图）。层数格可调的方式读存值、落在声明的范围里；层数写死的方式（只有上限）给上限。
 * 读不出数 → 方式声明的默认 / 上限。
 */
export function requestedLayerCount(mode: Pick<ArchetypeMode, "layerSplit" | "params">, stored: Readonly<Record<string, unknown>>): number | null {
  const split = mode.layerSplit;
  if (!split) return null;
  const control = mode.params.find((candidate) => candidate.key === LAYER_COUNT_KEY);
  if (!control) return split.maxLayers;
  const raw = Number(stored[LAYER_COUNT_KEY] ?? control.defaultValue);
  const fallback = Number(control.defaultValue ?? split.maxLayers);
  const value = Number.isFinite(raw) ? Math.round(raw) : fallback;
  const min = typeof control.min === "number" ? control.min : 2;
  const max = typeof control.max === "number" ? control.max : split.maxLayers;
  return Math.min(max, Math.max(min, value));
}
