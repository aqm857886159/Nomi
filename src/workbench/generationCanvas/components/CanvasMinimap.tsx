// 画布缩略导航图（C1，2026-06-14，按获批样张）。右下角小窗：所有节点按内容 bbox 等比缩放成
// 小矩形（选中=nomi-accent），叠一个当前视口取景框；点击/拖拽 → 把视口中心跳到对应画布点。
// 仅在节点数 >= MINIMAP_MIN_NODES 时出现（小图全可见，minimap 是噪声，密度优先 R2）。
import React from 'react'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getNodeSize } from './generationCanvasGeometry'

export const MINIMAP_MIN_NODES = 6
const MAP_W = 180
const MAP_H = 120
const MAP_PAD = 10

type CanvasMinimapProps = {
  nodes: GenerationCanvasNode[]
  selectedIds: Set<string>
  zoom: number
  offset: { x: number; y: number }
  stageSize: { width: number; height: number }
  /** 把视口中心跳到该画布坐标（即时，不走动画——拖拽要跟手）。 */
  onJumpToCanvasPoint: (point: { x: number; y: number }) => void
}

export const CanvasMinimap = React.memo(function CanvasMinimap({ nodes, selectedIds, zoom, offset, stageSize, onJumpToCanvasPoint }: CanvasMinimapProps): JSX.Element | null {
  const draggingRef = React.useRef(false)
  const innerRef = React.useRef<HTMLDivElement>(null)

  // P0-D 平移性能：节点 bbox 与 offset 无关，拆出按 [nodes] memo → 平移时不再每帧遍历全部节点。
  const nodeBbox = React.useMemo(() => {
    if (nodes.length < MINIMAP_MIN_NODES) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of nodes) {
      const size = getNodeSize(node)
      minX = Math.min(minX, node.position.x)
      minY = Math.min(minY, node.position.y)
      maxX = Math.max(maxX, node.position.x + size.width)
      maxY = Math.max(maxY, node.position.y + size.height)
    }
    return { minX, minY, maxX, maxY }
  }, [nodes])

  const geometry = React.useMemo(() => {
    if (!nodeBbox) return null
    let { minX, minY, maxX, maxY } = nodeBbox
    // 把当前视口也并入 bbox，保证取景框始终落在图内（即便平移到了节点外的空白）
    if (stageSize.width > 0 && zoom > 0) {
      minX = Math.min(minX, -offset.x / zoom)
      minY = Math.min(minY, -offset.y / zoom)
      maxX = Math.max(maxX, (-offset.x + stageSize.width) / zoom)
      maxY = Math.max(maxY, (-offset.y + stageSize.height) / zoom)
    }
    const contentW = Math.max(1, maxX - minX)
    const contentH = Math.max(1, maxY - minY)
    const scale = Math.min((MAP_W - MAP_PAD * 2) / contentW, (MAP_H - MAP_PAD * 2) / contentH)
    // 内容在 map 内居中的偏移
    const padX = (MAP_W - contentW * scale) / 2
    const padY = (MAP_H - contentH * scale) / 2
    return { minX, minY, scale, padX, padY }
  }, [nodeBbox, offset.x, offset.y, stageSize.width, stageSize.height, zoom])

  const jumpFromClient = React.useCallback((clientX: number, clientY: number) => {
    if (!geometry || !innerRef.current) return
    const rect = innerRef.current.getBoundingClientRect()
    const mx = clientX - rect.left
    const my = clientY - rect.top
    const canvasX = (mx - geometry.padX) / geometry.scale + geometry.minX
    const canvasY = (my - geometry.padY) / geometry.scale + geometry.minY
    onJumpToCanvasPoint({ x: canvasX, y: canvasY })
  }, [geometry, onJumpToCanvasPoint])

  if (!geometry) return null

  const toMap = (x: number, y: number) => ({
    left: (x - geometry.minX) * geometry.scale + geometry.padX,
    top: (y - geometry.minY) * geometry.scale + geometry.padY,
  })

  const viewLeftCanvas = -offset.x / (zoom || 1)
  const viewTopCanvas = -offset.y / (zoom || 1)
  const viewTL = toMap(viewLeftCanvas, viewTopCanvas)
  const viewW = (stageSize.width / (zoom || 1)) * geometry.scale
  const viewH = (stageSize.height / (zoom || 1)) * geometry.scale

  return (
    <div
      className={cn(
        'generation-canvas-v2__minimap',
        'absolute right-4 bottom-6 z-[8] overflow-hidden',
        'border border-nomi-line rounded-nomi bg-nomi-paper/95 shadow-nomi-md',
      )}
      style={{ width: MAP_W, height: MAP_H }}
      aria-label="画布缩略导航"
      onPointerDown={(event) => {
        event.stopPropagation()
        draggingRef.current = true
        jumpFromClient(event.clientX, event.clientY) // 先跳转，再尝试捕获（捕获失败不该吞掉跳转）
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 无活动指针时忽略 */ }
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) return
        jumpFromClient(event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        draggingRef.current = false
        if (typeof event.currentTarget.releasePointerCapture === 'function' && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
    >
      <div ref={innerRef} className="relative w-full h-full cursor-pointer">
        {nodes.map((node) => {
          const size = getNodeSize(node)
          const pos = toMap(node.position.x, node.position.y)
          return (
            <div
              key={node.id}
              className={cn(
                'absolute rounded-nomi-sm',
                // 纸色描边 = 相邻/重叠的小方块之间留一道缝，避免同色方块糊成一团（用户报「粘连」）。
                'ring-1 ring-nomi-paper',
                selectedIds.has(node.id) ? 'bg-nomi-accent' : 'bg-nomi-ink-30',
              )}
              style={{
                left: pos.left,
                top: pos.top,
                width: Math.max(3, size.width * geometry.scale),
                height: Math.max(3, size.height * geometry.scale),
              }}
            />
          )
        })}
        <div
          className="absolute border border-nomi-accent rounded-nomi-sm bg-nomi-accent-soft/30 pointer-events-none"
          style={{ left: viewTL.left, top: viewTL.top, width: Math.max(4, viewW), height: Math.max(4, viewH) }}
        />
      </div>
    </div>
  )
})
