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
// 188 = origin/main 的固定 --workbench-timeline-height。cutover 把时间轴改成可拖拽面板
// （timelinePanelHeight），展开态默认高度对齐 main 的 188（比 cutover 原来的 206 少 18px、多还画布
// stage 18px；可拖拽特性不变，用户仍可拉高/降低）。默认折叠态（timelinePanelCollapsed=true）下
// gridTemplateRows 走 0px、stage 拿满高，本值不参与；只有加片段展开时间轴后此值决定 stage 底边。
export const TIMELINE_PANEL_DEFAULT = 188

export function clampTimelinePanelHeight(value: number): number {
  if (!Number.isFinite(value)) return TIMELINE_PANEL_DEFAULT
  return Math.max(TIMELINE_PANEL_MIN, Math.min(TIMELINE_PANEL_MAX, Math.round(value)))
}
