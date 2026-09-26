// BaseGenerationNode 的纯工具/常量：状态文案、尺寸边界、媒体尺寸推算、时间轴落点命中。
// 从 BaseGenerationNode.tsx 抽出（纯函数 + 常量，无 React 依赖）。
import type { GenerationCanvasNode } from "../model/generationCanvasTypes";
import { GENERATION_NODE_PLUGIN_BY_KIND } from "./registry";
import { readNodeAspectRatio } from "./aspectRatio";
import { isCardRenderKind, resolveNodeRenderKind } from "./resolveRenderKind";
import { readGroupPort } from "../model/groupPort";

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
export const CLIP_NODE_MIN_WIDTH = 560;
export const CLIP_NODE_MAX_WIDTH = 960;
export type NodeSizeBounds = {
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
};
// 非媒体节点（含 text）自由缩放时的 min/max。媒体（图/视频）走比例锁定分支，
// 仍用上面的 MIN/MAX_NODE_*，故此处只为「自由拉伸」路径按 kind 取边界。
export function getNodeSizeBounds(kind: GenerationCanvasNode["kind"]): NodeSizeBounds {
    if (kind === "shot_table") {
        return { minWidth: 560, maxWidth: 1400, minHeight: 160, maxHeight: 900 };
    }
    if (kind === "clip") {
        return {
            minWidth: CLIP_NODE_MIN_WIDTH,
            maxWidth: CLIP_NODE_MAX_WIDTH,
            minHeight: 120,
            maxHeight: 180,
        };
    }
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

/**
 * composer 的「最小可用高度」：提示词 3 行(72) + 底栏 + 内边距/间距。
 *
 * 低于它卡片虽然还在，但提示词区被压到 0、底栏被 `overflow-hidden` 裁到卡外——
 * 看着像还有个控件，其实一个也点不到（2026-08-26 win32 走查塌陷即此，卡片只剩 26px =
 * padding 12+12 + border 1+1，content box 归零）。
 *
 * 卡片 CSS 的 min-height 只读这一处。
 */
export const COMPOSER_MIN_USABLE_HEIGHT = 150;

/**
 * 画布生成浮框的宽（**屏幕像素**，浮框反向缩放，任何缩放下都一样宽）与它离节点底边的间距（画布单位）。
 *
 * 2026-09-25 用户拍板「宽度固定、钉在节点正下方、被挡就挡」：宽度以前是 `w-max` 跟内容撑（360–880），
 * 换模型 / 换语言 / 参数摘要变长都会变——那就是「长度老是变来变去」。560 = 最宽的视频节点底栏
 * （模型 · 参数摘要 · 写提示词三颗 · ×N · 点数 · ↑）在英文下一行放得下的宽度；放不下时参数摘要自己截断。
 */
export const NODE_COMPOSER_WIDTH = 560;
export const NODE_COMPOSER_GAP = 14;

export function clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * 换画幅时保持节点的视觉面积，而不是固定宽度只压扁高度。
 * 当最小/最大边界互相冲突（极端长条比例）时优先守住最大边界与真实比例，
 * 允许短边略低于通用 resize 下限，避免节点跑出画布或谎报画幅。
 */
export function resolveAreaPreservingSize(
    current: { width: number; height: number },
    targetRatio: number,
    bounds: NodeSizeBounds,
): { width: number; height: number } {
    if (!Number.isFinite(targetRatio) || targetRatio <= 0) return current;
    const area = Math.max(1, current.width * current.height);
    const raw = {
        width: Math.sqrt(area * targetRatio),
        height: Math.sqrt(area / targetRatio),
    };
    const minScale = Math.max(
        bounds.minWidth / raw.width,
        bounds.minHeight / raw.height,
    );
    const maxScale = Math.min(
        bounds.maxWidth / raw.width,
        bounds.maxHeight / raw.height,
    );
    const scale =
        minScale <= maxScale ? clampNumber(1, minScale, maxScale) : maxScale;
    return {
        width: Math.max(1, Math.round(raw.width * scale)),
        height: Math.max(1, Math.round(raw.height * scale)),
    };
}

/**
 * 比例切换后保持节点**底边中点**不动：生成浮框恒贴在节点正下方（2026-09-25 用户拍板，不再翻到上方），
 * 底边不动 = 浮框不跳。
 */
export function anchorNodePosition(
    position: { x: number; y: number },
    current: { width: number; height: number },
    next: { width: number; height: number },
): { x: number; y: number } {
    return {
        x: position.x + (current.width - next.width) / 2,
        y: position.y + current.height - next.height,
    };
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
    const bounds = mediaAspectSizeBounds(aspectRatio, getNodeSizeBounds("image"));
    const nodeWidth = clampNumber(preferredWidth || nodeWidthForAspectRatio(aspectRatio), bounds.minWidth, bounds.maxWidth);
    const previewHeight = nodeWidth / aspectRatio;
    return { width: nodeWidth, height: previewHeight, previewHeight };
}

export type MediaMetaPatch = { meta: Record<string, unknown> };

/** Decoded dimensions are derived state, not a user edit or a full-project save. */
export const MEDIA_DIMENSION_UPDATE_OPTIONS = { persist: false, emit: false, history: false } as const;

/** Only measure here; resolveNodeVisualSize owns geometry, including restored legacy sizes. */
export function computeMediaMetaPatch(params: {
  resultType: string | undefined;
  meta: Record<string, unknown>;
  width: number;
  height: number;
  durationSeconds?: number;
}): MediaMetaPatch | null {
  const { resultType, meta, width, height, durationSeconds } = params;
  if (!readFiniteNumber(width) || !readFiniteNumber(height)) return null;
  const isVideo = resultType === "video";
  const nextDuration = isVideo && readFiniteNumber(durationSeconds)
    ? Math.round(durationSeconds! * 1000) / 1000 : null;
  const previousWidth = readFiniteNumber(isVideo ? meta.videoWidth : meta.imageWidth);
  const previousHeight = readFiniteNumber(isVideo ? meta.videoHeight : meta.imageHeight);
  if (previousWidth === width && previousHeight === height &&
      (nextDuration === null || readFiniteNumber(meta.videoDuration) === nextDuration)) return null;
  return { meta: { ...meta, ...(isVideo
    ? { videoWidth: width, videoHeight: height, videoAspectRatio: width / height,
        ...(nextDuration !== null ? { videoDuration: nextDuration } : {}) }
    : { imageWidth: width, imageHeight: height, imageAspectRatio: width / height }) } };
}

/** Feasible ratio-locked bounds; extreme frames may have a short edge below the generic minimum. */
function mediaAspectSizeBounds(ratio: number, bounds: NodeSizeBounds): NodeSizeBounds {
    const maxWidth = Math.min(bounds.maxWidth, bounds.maxHeight * ratio);
    const minWidth = Math.min(maxWidth, Math.max(bounds.minWidth, bounds.minHeight * ratio));
    return { minWidth, maxWidth, minHeight: minWidth / ratio, maxHeight: maxWidth / ratio };
}

type VisualMediaNode = Pick<GenerationCanvasNode, "kind" | "size" | "renderKind" | "categoryId" | "meta" | "result">;

export function readNodeMediaAspectRatio(node: VisualMediaNode): number | null {
    // These nodes render an editor/table/viewer, not a frame-sized media surface.
    if (node.kind === "clip" || node.kind === "shot_table" || node.kind === "panorama" ||
        node.kind === "director" || node.kind === "text" || node.kind === "whiteboard" ||
        node.kind === "audio" || node.kind === "model3d" || node.kind === "agent-artifact") return null;
    if (!node.result?.url || (node.result.type !== "image" && node.result.type !== "video")) return null;
    const video = node.result.type === "video";
    const width = readFiniteNumber(video ? node.meta?.videoWidth : node.meta?.imageWidth);
    const height = readFiniteNumber(video ? node.meta?.videoHeight : node.meta?.imageHeight);
    const ratio = width && height ? width / height : null;
    return ratio && Number.isFinite(ratio) ? ratio : null;
}

export function readNodeCardInfoHeight(node: VisualMediaNode): number {
    const kind = resolveNodeRenderKind(node);
    return kind === "character-card" || kind === "prop-card"
        ? readFiniteNumber(node.meta?.cardInfoHeight) ?? 0 : 0;
}

function isImageGridSplit(node: VisualMediaNode): boolean {
    return node.result?.type === "image" && typeof node.meta?.source === "string" && node.meta.source.startsWith("image-grid-split-");
}

export function getNodeResizeBounds(node: VisualMediaNode): NodeSizeBounds {
    const bounds = getNodeSizeBounds(node.kind);
    const ratio = readNodeMediaAspectRatio(node);
    if (!ratio || isCardRenderKind(resolveNodeRenderKind(node))) return bounds;
    if (isImageGridSplit(node)) return { ...bounds, minHeight: bounds.minWidth / ratio, maxHeight: bounds.maxWidth / ratio };
    return mediaAspectSizeBounds(ratio, bounds);
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
    // 编组端口节点（model/groupPort.ts）覆盖的是框体 / 折叠卡本身，尺寸就是投影时给的那个，不走卡片规则。
    if (node.size && readGroupPort(node)) return { width: node.size.width, height: node.size.height };
    if (node.kind === "shot_table") {
        const size = node.size ?? GENERATION_NODE_PLUGIN_BY_KIND.shot_table.defaultSize;
        const bounds = getNodeSizeBounds(node.kind);
        return {
            width: clampNumber(size.width, bounds.minWidth, bounds.maxWidth),
            height: clampNumber(size.height, bounds.minHeight, bounds.maxHeight),
        };
    }
    const size = node.size || DEFAULT_VISUAL_SIZE;
    if (node.kind === "clip") {
        const bounds = getNodeSizeBounds("clip");
        return {
            width: clampNumber(size.width, bounds.minWidth, bounds.maxWidth),
            height: 132,
        };
    }
    const renderKind = resolveNodeRenderKind(node);
    const isCardKind = isCardRenderKind(renderKind);
    const bounds = getNodeSizeBounds(node.kind);
    const { width: cardFixedWidth, height: cardFixedHeight } = cardFixedSize(renderKind, isCardKind);
    const hasResult = Boolean(node.result?.url);
    const mediaAspect = readNodeMediaAspectRatio(node);
    if (mediaAspect && (!isCardKind || (cardFixedWidth !== null && cardFixedHeight === null))) {
        const mediaBounds = getNodeResizeBounds(node);
        const width = cardFixedWidth ?? clampNumber(size.width, mediaBounds.minWidth, mediaBounds.maxWidth);
        return { width, height: width / mediaAspect + readNodeCardInfoHeight(node) };
    }
    const isImageGridSplitNode = isImageGridSplit(node);
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

/**
 * 比例变化的一次性 store patch：meta / size / position 同帧提交，外界不会看到
 * 「尺寸已变、位置还没补」的断口。已有结果只更新下次生成参数，不扭曲当前媒体。
 */
export function buildAspectRatioNodePatch(
    node: GenerationCanvasNode,
    nextMeta: Record<string, unknown>,
    targetRatio: number | null,
): Partial<GenerationCanvasNode> {
    if (!targetRatio || node.result?.url) return { meta: nextMeta };
    const current = resolveNodeVisualSize(node);
    const size = resolveAreaPreservingSize(
        current,
        targetRatio,
        getNodeSizeBounds(node.kind),
    );
    return {
        meta: nextMeta,
        size,
        position: anchorNodePosition(node.position, current, size),
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
