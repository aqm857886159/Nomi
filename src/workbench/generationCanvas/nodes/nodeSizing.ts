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
export const CLIP_NODE_MIN_WIDTH = 560;
export const CLIP_NODE_MAX_WIDTH = 960;
export type NodeSizeBounds = {
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
};
export type ComposerAttachmentSide = "top" | "bottom";

/**
 * 比例切换会同时改节点尺寸和位置；这类同一用户动作不应顺带把 composer 翻到节点另一侧。
 * 首次挂载或比例未变时仍允许正常的视口避让逻辑决定连接侧。
 */
export function shouldPreserveComposerAttachmentOnRatioChange(
    previousRatio: string | null,
    nextRatio: string,
): boolean {
    return previousRatio !== null && previousRatio !== "" && nextRatio !== "" && previousRatio !== nextRatio;
}

export type ComposerAvailableSpaceMeasurement = {
    anchor: { width: number; height: number };
    stage: { width: number; height: number };
};

type ComposerObstacleRect = {
    left: number;
    right: number;
    top: number;
    bottom: number;
};

/**
 * 返回 composer 朝下展开时真正可用的屏幕高度。
 * 折叠时间轴把手等浮层虽然不改变 stage 尺寸，却会盖住同一水平区间内的 composer；
 * 因此它们的顶边也必须成为下边界，不能只看 stage.bottom。
 */
export function getUnobstructedComposerSpaceBelow(input: {
    stage: ComposerObstacleRect;
    node: ComposerObstacleRect;
    composer: Pick<ComposerObstacleRect, "left" | "right">;
    obstacles: ComposerObstacleRect[];
}): number {
    const boundary = input.obstacles.reduce((current, obstacle) => {
        const isBelowNode = obstacle.top >= input.node.bottom;
        const overlapsComposer = obstacle.left < input.composer.right && obstacle.right > input.composer.left;
        return isBelowNode && overlapsComposer ? Math.min(current, obstacle.top) : current;
    }, input.stage.bottom);

    return Math.max(0, boundary - input.node.bottom);
}

/** composer 或舞台尺寸改变时，可用空间已经不同，必须解除比例切换期间的连接侧保持。 */
export function didComposerAvailableSpaceChange(
    previous: ComposerAvailableSpaceMeasurement,
    next: ComposerAvailableSpaceMeasurement,
): boolean {
    return (
        previous.anchor.width !== next.anchor.width ||
        previous.anchor.height !== next.anchor.height ||
        previous.stage.width !== next.stage.width ||
        previous.stage.height !== next.stage.height
    );
}

/** 比例切换只在边界完全没变时保持原连接侧；真实空间或浮层障碍变化必须重新避让。 */
export function shouldAllowComposerAttachmentRecompute(input: {
    preserveForRatioChange: boolean;
    availableSpaceChanged: boolean;
    obstacleChanged: boolean;
    attachmentObstructed: boolean;
}): boolean {
    return (
        !input.preserveForRatioChange ||
        input.availableSpaceChanged ||
        input.obstacleChanged ||
        input.attachmentObstructed
    );
}
// 非媒体节点（含 text）自由缩放时的 min/max。媒体（图/视频）走比例锁定分支，
// 仍用上面的 MIN/MAX_NODE_*，故此处只为「自由拉伸」路径按 kind 取边界。
export function getNodeSizeBounds(kind: GenerationCanvasNode["kind"]): NodeSizeBounds {
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
export const ENSURE_COMPOSER_VISIBLE_EVENT = "nomi-ensure-composer-visible";

/**
 * composer 的「最小可用高度」：提示词 3 行(72) + 底栏 + 内边距/间距。
 *
 * 低于它卡片虽然还在，但提示词区被压到 0、底栏被 `overflow-hidden` 裁到卡外——
 * 看着像还有个控件，其实一个也点不到（2026-08-26 win32 走查塌陷即此，卡片只剩 26px =
 * padding 12+12 + border 1+1，content box 归零）。
 *
 * 因此它同时是三处的**单一真相源**：卡片 CSS 的 min-height、「这一侧装不装得下」的判定下限、
 * 以及 maxHeight 的兜底下限。改这里三处一起动，别再各写各的魔数。
 */
export const COMPOSER_MIN_USABLE_HEIGHT = 150;

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

/** 保持 composer 与节点相连的那条边的中心点不动。 */
export function anchorNodePosition(
    position: { x: number; y: number },
    current: { width: number; height: number },
    next: { width: number; height: number },
    side: ComposerAttachmentSide,
): { x: number; y: number } {
    return {
        x: position.x + (current.width - next.width) / 2,
        y:
            side === "bottom"
                ? position.y + current.height - next.height
                : position.y,
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

/** Runtime media measurement is derived from the loaded asset, not a user edit.
 * Keep it out of the durable project/event paths so viewport reveals cannot
 * schedule a full-project save for every image/video load. */
export const MEDIA_DIMENSION_UPDATE_OPTIONS = {
  persist: false,
  emit: false,
  history: false,
} as const;

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

/**
 * 比例变化的一次性 store patch：meta / size / position 同帧提交，外界不会看到
 * 「尺寸已变、位置还没补」的断口。已有结果只更新下次生成参数，不扭曲当前媒体。
 */
export function buildAspectRatioNodePatch(
    node: GenerationCanvasNode,
    nextMeta: Record<string, unknown>,
    targetRatio: number | null,
    side: ComposerAttachmentSide,
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
        position: anchorNodePosition(node.position, current, size, side),
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
