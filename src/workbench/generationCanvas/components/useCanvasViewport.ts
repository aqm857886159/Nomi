import React from 'react'
import { useWorkbenchStore } from '../../workbenchStore'
import { createInitialViewport, getNodeSize } from './generationCanvasGeometry'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 从 GenerationCanvas（顶死 800 行的 god-component）抽出的视口 + 虚拟化子系统：
// pan/zoom 状态、按分类记忆/恢复视口、stage 尺寸观测、视口 AABB 裁剪可见节点/边。
// 纯机械抽取——逻辑与抽取前逐字一致，只为给壳组件腾出 headroom（规则 9/12）。
//
// E8 P0 G1: viewport-aware virtualization。节点数超阈值时只渲染包围盒与可见视口
// （扩 VIRTUALIZATION_BUFFER_PX 边距）相交的节点；低于阈值渲染全部，小项目零额外开销。
const VIRTUALIZATION_THRESHOLD = 50
const VIRTUALIZATION_BUFFER_PX = 400

export function getVisibleCanvasNodesForRender(params: {
  nodes: GenerationCanvasNode[]
  zoom: number
  offset: { x: number; y: number }
  stageSize: { width: number; height: number }
}): GenerationCanvasNode[] {
  const { nodes, zoom, offset, stageSize } = params
  if (nodes.length <= VIRTUALIZATION_THRESHOLD) return nodes
  if (stageSize.width === 0 || stageSize.height === 0) return []
  const z = zoom || 1
  const viewLeft = -offset.x / z - VIRTUALIZATION_BUFFER_PX
  const viewTop = -offset.y / z - VIRTUALIZATION_BUFFER_PX
  const viewRight = viewLeft + stageSize.width / z + VIRTUALIZATION_BUFFER_PX * 2
  const viewBottom = viewTop + stageSize.height / z + VIRTUALIZATION_BUFFER_PX * 2
  return nodes.filter((node) => {
    const nx = node.position.x
    const ny = node.position.y
    const { width: nw, height: nh } = getNodeSize(node)
    return nx + nw >= viewLeft && nx <= viewRight && ny + nh >= viewTop && ny <= viewBottom
  })
}

export function useCanvasViewport(activeCategoryId: string, nodes: GenerationCanvasNode[]) {
  // Pan/zoom state
  const initialViewport = React.useMemo(() => createInitialViewport(), [])
  const rememberCategoryViewport = useWorkbenchStore((state) => state.rememberCategoryViewport)
  const categoryViewports = useWorkbenchStore((state) => state.categoryViewports)
  // Phase E3: each graph-canvas category preserves its own zoom + offset
  const seedViewport = React.useMemo(() => {
    const remembered = categoryViewports[activeCategoryId]
    return remembered || initialViewport
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategoryId])
  const [viewport, setViewport] = React.useState(() => ({
    zoom: seedViewport.zoom,
    offset: seedViewport.offset,
  }))
  const zoom = viewport.zoom
  const offset = viewport.offset
  const lastCategoryRef = React.useRef(activeCategoryId)
  React.useEffect(() => {
    if (lastCategoryRef.current === activeCategoryId) return
    rememberCategoryViewport(lastCategoryRef.current, { zoom, offset }) // save outgoing
    const next = categoryViewports[activeCategoryId] || initialViewport // load incoming
    setViewport({ zoom: next.zoom, offset: next.offset })
    lastCategoryRef.current = activeCategoryId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategoryId])
  const stageRef = React.useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  React.useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setStageSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const visibleNodesForRender = React.useMemo(() => {
    return getVisibleCanvasNodesForRender({ nodes, zoom, offset, stageSize })
  }, [nodes, zoom, offset, stageSize])
  // B3 边层视口裁剪：仅在虚拟化生效时给边层一个可见节点集，剔除两端都在视口外的边；
  // 未虚拟化（小图）传 null = 渲染全部边，行为与改动前逐字一致。
  const visibleEdgeNodeIds = React.useMemo(
    () => (nodes.length > VIRTUALIZATION_THRESHOLD ? new Set(visibleNodesForRender.map((node) => node.id)) : null),
    [nodes.length, visibleNodesForRender],
  )

  // Refs so drag-connection effect can read latest values without re-subscribing
  const offsetRef = React.useRef(offset)
  offsetRef.current = offset
  const zoomRef = React.useRef(zoom)
  zoomRef.current = zoom
  const stageSizeRef = React.useRef(stageSize)
  stageSizeRef.current = stageSize

  return {
    categoryViewports,
    setViewport,
    zoom,
    offset,
    stageRef,
    stageSize,
    visibleNodesForRender,
    visibleEdgeNodeIds,
    offsetRef,
    zoomRef,
    stageSizeRef,
  }
}
