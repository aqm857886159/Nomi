import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getNodeSize } from './generationCanvasGeometry'

type Viewport = { zoom: number; offset: { x: number; y: number } }

/**
 * 当前视口是否框住了至少一个节点。用于「自愈式适应」：历史视口若停在空白处
 * （所有节点都在视口外），盲目恢复它会让用户以为「图全没了」——其实只是被平移挡住。
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
    const { width: w, height: h } = getNodeSize(n)
    const left = n.position.x * z + offset.x
    const top = n.position.y * z + offset.y
    const right = (n.position.x + w) * z + offset.x
    const bottom = (n.position.y + h) * z + offset.y
    return right > 0 && left < rectWidth && bottom > 0 && top < rectHeight
  })
}

/**
 * 项目/分类首次加载时自动适应视图，让用户看到全局布局。
 * - 无历史视口 → 直接适应。
 * - 有历史视口但它框不住任何节点（图都在视口外、用户会误以为「图消失」）→ 自愈式适应。
 * - 正常的历史视口 → 保留用户位置，不打扰。
 * 每次 activeCategoryId 变化后重置，确保切换分类时也能触发。
 */
export function useAutoFitOnLoad(params: {
  nodes: GenerationCanvasNode[]
  activeCategoryId: string
  categoryViewports: Record<string, Viewport | undefined>
  fitView: () => void
  stageRef: React.RefObject<HTMLDivElement | null>
  zoomRef: React.MutableRefObject<number>
  offsetRef: React.MutableRefObject<{ x: number; y: number }>
}): void {
  const { nodes, activeCategoryId, categoryViewports, fitView, stageRef, zoomRef, offsetRef } = params
  const autoFitDoneRef = React.useRef(false)
  React.useEffect(() => { autoFitDoneRef.current = false }, [activeCategoryId])
  React.useEffect(() => {
    if (autoFitDoneRef.current || nodes.length === 0) return
    autoFitDoneRef.current = true
    const tid = setTimeout(() => {
      const rect = stageRef.current?.getBoundingClientRect()
      const shows = rect
        ? anyNodeVisibleInViewport(nodes, zoomRef.current, offsetRef.current, rect.width, rect.height)
        : true // 量不到尺寸时保守：不打扰用户视口
      if (!categoryViewports[activeCategoryId] || !shows) fitView()
    }, 350) // 等 DOM 完成一帧渲染
    return () => clearTimeout(tid)
  }, [nodes, categoryViewports, activeCategoryId, fitView, stageRef, zoomRef, offsetRef])
}
