// 收起坞落在画面下沿时要让开的那段空当。**纯换算**，单独一个文件：
// 它是一条位置不变量，得能被单测钉住，而 `AgentPanelV4Dock.tsx` 只导出组件
// （多导出一个函数会让 Fast Refresh 失效，lint 也会点名）。

/** 预览播放器走带条的挂点。坞只在**自己的宿主里**找它——别的面那条不是它的邻居。 */
export const TRANSPORT_BAR_SELECTOR = '.workbench-preview-player__control-bar'

/**
 * 从两个已量到的矩形算空当，并把结果钳在 `[0, 宿主高度]` 里。
 *
 * 2026-09-06 真机验收撞到的就是这条不变量破了：在创作面收起面板，composer 跑到了画面
 * **上方** `y = -98`，整条对话不见了——与定稿「收起藏的是对话流，不是对话」完全相反。
 * 机制是：预览面即使没在前台也还挂在 DOM 里，它那条走带条 `display:none`、矩形全 0，
 * 于是 `host.bottom - bar.top` = `854 - 0` = 854，`bottom: 854px` 把坞顶出了视口。
 *
 * 原设计担心的是死选择器让空当恒为 0（composer 压住播放键）；真出事的是反方向——量到一个
 * **比宿主还大**的数。所以判据不能只是「查得到条」，而要是「这条真的在排版里」（有高度），
 * 再加一道钳位：无论量到什么，坞都不可能被顶出宿主。
 */
export function transportClearanceFrom(
  host: Readonly<{ bottom: number; height: number }>,
  bar: Readonly<{ top: number; height: number }> | null,
): number {
  if (!bar || bar.height <= 0) return 0
  return Math.min(Math.max(0, host.bottom - bar.top), Math.max(0, host.height))
}
