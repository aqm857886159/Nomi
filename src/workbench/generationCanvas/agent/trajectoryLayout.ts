import { DEFAULT_NODE_SIZE } from '../model/generationNodeKinds'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'

/**
 * 轨迹分层布局（T4 + 审计 A3 根治：步距从节点真实尺寸 derive，不再 hardcode）。
 *
 * 旧实现列宽 420/行距 320、网格 360/260 全是常数，而节点尺寸随 kind 变化
 * （video 420×340 > 行距 320）——「步距 < 节点尺寸 → 重叠」是数学必然，与避让
 * 逻辑无关。本版所有间距由 DEFAULT_NODE_SIZE 推导：
 * - 分层形态：列宽 = 该列最大节点宽 + GAP，列 x 逐列累加；列内 y 按每个节点
 *   自身高度 + GAP 累加（不用统一行距）。
 * - 网格回退：格子 = 批内最大节点尺寸 + GAP。
 * 层由 kind 纯函数推导：character/scene → 参考列；image → 关键帧列；video →
 * 视频列。凑不齐 ≥2 个不同层或混入不可推导 kind → 整批退网格。
 * 两种形态的原点都取已有节点包围盒下方空区——新计划永远不压旧内容。
 */

const ORIGIN_X = 160
const ORIGIN_Y = 160
const GAP_X = 48
const GAP_Y = 48
const CLEARANCE_Y = 80
const FALLBACK_SIZE = { width: 340, height: 280 }

type ExistingNodeLite = { kind: GenerationNodeKind; position?: { x: number; y: number } }

function sizeForKind(kind: GenerationNodeKind): { width: number; height: number } {
  return DEFAULT_NODE_SIZE[kind] ?? FALLBACK_SIZE
}

function layerForKind(kind: GenerationNodeKind): number | null {
  if (kind === 'character' || kind === 'scene') return 0
  if (kind === 'image') return 1
  if (kind === 'video') return 2
  return null
}

/** 原点：无已有节点用固定原点；有则落到全体包围盒下方（含节点默认高度 + 间距）。 */
export function trajectoryOrigin(existing: readonly ExistingNodeLite[]): { x: number; y: number } {
  let maxBottom = -Infinity
  for (const node of existing) {
    if (!node.position) continue
    const height = sizeForKind(node.kind).height
    maxBottom = Math.max(maxBottom, node.position.y + height)
  }
  if (!Number.isFinite(maxBottom)) return { x: ORIGIN_X, y: ORIGIN_Y }
  return { x: ORIGIN_X, y: Math.max(ORIGIN_Y, maxBottom + CLEARANCE_Y) }
}

/**
 * 为一批计划节点算坐标。返回数组与入参等长、同序。
 * 分层形态：列 = 层（仅对本批出现的层分配列位），层内按出现顺序竖排；
 * 网格形态：列数 = ceil(sqrt(n))，格子尺寸由批内最大节点 derive。
 */
export function layoutPlannedNodes(
  plannedKinds: readonly GenerationNodeKind[],
  existing: readonly ExistingNodeLite[],
): Array<{ x: number; y: number }> {
  const origin = trajectoryOrigin(existing)
  const layers = plannedKinds.map(layerForKind)
  const distinctLayers = new Set(layers.filter((layer) => layer !== null))
  const layered = !layers.includes(null) && distinctLayers.size >= 2

  if (!layered) {
    let cellWidth = 0
    let cellHeight = 0
    for (const kind of plannedKinds) {
      const size = sizeForKind(kind)
      cellWidth = Math.max(cellWidth, size.width)
      cellHeight = Math.max(cellHeight, size.height)
    }
    cellWidth = (cellWidth || FALLBACK_SIZE.width) + GAP_X
    cellHeight = (cellHeight || FALLBACK_SIZE.height) + GAP_Y
    const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, plannedKinds.length))))
    return plannedKinds.map((_, index) => ({
      x: origin.x + (index % cols) * cellWidth,
      y: origin.y + Math.floor(index / cols) * cellHeight,
    }))
  }

  // 列 x：仅对本批出现的层分配列位，列宽 = 该列最大节点宽 + GAP，逐列累加。
  const presentLayers = Array.from(distinctLayers).sort((a, b) => (a as number) - (b as number)) as number[]
  const columnWidth = new Map<number, number>()
  plannedKinds.forEach((kind, index) => {
    const layer = layers[index] as number
    columnWidth.set(layer, Math.max(columnWidth.get(layer) ?? 0, sizeForKind(kind).width))
  })
  const columnX = new Map<number, number>()
  let x = origin.x
  for (const layer of presentLayers) {
    columnX.set(layer, x)
    x += (columnWidth.get(layer) ?? FALLBACK_SIZE.width) + GAP_X
  }

  // 列内 y：按每个节点自身高度 + GAP 累加。
  const columnY = new Map<number, number>()
  return plannedKinds.map((kind, index) => {
    const layer = layers[index] as number
    const y = columnY.get(layer) ?? origin.y
    columnY.set(layer, y + sizeForKind(kind).height + GAP_Y)
    return { x: columnX.get(layer) ?? origin.x, y }
  })
}
