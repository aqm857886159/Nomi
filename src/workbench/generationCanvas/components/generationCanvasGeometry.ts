// 画布纯几何 / 视口辅助函数——从 GenerationCanvas.tsx 抽出（规则 9/12：给巨壳减重）。
// 全是无副作用纯函数（不碰 React / store / DOM），可单测、可复用；行为与抽出前逐字一致。

import type { GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import { frameBoundsFromMembers, unionFrameBounds } from '../model/canvasFrameBounds'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import type { CanvasGroupBox } from './GroupFrame'

/** 画布屏幕几何的唯一尺寸入口；与 BaseGenerationNode 的实际外壳使用同一解析器。 */
export function getCanvasNodeVisualSize(node: GenerationCanvasNode): { width: number; height: number } {
  return resolveNodeVisualSize(node)
}

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

/**
 * 画布上要画出来的框。
 *
 * 2026-09-06 起框的边界是 `union(用户画的矩形, 成员外接矩形 + padding)`——**只长不缩**，
 * 几何算式住 `model/canvasFrameBounds.ts`（旧组回填与这里共用同一份，不许各算各的）。
 *
 * 与改动前的两处差别：
 *  · **空框照样出框**（以前 `if (!members.length) return []`）——用户画完一个空框总得看得见它；
 *    真的既没成员又没 frameBounds 时仍然不画，不凭空冒出幽灵框。
 *  · `empty` 标志随框返回，供 GroupFrame 决定画虚线还是实线（放进第一个东西才变实线）。
 */
export function getCanvasGroupBoxes(groups: readonly NodeGroup[], nodes: readonly GenerationCanvasNode[]): CanvasGroupBox[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  return groups.flatMap((group) => {
    const members = group.nodeIds.flatMap((nodeId) => {
      const node = nodeById.get(nodeId)
      return node && (node.categoryId || 'shots') === group.categoryId ? [node] : []
    })
    const contentBounds = frameBoundsFromMembers(members.map((node) => {
      const size = getCanvasNodeVisualSize(node)
      return { x: node.position.x, y: node.position.y, width: size.width, height: size.height }
    }))
    const bounds = unionFrameBounds(group.frameBounds, contentBounds)
    if (!bounds) return []
    return [{
      group,
      left: bounds.x,
      top: bounds.y,
      width: bounds.w,
      height: bounds.h,
      memberCount: members.length,
      empty: members.length === 0,
    }]
  })
}
