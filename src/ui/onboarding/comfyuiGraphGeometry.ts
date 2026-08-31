// 只读节点图的**像素几何**（纯函数，可单测）：把 buildWorkflowGraphView 给的 column/row
// 翻成绝对坐标 + 贝塞尔路径 + 「适应」的缩放。
// plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
//
// 不引图库（P1）：仓库零图库依赖（package.json 实查无 xyflow/React Flow/D3/dagre/cytoscape），
// 生成画布本身就是 CSS transform + 绝对定位 div + SVG 连线层自研的。手法照搬既有的
// src/workbench/generationCanvas/components/CanvasEdgeLayer.tsx：起点在源节点右缘中点、
// 落点在目标节点左缘中点、控制点取水平距离的 0.45 且钳在 [64,140]（钳位是为了近距离不打结、
// 远距离不甩成大弧）。
import type { GraphView, GraphViewNode } from './comfyuiWorkflowGraphView'

/** 节点卡尺寸与间距。卡里要塞下 角色 / 标题 / classType #id 三行，故 62 高。 */
export const NODE_WIDTH = 176
export const NODE_HEIGHT = 62
const COLUMN_GAP = 76
const ROW_GAP = 14
/** 内容四周留白：贴边的卡在「适应」后会顶到画布边缘，看着像被裁了。 */
const PADDING = 20

export type PositionedNode = GraphViewNode & { x: number; y: number }
export type PositionedEdge = { key: string; from: string; to: string; path: string; endX: number; endY: number }
export type GraphGeometry = {
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  /** 内容尺寸（含四周留白）——外层据此定被 transform 的那层的宽高。 */
  width: number
  height: number
}

function nodeX(column: number): number {
  return PADDING + column * (NODE_WIDTH + COLUMN_GAP)
}

function nodeY(row: number): number {
  return PADDING + row * (NODE_HEIGHT + ROW_GAP)
}

/**
 * 列内**垂直居中**：短列（比如只有一个成品节点的最后一列）顶在最上边时，
 * 连线会从图中间斜甩到左上角，人一眼找不到主干。居中后主链大致走一条水平带。
 */
function centeredRowOffset(node: GraphViewNode, rowsInColumn: number, maxRows: number): number {
  return ((maxRows - rowsInColumn) * (NODE_HEIGHT + ROW_GAP)) / 2 + node.row * (NODE_HEIGHT + ROW_GAP)
}

export function buildGraphGeometry(view: GraphView): GraphGeometry {
  const rowsPerColumn = new Map<number, number>()
  for (const node of view.nodes) {
    rowsPerColumn.set(node.column, Math.max(rowsPerColumn.get(node.column) ?? 0, node.row + 1))
  }
  const maxRows = Math.max(1, ...rowsPerColumn.values())

  const nodes: PositionedNode[] = view.nodes.map((node) => ({
    ...node,
    x: nodeX(node.column),
    y: PADDING + centeredRowOffset(node, rowsPerColumn.get(node.column) ?? 1, maxRows),
  }))
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))

  const edges: PositionedEdge[] = []
  for (const edge of view.edges) {
    const source = byId.get(edge.from)
    const target = byId.get(edge.to)
    if (!source || !target) continue
    const startX = source.x + NODE_WIDTH
    const startY = source.y + NODE_HEIGHT / 2
    const endX = target.x
    const endY = target.y + NODE_HEIGHT / 2
    const control = Math.max(64, Math.min(140, Math.abs(endX - startX) * 0.45))
    edges.push({
      key: `${edge.from}->${edge.to}`,
      from: edge.from,
      to: edge.to,
      path: `M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`,
      endX,
      endY,
    })
  }

  const columnCount = Math.max(1, view.columnCount)
  return {
    nodes,
    edges,
    width: nodeX(columnCount - 1) + NODE_WIDTH + PADDING,
    height: PADDING * 2 + maxRows * (NODE_HEIGHT + ROW_GAP) - ROW_GAP,
  }
}

/** 缩放上下限：低于 0.3 字就糊成灰条（不如去看完整节点列表），高于 2 没意义。 */
export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 2

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * 「适应」：整张图塞进视口的缩放。**不放大**（上限 1）——小图被拉到 2 倍会糊，
 * 且「适应」的语义是「让我看全」，不是「让我看大」。
 */
export function fitZoom(content: { width: number; height: number }, viewport: { width: number; height: number }): number {
  if (content.width <= 0 || content.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1
  return clampZoom(Math.min(1, viewport.width / content.width, viewport.height / content.height))
}

/** 「适应」后的居中位移（图比视口小时居中，比视口大时贴左上角、靠拖看剩下的）。 */
export function fitOffset(
  content: { width: number; height: number },
  viewport: { width: number; height: number },
  zoom: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, (viewport.width - content.width * zoom) / 2),
    y: Math.max(0, (viewport.height - content.height * zoom) / 2),
  }
}
