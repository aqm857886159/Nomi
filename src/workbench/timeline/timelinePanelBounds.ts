/**
 * 时间轴面板的高度界（纯换算，与 zustand 无关）。
 *
 * 单独成文件的理由同 `assistantWidthBounds.ts`：这几个数是派生量，而 `workbenchStore.ts`
 * 一直贴着 800 行的巨壳门岗（R9/R12），把可以独立的换算继续堆在里面只会先撞门岗。
 */

/** 面板上下内边距（TimelinePanel compact 档的 pt-3 + pb-4）。 */
const TIMELINE_PANEL_PADDING_Y = 12 + 16
/** 工具条头部行：上下各 pt-2/pb-2，中间是 ControlGroup（1px 边框 + py-1 + --workbench-control-size 32px）。 */
const TIMELINE_TOOLBAR_ROW = 8 + (1 + 4 + 32 + 4 + 1) + 8

/**
 * 下限 = 「只剩头部工具条行」。2026-09-10 真机反馈「时间轴无法向下缩」：旧下限 140 里
 * 硬塞着一条轨道的高度，用户把把手拖到底也退不出画布空间。工具条改成参与布局的头部行后，
 * 这个数就能由「头部行 + 面板内边距」派生，而不是拍一个 140（轨道区拿 0 高、自身可滚）。
 */
export const TIMELINE_PANEL_MIN = TIMELINE_PANEL_PADDING_Y + TIMELINE_TOOLBAR_ROW
export const TIMELINE_PANEL_MAX = 300

/** 标尺行：`TimelinePanel.tsx` 的 `.workbench-timeline__ruler` = `h-[22px] mb-1.5`。 */
const TIMELINE_RULER_ROW = 22 + 6
/** 一条主轨行：`TimelineTrack.tsx` 的 primary 档 = `min-h-[52px] mb-1.5`。 */
const TIMELINE_PRIMARY_TRACK_ROW = 52 + 6
/**
 * 展开态默认要看得见几条主轨。
 *
 * 2 = 图片轨 + 视频轨，也就是 `TIMELINE_TRACK_DEFINITIONS`（timelineTypes.ts:93）里
 * 非 audio 的那两条——2026-09-13 用户原话：「核心是拖动后面可以预览，主要有两个轨道
 * 一个图片一个视频可以预览就行」。配乐/字幕是副轨，空时本来就收成窄条，不占默认高度。
 */
const TIMELINE_DEFAULT_PRIMARY_TRACKS = 2

/**
 * 展开态默认高度 = 「刚好装下两条主轨」，**派生**而不是拍一个数。
 *
 * 旧值 188 抄的是 cutover 前那个固定的 `--workbench-timeline-height`，装不下两条主轨
 * （28 + 58 + 28 + 58 = 172 只够一条，第二条被轨道区滚动裁掉）。用户于是必须先把面板
 * 拖高才看得到视频轨，拖过头就成了他说的「拉上来太大了」——「太大」和「看不到第二条轨」
 * 是同一个数拍错了的两面。改成派生之后，默认既不多占一像素，也不少给一条轨。
 *
 * 默认折叠态（`timelinePanelCollapsed=true`）下 gridTemplateRows 走 0px、stage 拿满高，
 * 本值不参与；只有展开时间轴后此值决定 stage 底边。可拖拽特性不变，用户仍可拉高/降低。
 */
export const TIMELINE_PANEL_DEFAULT =
  TIMELINE_PANEL_PADDING_Y
  + TIMELINE_TOOLBAR_ROW
  + TIMELINE_RULER_ROW
  + TIMELINE_DEFAULT_PRIMARY_TRACKS * TIMELINE_PRIMARY_TRACK_ROW

export function clampTimelinePanelHeight(value: number): number {
  if (!Number.isFinite(value)) return TIMELINE_PANEL_DEFAULT
  return Math.max(TIMELINE_PANEL_MIN, Math.min(TIMELINE_PANEL_MAX, Math.round(value)))
}
