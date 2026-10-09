// 剪辑节点内小时间轴的手势几何与准入——「谁拥有这块像素」「点多大才算点中」「屏幕像素换算成节点内像素」的唯一真相。
// 纯函数，靠单测锁真值；ClipNodeTimeline 只负责挂事件。
//
// 为什么要有这一份：节点在画布里被 React Flow 整体缩放（canvasZoom 0.2–3），节点内部的像素是「设计像素」，
// 用户手指落在「屏幕像素」上。命中区域、手柄宽度、播放头抓取宽度、scrub 的坐标换算原来各写各的
// （手柄 12/zoom 夹在 16–28 设计像素，缩到 50% 就只剩 8–14 屏幕像素，放大反而宽到吃掉片段；
// 播放头线是 pointer-events-none，抓取宽度为 0）。统一按屏幕像素定，再在这里一处除以 zoom。

/** 任何可抓取的东西，在屏幕上至少这么宽（不随画布缩放变小）。 */
export const CLIP_GESTURE_MIN_HIT_PX = 8
/** 已选中片段的裁剪手柄屏幕宽度上限（片段够宽时的常态宽度，等于缩放 100% 时原来的 16 设计像素）。未选中（悬停）只给最小的 8px。 */
export const CLIP_HANDLE_MAX_HIT_PX = 16
/** 手柄最多占片段屏幕宽度的这一比例（两侧加起来不超过 68%，中间一定留得出可拖的片段身体）。 */
const CLIP_HANDLE_MAX_SHARE = 0.34
/** 播放头抓取带的屏幕宽度；窄于手柄的 8px 之外会盖到片段头，宽于它抓不准。 */
export const CLIP_PLAYHEAD_HIT_PX = 8

function safeZoom(canvasZoom: number): number {
  return Number.isFinite(canvasZoom) && canvasZoom > 0 ? Math.max(0.1, canvasZoom) : 1
}

/** 屏幕像素 → 节点内（设计）像素。节点内一切尺寸都是设计像素，渲染后再被画布放大 canvasZoom 倍。 */
export function screenPxToDesignPx(screenPx: number, canvasZoom: number): number {
  return screenPx / safeZoom(canvasZoom)
}

/** 鼠标的 client 坐标 → 相对某个节点内元素左缘的设计像素（elementLeft 取 getBoundingClientRect().left，已含缩放）。 */
export function clientXToDesignPx(clientX: number, elementClientLeft: number, canvasZoom: number): number {
  return (clientX - elementClientLeft) / safeZoom(canvasZoom)
}

/**
 * 裁剪手柄的命中宽度（设计像素）。
 * 屏幕上至少 8px：未选中（悬停）片段正好给 8px——悬停就能拉，又不把片段身体挤光（用户是来拖片段的，
 * 手柄不能抢走大半个片段）；已选中片段最多 16px，片段窄时按片段宽度的 34% 收缩，两个手柄之间留得出可拖的身体。
 * 永远不会因为片段窄而小于 8 屏幕像素——除非片段本身已窄到一半都不足 8px（此时每侧各占一半）。
 */
export function clipHandleHitWidth(input: { clipWidth: number; canvasZoom: number; selected: boolean }): number {
  const zoom = safeZoom(input.canvasZoom)
  const clipWidth = Math.max(0, input.clipWidth)
  const clipScreenWidth = clipWidth * zoom
  const screenWidth = Math.min(
    input.selected ? CLIP_HANDLE_MAX_HIT_PX : CLIP_GESTURE_MIN_HIT_PX,
    Math.max(CLIP_GESTURE_MIN_HIT_PX, clipScreenWidth * CLIP_HANDLE_MAX_SHARE),
  )
  return Math.min(screenWidth / zoom, clipWidth / 2)
}

/** 播放头抓取带宽度（设计像素）。 */
export function playheadHitWidth(canvasZoom: number): number {
  return screenPxToDesignPx(CLIP_PLAYHEAD_HIT_PX, canvasZoom)
}

export type ClipGestureAdmission = {
  /** 手势一开始就要把这个节点选中（节点没选中时）。 */
  selectNode: boolean
  /** 手势一开始就要选中的时间轴片段 id；null = 不改片段选择（拖播放头）。 */
  selectClipId: string | null
}

/**
 * 手势准入：按下的那一刻，节点与片段的选中状态要先跟上手势，不能等松手的 click。
 * 原来选中只发生在 click 里：未选中的节点里按住片段就能拖，拖完才被选中——选中态和拖动态脱节，
 * 而拖动本身又会吞掉随后的 click（didDrag 抑制），于是整个手势里节点一直没被选中。
 */
export function resolveClipGestureAdmission(input: {
  nodeSelected: boolean
  selectedClipId: string | undefined
  targetClipId: string | null
}): ClipGestureAdmission {
  return {
    selectNode: !input.nodeSelected,
    selectClipId: input.targetClipId && input.targetClipId !== input.selectedClipId ? input.targetClipId : null,
  }
}

// ───────── 窄片段的点击下限 / 边缘自动滚动 / 落点 ─────────

/** 片段能被点中 / 抓起的屏幕宽度下限：窄于它的片段两侧各补一条看不见的命中垫。 */
export const CLIP_MIN_CLICK_PX = 24
/** 拖到轴边缘多少屏幕像素以内开始自动滚动。 */
export const EDGE_SCROLL_ZONE_PX = 28
/** 贴着边缘时每帧滚动的屏幕像素上限（越靠外越快）。 */
export const EDGE_SCROLL_MAX_STEP_PX = 4

/** 窄片段每侧要补的命中垫宽度（设计像素）；片段本身够宽就是 0。 */
export function clipHitPadWidth(input: { clipWidth: number; canvasZoom: number }): number {
  const zoom = safeZoom(input.canvasZoom)
  const missingScreen = CLIP_MIN_CLICK_PX - Math.max(0, input.clipWidth) * zoom
  return missingScreen > 0 ? missingScreen / 2 / zoom : 0
}

/**
 * 指针贴近轴的左 / 右边缘时，每帧该滚多少（设计像素，负 = 向左）。不在边缘带内为 0。
 * 指针拖出轴外也按最快速度滚，所以拖得越远越不会「滚不动」。
 */
export function edgeScrollStep(input: { clientX: number; viewportLeft: number; viewportRight: number; canvasZoom: number }): number {
  const zone = EDGE_SCROLL_ZONE_PX
  const intoLeft = input.viewportLeft + zone - input.clientX
  const intoRight = input.clientX - (input.viewportRight - zone)
  const depth = intoLeft > 0 ? -Math.min(1, intoLeft / zone) : intoRight > 0 ? Math.min(1, intoRight / zone) : 0
  return screenPxToDesignPx(depth * EDGE_SCROLL_MAX_STEP_PX, input.canvasZoom)
}

/**
 * 素材落在轴上的哪一帧：落在某个片段上 = 吸到离落点近的那条边（插在它前面或后面）；落在空白 = 落点所在帧。
 * 插入指示画在这一帧，松手也插在这一帧——预览与落点是同一个函数的返回值，不会各算一份。
 */
export function resolveClipNodeDropFrame(clips: ReadonlyArray<{ startFrame: number; endFrame: number }>, dropFrame: number): number {
  const frame = Math.max(0, Math.round(dropFrame))
  const over = clips.find((clip) => frame > clip.startFrame && frame < clip.endFrame)
  if (!over) return frame
  return frame - over.startFrame <= over.endFrame - frame ? over.startFrame : over.endFrame
}
