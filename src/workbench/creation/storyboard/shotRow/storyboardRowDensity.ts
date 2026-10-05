import React from 'react'

/**
 * 行的宽 / 窄两档（第二轮版面）。判据只有行自己的实测宽度：
 * 宽 900（1440 视口 + Agent 面板）是宽档；最小窗口 1100×690 + Agent 面板时表格只有 664 宽，是窄档。
 * 窄档里视觉列整只缩到 176/240、参考缩略图从 36 缩到 28 并折成「+N」——省下的宽度给内容列，
 * 保证底栏「模型 · 参数汇总 · 生成」一行放得下（英文也放得下）。
 *
 * 740 = 两侧内边距 24 + 行首 14 + 两个列间距 24 + 横版预览 240 + 底栏一行的最小宽 ≈ 440（英文实测）。
 */
export const STORYBOARD_ROW_NARROW_BELOW = 740

export function storyboardRowIsNarrow(rowWidth: number | null): boolean {
  return rowWidth !== null && rowWidth < STORYBOARD_ROW_NARROW_BELOW
}

export const StoryboardRowNarrowContext = React.createContext(false)

export function useStoryboardRowNarrow(): boolean {
  return React.useContext(StoryboardRowNarrowContext)
}
