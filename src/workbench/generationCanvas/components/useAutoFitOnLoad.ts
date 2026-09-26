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

/** 等画布「量完」最多等多少帧（约 2 秒）：舞台量不到尺寸或 React Flow 还没收下节点就一直等，超时保守不动视口。 */
const MAX_WAIT_FRAMES = 120

/**
 * 每个分类「被打开」只判一次：项目加载完成（store ready）那一刻判当前分类；之后用户切到别的分类，那一刻再判那个。
 * 判定读的是打开那一刻的节点与视口（ref），不随之后的节点变化重跑。
 *
 * 2026-09-26 协调裁定 B：打开时适应一次 = 用户拍板保留；此前 main 上时序不稳，现改为节点量完后必定触发。
 * main 上是「节点出现后 350ms」盲等一次：那一刻舞台可能还量不到、React Flow 可能还没收下节点（外接盒为空），
 * 于是有的路径摆了、有的没摆。现在逐帧等到两件事都成立——舞台有尺寸、打开时的每个节点都已进 React Flow 的
 * nodeLookup（投影带 width/height，未挂载的节点也有外接盒）——再判一次，判完即停。
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
  hasFlowNode: (id: string) => boolean
}): void {
  const { ready, nodes, activeCategoryId, categoryViewports, fitView, stageRef, zoomRef, offsetRef, hasFlowNode } = params
  const latest = React.useRef({ nodes, categoryViewports, fitView, hasFlowNode })
  latest.current = { nodes, categoryViewports, fitView, hasFlowNode }
  React.useEffect(() => {
    if (!ready) return undefined
    const openNodes = latest.current.nodes
    if (openNodes.length === 0) return undefined
    let frame = 0
    let waited = 0
    const decide = () => {
      const rect = stageRef.current?.getBoundingClientRect()
      const measured = Boolean(rect && rect.width > 0 && rect.height > 0) && openNodes.every((node) => latest.current.hasFlowNode(node.id))
      if (!measured || !rect) {
        waited += 1
        if (waited < MAX_WAIT_FRAMES) frame = requestAnimationFrame(decide)
        return
      }
      const { categoryViewports: viewports, fitView: fit } = latest.current
      if (shouldFitOnOpen({
        nodeCountAtOpen: openNodes.length,
        hasRememberedViewport: Boolean(viewports[activeCategoryId]),
        anyNodeVisible: anyNodeVisibleInViewport(openNodes, zoomRef.current, offsetRef.current, rect.width, rect.height),
      })) fit()
    }
    frame = requestAnimationFrame(decide)
    return () => cancelAnimationFrame(frame)
  }, [ready, activeCategoryId, stageRef, zoomRef, offsetRef])
}
