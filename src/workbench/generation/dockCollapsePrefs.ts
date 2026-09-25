/**
 * 生成面底部区域「收起 / 展开」的本机偏好 —— 唯一 owner。
 *
 * 管三样东西：时间轴面板、时间轴上的画面小窗、画布左下的小地图。它们是同一类状态：**跟人不跟项目**的窗口
 * 习惯（塞进项目档案会让「我在 A 项目收起了」跟着文件跑给协作者，那不是用户的意思），所以都落 localStorage，
 * 读写形状也完全一样：`'1'` = 收起、`'0'` = 用户明确展开过、没有值 = 用默认。以前三样各写一份：时间轴面板在
 * `timeline/timelinePanelPrefs.ts`、画面小窗在组件里就地读写、小地图压根不记（每次开都是展开）。
 *
 * 默认一律收起（2026-09-26 用户拍板：画面小窗与小地图默认收起，「不是默认是收起的吗？不是的话肯定是 B」）。
 * 起因：1280×800 且 Agent 面板开着时舞台只剩约 800×480，节点浮框定宽 560、钉在节点正下方、被挡就挡，
 * 生成钮 ↑ 常被右下画面小窗整颗盖住、模型钮被左下小地图压住。默认收起把那两块地还给画布；用户点开一次就记住，
 * 之后按他的选择来。
 */

export type BottomDock = 'timelinePanel' | 'timelineMiniPreview' | 'canvasMinimap'

/** 每样东西的存储键与默认值只写在这一处。键沿用各自已上线的那个，已经表过态的用户不会被重置。 */
const DOCKS = {
  // 生成画布首屏把整块高度还给画布，加片段时 adoptionReceipt 会自动展开时间轴。
  timelinePanel: { key: 'nomi.timelinePanel.collapsed', collapsedByDefault: true },
  timelineMiniPreview: { key: 'nomi.timelineMiniPreview.collapsed', collapsedByDefault: true },
  canvasMinimap: { key: 'nomi.canvasMinimap.collapsed', collapsedByDefault: true },
} as const satisfies Record<BottomDock, { key: string; collapsedByDefault: boolean }>

export function dockCollapsedByDefault(dock: BottomDock): boolean {
  return DOCKS[dock].collapsedByDefault
}

export function readDockCollapsed(dock: BottomDock): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(DOCKS[dock].key)
    if (raw === '1') return true
    if (raw === '0') return false
    return DOCKS[dock].collapsedByDefault
  } catch {
    // 私有模式 / 存储被禁：退回默认值，不让偏好读失败变成崩溃。
    return DOCKS[dock].collapsedByDefault
  }
}

export function writeDockCollapsed(dock: BottomDock, collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(DOCKS[dock].key, collapsed ? '1' : '0')
  } catch {
    /* 存不下就算了：本次会话内的状态仍然正确 */
  }
}
