// BaseGenerationNode 的纯工具/常量：状态文案、尺寸边界、媒体尺寸推算、时间轴落点命中。
// 从 BaseGenerationNode.tsx 抽出（纯函数 + 常量，无 React 依赖）。
import type { GenerationCanvasNode } from "../model/generationCanvasTypes";
import { readNodeAspectRatio } from "./aspectRatio";
import { isCardRenderKind, resolveNodeRenderKind } from "./resolveRenderKind";

export const STATUS_LABEL: Record<string, string> = {
    queued: "排队中",
    running: "生成中",
    error: "生成失败",
};

export type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_DIRECTIONS: ResizeDirection[] = [
    "n",
    "s",
    "e",
    "w",
    "ne",
    "nw",
    "se",
    "sw",
];
export const MIN_NODE_WIDTH = 240;
export const MAX_NODE_WIDTH = 680;
export const MIN_NODE_HEIGHT = 120;
export const MAX_NODE_HEIGHT = 520;
// 文本节点（C5）自由缩放边界——文档卡片要更宽更高才好写。
export const TEXT_MIN_WIDTH = 280;
export const TEXT_MAX_WIDTH = 680;
export const TEXT_MIN_HEIGHT = 200;
export const TEXT_MAX_HEIGHT = 800;
export type NodeSizeBounds = {
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
};
// 非媒体节点（含 text）自由缩放时的 min/max。媒体（图/视频）走比例锁定分支，
// 仍用上面的 MIN/MAX_NODE_*，故此处只为「自由拉伸」路径按 kind 取边界。
export function getNodeSizeBounds(kind: GenerationCanvasNode["kind"]): NodeSizeBounds {
    if (kind === "text") {
        return {
            minWidth: TEXT_MIN_WIDTH,
            maxWidth: TEXT_MAX_WIDTH,
            minHeight: TEXT_MIN_HEIGHT,
            maxHeight: TEXT_MAX_HEIGHT,
        };
    }
    return {
        minWidth: MIN_NODE_WIDTH,
        maxWidth: MAX_NODE_WIDTH,
        minHeight: MIN_NODE_HEIGHT,
        maxHeight: MAX_NODE_HEIGHT,
    };
}
export const TIMELINE_TRACK_CLIPS_SELECTOR = ".workbench-timeline-track__clips";

export const FOCUS_GENERATION_NODE_EVENT = "nomi-focus-generation-node";

export function clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function readFiniteNumber(value: unknown): number | null {
    const parsed =
        typeof value === "number"
            ? value
            : typeof value === "string"
              ? Number(value)
              : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function nodeWidthForAspectRatio(aspectRatio: number): number {
    if (aspectRatio >= 1.75) return 420;
    if (aspectRatio <= 0.72) return 260;
    return 340;
}

export function mediaNodeSize(
    width: number,
    height: number,
    preferredWidth?: number,
): { width: number; height: number; previewHeight: number } | null {
    if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
    )
        return null;
    const aspectRatio = width / height;
    const nodeWidth = clampNumber(
        preferredWidth || nodeWidthForAspectRatio(aspectRatio),
        240,
        680,
    );
    const previewHeight = clampNumber(
        Math.round(nodeWidth / aspectRatio),
        120,
        520,
    );
    return {
        width: nodeWidth,
        height: previewHeight,
        previewHeight,
    };
}

export type MediaMetaPatch = {
  size?: { width: number; height: number };
  meta: Record<string, unknown>;
};

/**
 * 媒体（图片/视频）loadedmetadata 回填的纯计算：据真实 W/H（视频再带真实时长）算出
 * 节点尺寸 + meta 补丁；无变化返回 null（调用方不发空 update）。从 BaseGenerationNode 抽出
 * 保持壳瘦身（R9）+ 可裸测。视频回填 meta.videoDuration 是「拖入视频一律 5 秒」的 catch-all 修复键。
 */
export function computeMediaMetaPatch(params: {
  resultType: string | undefined;
  meta: Record<string, unknown>;
  currentSize: { width?: number; height?: number } | undefined;
  width: number;
  height: number;
  durationSeconds?: number;
}): MediaMetaPatch | null {
  const { resultType, meta, currentSize, width, height, durationSeconds } = params;
  const nextSize = mediaNodeSize(width, height, currentSize?.width);
  if (!nextSize) return null;
  const isVideo = resultType === "video";
  const previousWidth = readFiniteNumber(meta.imageWidth ?? meta.videoWidth);
  const previousHeight = readFiniteNumber(meta.imageHeight ?? meta.videoHeight);
  const previousDuration = readFiniteNumber(meta.videoDuration);
  const userResized = meta.userResized === true;
  const nextDuration =
    isVideo && Number.isFinite(durationSeconds) && (durationSeconds as number) > 0
      ? Math.round((durationSeconds as number) * 1000) / 1000
      : null;
  const mediaPatch = isVideo
    ? {
        videoWidth: width,
        videoHeight: height,
        videoAspectRatio: width / height,
        ...(nextDuration !== null ? { videoDuration: nextDuration } : {}),
      }
    : { imageWidth: width, imageHeight: height, imageAspectRatio: width / height };
  const shouldPatchSize =
    !userResized &&
    (currentSize?.width !== nextSize.width || currentSize?.height !== nextSize.height);
  if (
    previousWidth === width &&
    previousHeight === height &&
    (nextDuration === null || previousDuration === nextDuration) &&
    !shouldPatchSize
  )
    return null;
  return {
    ...(shouldPatchSize ? { size: { width: nextSize.width, height: nextSize.height } } : {}),
    meta: { ...meta, ...mediaPatch, previewHeight: nextSize.previewHeight },
  };
}

// 卡片模式（角色/场景/道具/音轨卡）按 cards-design-v1 §4 的固定宽度；高度部分卡固定、部分动态。
export const CARD_FIXED_WIDTH: Record<string, number> = {
    "character-card": 200,
    "scene-card": 320,
    "prop-card": 200,
    "audio-strip": 420,
};
export const CARD_FIXED_HEIGHT: Record<string, number | null> = {
    "character-card": null, // 动态：宽/比例
    "scene-card": null,
    "prop-card": null,
    "audio-strip": 80,
};

export function cardFixedSize(
    renderKind: string | undefined,
    isCardKind: boolean,
): { width: number | null; height: number | null } {
    if (!isCardKind || !renderKind) return { width: null, height: null };
    return {
        width: CARD_FIXED_WIDTH[renderKind] ?? null,
        height: CARD_FIXED_HEIGHT[renderKind] ?? null,
    };
}

// 节点图像区高度的统一推算。优先级：卡片固定高 > 生成后真实图片比例（stored）>
// 未生成态按选定画面比例 derive 形状（横/竖/方）> 回退到节点自身高度。
export function resolvePreviewHeight(opts: {
    node: GenerationCanvasNode;
    hasResult: boolean;
    isCardKind: boolean;
    cardFixedWidth: number | null;
    cardFixedHeight: number | null;
    storedPreviewHeight: number | null;
    sizeWidth: number;
    sizeHeight: number;
    bounds: NodeSizeBounds;
}): number {
    const {
        node,
        hasResult,
        isCardKind,
        cardFixedWidth,
        cardFixedHeight,
        storedPreviewHeight,
        sizeWidth,
        sizeHeight,
        bounds,
    } = opts;
    // 未生成 + 非卡片时按选定画面比例 derive；生成后或卡片走各自分支。
    const aspectRatio =
        hasResult || isCardKind ? null : readNodeAspectRatio(node);
    const aspectHeight = aspectRatio
        ? clampNumber(
              Math.round(
                  (cardFixedWidth ?? Math.max(bounds.minWidth, sizeWidth)) /
                      aspectRatio,
              ),
              bounds.minHeight,
              bounds.maxHeight,
          )
        : null;
    return (
        cardFixedHeight ??
        storedPreviewHeight ??
        aspectHeight ??
        clampNumber(sizeHeight, bounds.minHeight, bounds.maxHeight)
    );
}

// 节点「真实渲染尺寸」的**单一真相源**。卡片类（角色/场景/道具/音轨/画板）按 cardFixedSize
// 固定宽、resolvePreviewHeight 取高；其余按 size/比例。BaseGenerationNode 的可视外壳与所有
// 几何子系统（连线锚点 / 最小地图 / fitView / 选框）都必须经此取尺寸，不能再用名义 node.size——
// 名义 size 与渲染尺寸有差（character-card 名义宽 300、实渲固定宽 200），连线锚点用名义 size
// 就会从节点右侧 100px 外的空中起笔，看着「连不上」(本次根因)。
const DEFAULT_VISUAL_SIZE = { width: 320, height: 360 };

export function resolveNodeVisualSize(
    node: Pick<GenerationCanvasNode, "kind" | "size" | "renderKind" | "categoryId" | "meta" | "result">,
): { width: number; height: number } {
    const size = node.size || DEFAULT_VISUAL_SIZE;
    const renderKind = resolveNodeRenderKind(node);
    const isCardKind = isCardRenderKind(renderKind);
    const bounds = getNodeSizeBounds(node.kind);
    const { width: cardFixedWidth, height: cardFixedHeight } = cardFixedSize(renderKind, isCardKind);
    const hasResult = Boolean(node.result?.url);
    const isImageGridSplitNode =
        node.kind === "image" &&
        typeof node.meta?.source === "string" &&
        node.meta.source.startsWith("image-grid-split-");
    const storedPreviewHeight =
        typeof node.meta?.previewHeight === "number" && Number.isFinite(node.meta.previewHeight)
            ? isImageGridSplitNode
                ? Math.max(1, Math.round(node.meta.previewHeight))
                : clampNumber(Math.round(node.meta.previewHeight), bounds.minHeight, bounds.maxHeight)
            : null;
    const previewHeight = resolvePreviewHeight({
        node: node as GenerationCanvasNode,
        hasResult,
        isCardKind,
        cardFixedWidth,
        cardFixedHeight,
        storedPreviewHeight,
        sizeWidth: size.width,
        sizeHeight: size.height,
        bounds,
    });
    return {
        width: cardFixedWidth ?? Math.max(bounds.minWidth, size.width),
        height: previewHeight,
    };
}

export function findTimelineDropTarget(
    clientX: number,
    clientY: number,
): HTMLElement | null {
    // v0.7.3 fix: elementsFromPoint (plural) 返回所有重叠元素，
    // 跳过被拖动的卡片本身（topmost）找下方的时间轴。
    // 单数版 elementFromPoint 只返回最顶层，拖动时永远是被拖卡片，永远找不到 timeline。
    if (typeof document.elementsFromPoint === "function") {
        const elements = document.elementsFromPoint(clientX, clientY);
        for (const el of elements) {
            const target = el.closest(TIMELINE_TRACK_CLIPS_SELECTOR);
            if (target instanceof HTMLElement) return target;
        }
        return null;
    }
    // 兜底：老浏览器
    const element = document.elementFromPoint(clientX, clientY);
    if (!element) return null;
    return element.closest(TIMELINE_TRACK_CLIPS_SELECTOR) as HTMLElement | null;
}
