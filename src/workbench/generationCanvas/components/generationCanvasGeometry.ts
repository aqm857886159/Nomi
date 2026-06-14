// 画布纯几何 / 视口辅助函数——从 GenerationCanvas.tsx 抽出（规则 9/12：给巨壳减重）。
// 全是无副作用纯函数（不碰 React / store / DOM），可单测、可复用；行为与抽出前逐字一致。

import type { GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import { getNodeSize } from '../model/generationNodeKinds'
import type { CanvasGroupBox } from './GroupFrame'

// getNodeSize 的真相源在 model 层（generationNodeKinds），跨 store/components/fixation 共用。
// 这里重导出，让既有 components 调用方 import 路径不变（从 ./generationCanvasGeometry）。
export { getNodeSize }

const WHEEL_ZOOM_FACTOR = 1.24
const WHEEL_ZOOM_DELTA = 120
const WHEEL_LINE_HEIGHT = 16
const WHEEL_PAGE_HEIGHT = 800
const GROUP_BOX_PADDING = 24
const GROUP_BOX_LABEL_HEIGHT = 28

export type WheelZoomEvent = Pick<WheelEvent, 'deltaMode' | 'deltaY'>

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function getWheelZoomFactor(event: WheelZoomEvent): number {
  const deltaModeMultiplier = event.deltaMode === 1
    ? WHEEL_LINE_HEIGHT
    : event.deltaMode === 2
      ? WHEEL_PAGE_HEIGHT
      : 1
  const deltaPixels = clampNumber(event.deltaY * deltaModeMultiplier, -WHEEL_ZOOM_DELTA, WHEEL_ZOOM_DELTA)
  return Math.pow(WHEEL_ZOOM_FACTOR, -deltaPixels / WHEEL_ZOOM_DELTA)
}

export function createInitialViewport(): { zoom: number; offset: { x: number; y: number } } {
  if (typeof window !== 'undefined' && window.innerWidth < 700) {
    return {
      zoom: 0.86,
      offset: { x: -20, y: -220 },
    }
  }
  return {
    zoom: 1,
    offset: { x: 0, y: 0 },
  }
}

export function getSelectedBounds(nodes: readonly GenerationCanvasNode[], selectedNodeIds: readonly string[]): {
  minX: number
  minY: number
  width: number
} | null {
  const selected = new Set(selectedNodeIds)
  const selectedNodes = nodes.filter((node) => selected.has(node.id))
  if (!selectedNodes.length) return null
  const minX = Math.min(...selectedNodes.map((node) => node.position.x))
  const minY = Math.min(...selectedNodes.map((node) => node.position.y))
  const maxX = Math.max(...selectedNodes.map((node) => node.position.x + getNodeSize(node).width))
  return {
    minX,
    minY,
    width: Math.max(0, maxX - minX),
  }
}

export function centerNodeOffset(node: GenerationCanvasNode, stageSize: { width: number; height: number }, zoom: number): { x: number; y: number } {
  const size = getNodeSize(node)
  return {
    x: Math.round(stageSize.width / 2 - (node.position.x + size.width / 2) * zoom),
    y: Math.round(stageSize.height / 2 - (node.position.y + size.height / 2) * zoom),
  }
}

export function getCanvasGroupBoxes(groups: readonly NodeGroup[], nodes: readonly GenerationCanvasNode[]): CanvasGroupBox[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  return groups.flatMap((group) => {
    const members = group.nodeIds.flatMap((nodeId) => {
      const node = nodeById.get(nodeId)
      return node && (node.categoryId || 'shots') === group.categoryId ? [node] : []
    })
    if (!members.length) return []
    const minX = Math.min(...members.map((node) => node.position.x))
    const minY = Math.min(...members.map((node) => node.position.y))
    const maxX = Math.max(...members.map((node) => node.position.x + getNodeSize(node).width))
    const maxY = Math.max(...members.map((node) => node.position.y + getNodeSize(node).height))
    return [{
      group,
      left: minX - GROUP_BOX_PADDING,
      top: minY - GROUP_BOX_PADDING - GROUP_BOX_LABEL_HEIGHT,
      width: maxX - minX + GROUP_BOX_PADDING * 2,
      height: maxY - minY + GROUP_BOX_PADDING * 2 + GROUP_BOX_LABEL_HEIGHT,
      memberCount: members.length,
    }]
  })
}
