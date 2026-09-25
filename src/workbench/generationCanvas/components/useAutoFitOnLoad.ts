import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getCanvasNodeVisualSize } from './generationCanvasGeometry'

type Viewport = { zoom: number; offset: { x: number; y: number } }

/**
 * 当前视口是否框住了至少一个节点。历史视口若停在空白处（所有节点都在视口外），盲目恢复它会让用户以为
 * 「图全没了」——其实只是被平移挡住。
 */
export function anyNodeVisibleInViewport(
  nodes: GenerationCanvasNode[],
  zoom: number,
  offset: { x: number; y: number },
  rectWidth: number,
  rectHeight: number,
): boolean {
  const z = zoom || 1
  return nodes.some((n) => {
    const { width: w, height: h } = getCanvasNodeVisualSize(n)
    const left = n.position.x * z + offset.x
    const top = n.position.y * z + offset.y
    const right = (n.position.x + w) * z + offset.x
    const bottom = (n.position.y + h) * z + offset.y
    return right > 0 && left < rectWidth && bottom > 0 && top < rectHeight
  })
}

/**
 * 打开一个分类那一刻，要不要一次性摆好全貌。
 *
 * 2026-09-25 用户拍板（样张第 4 题）：保留，但**只在打开那一刻**、只在打开时里面**本来就有东西**时判一次：
 * 没有记住的视角，或记住的视角里一个节点都看不见 → 摆全貌（不带动画，那就是第一帧）；否则保留用户的视角。
 * 打开时是空的 → 不摆：之后长出来的节点（Agent 建卡、导入、付费卡落地）是「新到的」，
 * 由画布边缘提示指路，**不许**再借「第一次出现节点」触发一次适应——那正是「画布自己动」的一扇门。
 */
export function shouldFitOnOpen(input: { nodeCountAtOpen: number; hasRememberedViewport: boolean; anyNodeVisible: boolean }): boolean {
  if (input.nodeCountAtOpen === 0) return false
  return !input.hasRememberedViewport || !input.anyNodeVisible
}

/**
 * 每个分类「被打开」只判一次：项目加载完成（store ready）那一刻判当前分类；之后用户切到别的分类，那一刻再判那个。
 * 判定读的是打开那一刻的节点与视口（ref），不随之后的节点变化重跑。
 */
export function useAutoFitOnLoad(params: {
  ready: boolean
  nodes: GenerationCanvasNode[]
  activeCategoryId: string
  categoryViewports: Record<string, Viewport | undefined>
  fitView: () => void
  stageRef: React.RefObject<HTMLDivElement | null>
  zoomRef: React.MutableRefObject<number>
  offsetRef: React.MutableRefObject<{ x: number; y: number }>
}): void {
  const { ready, nodes, activeCategoryId, categoryViewports, fitView, stageRef, zoomRef, offsetRef } = params
  const latest = React.useRef({ nodes, categoryViewports, fitView })
  latest.current = { nodes, categoryViewports, fitView }
  React.useEffect(() => {
    if (!ready) return undefined
    const nodeCountAtOpen = latest.current.nodes.length
    if (nodeCountAtOpen === 0) return undefined
    const tid = setTimeout(() => {
      const rect = stageRef.current?.getBoundingClientRect()
      // 量不到舞台尺寸时保守：不动用户视口。
      if (!rect || rect.width <= 0 || rect.height <= 0) return
      const { nodes: openNodes, categoryViewports: viewports, fitView: fit } = latest.current
      if (shouldFitOnOpen({
        nodeCountAtOpen,
        hasRememberedViewport: Boolean(viewports[activeCategoryId]),
        anyNodeVisible: anyNodeVisibleInViewport(openNodes, zoomRef.current, offsetRef.current, rect.width, rect.height),
      })) fit()
    }, 350) // 等 DOM 完成一帧渲染
    return () => clearTimeout(tid)
  }, [ready, activeCategoryId, stageRef, zoomRef, offsetRef])
}
