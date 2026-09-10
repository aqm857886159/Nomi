/**
 * 时间轴面板「收起 / 展开」的本机偏好。
 *
 * 为什么住 localStorage：这是**跟人不跟项目**的窗口习惯（和同一片区域里的迷你画面窗一样——
 * `TimelineMiniPreview.tsx:25` 早就用 `nomi.timelineMiniPreview.collapsed` 记同一类状态）。
 * 塞进项目档案会让「我在 A 项目收起了时间轴」跟着文件跑给协作者，那不是用户的意思。
 *
 * 2026-09-10 之前这个状态只活在内存里：用户在面板里收起，下次开 App 又是默认值。
 * 收起入口（工具条行尾那颗 chevron）落地的同一刻把它记住，否则「能收起」等于每次都要重收一遍。
 */
const KEY = 'nomi.timelinePanel.collapsed'

/** 默认收起：生成画布首屏把整块高度还给画布，加片段时 adoptionReceipt 会自动展开。 */
export const TIMELINE_PANEL_COLLAPSED_DEFAULT = true

export function readTimelinePanelCollapsed(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (raw === '1') return true
    if (raw === '0') return false
    return TIMELINE_PANEL_COLLAPSED_DEFAULT
  } catch {
    // 私有模式 / 存储被禁：退回默认值，不让偏好读失败变成崩溃。
    return TIMELINE_PANEL_COLLAPSED_DEFAULT
  }
}

export function writeTimelinePanelCollapsed(collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY, collapsed ? '1' : '0')
  } catch {
    /* 存不下就算了：本次会话内的 store 状态仍然正确 */
  }
}
