// 画布纯几何 / 视口辅助函数——从 GenerationCanvas.tsx 抽出（规则 9/12：给巨壳减重）。
// 全是无副作用纯函数（不碰 React / store / DOM），可单测、可复用；行为与抽出前逐字一致。

import type { GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import type { CanvasGroupBox } from './GroupFrame'

/** 画布屏幕几何的唯一尺寸入口；与 BaseGenerationNode 的实际外壳使用同一解析器。 */
export function getCanvasNodeVisualSize(node: GenerationCanvasNode): { width: number; height: number } {
  return resolveNodeVisualSize(node)
}

const GROUP_BOX_PADDING = 24
const GROUP_BOX_LABEL_HEIGHT = 28

export { getWheelZoomFactor, type WheelZoomEvent } from '../../../utils/wheelZoom'

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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
  height: number
} | null {
  const selected = new Set(selectedNodeIds)
  const selectedNodes = nodes.filter((node) => selected.has(node.id))
  if (!selectedNodes.length) return null
  const minX = Math.min(...selectedNodes.map((node) => node.position.x))
  const minY = Math.min(...selectedNodes.map((node) => node.position.y))
  const selectedNodeSizes = selectedNodes.map((node) => ({ node, size: getCanvasNodeVisualSize(node) }))
  const maxX = Math.max(...selectedNodeSizes.map(({ node, size }) => node.position.x + size.width))
  const maxY = Math.max(...selectedNodeSizes.map(({ node, size }) => node.position.y + size.height))
  return {
    minX,
    minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  }
}

export function centerNodeOffset(node: GenerationCanvasNode, stageSize: { width: number; height: number }, zoom: number): { x: number; y: number } {
  const size = getCanvasNodeVisualSize(node)
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
    const memberSizes = members.map((node) => ({ node, size: getCanvasNodeVisualSize(node) }))
    const maxX = Math.max(...memberSizes.map(({ node, size }) => node.position.x + size.width))
    const maxY = Math.max(...memberSizes.map(({ node, size }) => node.position.y + size.height))
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
