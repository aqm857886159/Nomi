// 节点标签行和样片行从宿主读取可见性；浮框从节点外壳读取下方样片行占用的高度。
import React from 'react'

// 列表详情等画布外的宿主没有视口，两行默认可见。
export const NodeOutsideRowsHidden = React.createContext(false)

export function useNodeOutsideRowsHidden(): boolean {
  return React.useContext(NodeOutsideRowsHidden)
}

/**
 * 节点下方那一行（样片行）此刻占的画布高度（含缝）：节点外壳量出来放进这里，画布宿主的浮框据此接在它下面。
 * 只有一个来源（NodeSampleRow 的 onSpace），对焦那边读同一行的 DOM（selectionComposerViewport.belowRowSpace）。
 */
export const NodeBelowRowSpace = React.createContext(0)
