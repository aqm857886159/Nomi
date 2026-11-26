// 节点框外那几行（上方标签行 NodeLabelRow、下方样片行 NodeSampleRow）共用的两条规矩：缩小到多少一起藏、下方那一行占多高。
import React from 'react'
import { useWorkbenchStore } from '../../workbenchStore'

/** 画布缩到这以下，节点上方的标签行和下方的样片行一起藏起（只是藏，位置照留）。 */
const NODE_ROWS_MIN_ZOOM = 0.4

/** 节点外那几行此刻藏不藏：同一条缩放规矩一个家。只在跨过门槛时重渲。 */
export function useNodeOutsideRowsHidden(): boolean {
  return useWorkbenchStore((state) => (state.categoryViewports[state.activeCategoryId]?.zoom ?? 1) < NODE_ROWS_MIN_ZOOM)
}

/**
 * 节点下方那一行（样片行）此刻占的画布高度（含缝）：节点外壳量出来放进这里，画布宿主的浮框据此接在它下面。
 * 只有一个来源（NodeSampleRow 的 onSpace），对焦那边读同一行的 DOM（selectionComposerViewport.belowRowSpace）。
 */
export const NodeBelowRowSpace = React.createContext(0)
