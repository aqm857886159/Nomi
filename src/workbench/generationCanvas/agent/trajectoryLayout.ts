import { getGenerationNodeFootprintSize } from '../model/generationNodeKinds'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'

/**
 * 轨迹分层布局（T4 + 审计 A3/A5② 根治：步距从节点**渲染足迹**derive，不再 hardcode）。
 *
 * 旧实现列宽 420/行距 320、网格 360/260 全是常数，而节点尺寸随 kind 变化
 * （video 420×340 > 行距 320）——「步距 < 节点尺寸 → 重叠」是数学必然。本版所有间距由
 * `getGenerationNodeFootprintSize`（名义尺寸 + NODE_RENDER_SAFETY）推导：足迹已含「渲染>名义」
 * 的安全余量，**它本身就是间距**（不再外加 GAP），与单插避让(resolveInsertionPosition)共用同一
 * 余量——批量布局不会比单插更松、不漏网（审计 A5② 续：旧版 GAP=48 < 单插 64，渲染漂移落
 * 48~64 区间时只在批量路径重叠）。
 * - 分层形态：列宽 = 该列最大节点足迹宽，列 x 逐列累加；列内 y 按每个节点自身足迹高累加。
 * - 网格回退：格子 = 批内最大节点足迹尺寸。
 * 层由 kind 纯函数推导：character/scene → 参考列；image → 关键帧列；video → 视频列。
 * 凑不齐 ≥2 个不同层或混入不可推导 kind → 整批退网格。
 * 两种形态的原点都取已有节点包围盒下方空区——新计划永远不压旧内容。
 */

const ORIGIN_X = 160
const ORIGIN_Y = 160
const CLEARANCE_Y = 80
const FALLBACK_SIZE = { width: 340, height: 280 }
// 分镜网格每排镜头数（用户拍板 2026-06-15：镜头多时换行折成网格，参考卡顶部一排）。
const STORYBOARD_SHOTS_PER_ROW = 4

type ExistingNodeLite = { kind: GenerationNodeKind; position?: { x: number; y: number } }

// 间距/避让一律用「渲染足迹」（名义 + NODE_RENDER_SAFETY），足迹自带安全余量即是间距。
function sizeForKind(kind: GenerationNodeKind): { width: number; height: number } {
  return getGenerationNodeFootprintSize(kind)
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
    cellWidth = cellWidth || FALLBACK_SIZE.width
    cellHeight = cellHeight || FALLBACK_SIZE.height
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
    x += columnWidth.get(layer) ?? FALLBACK_SIZE.width
  }

  // 列内 y：按每个节点自身足迹高累加（足迹含安全余量即是行距）。
  const columnY = new Map<number, number>()
  return plannedKinds.map((kind, index) => {
    const layer = layers[index] as number
    const y = columnY.get(layer) ?? origin.y
    columnY.set(layer, y + sizeForKind(kind).height)
    return { x: columnX.get(layer) ?? origin.x, y }
  })
}

/**
 * 分镜方案专用布局（用户拍板 2026-06-15）：
 * - 参考卡（角色/场景/道具，前 `anchorCount` 个）→ 顶部一排横向排开（参考行）。
 * - 镜头（其余节点）→ 参考行下方，按阅读序左→右、每排 `STORYBOARD_SHOTS_PER_ROW` 个折行成网格。
 *
 * 为什么不用 layoutPlannedNodes：它按 kind 分列、列内竖排，分镜的镜头全是 image →
 * 全挤进一列竖排，参考卡在另一列、连线横跨拉扯（用户反馈「线很乱、都是竖排」的根因）。
 * 镜头是顺序叙事（胶片条直觉），横向折行网格才贴合。
 *
 * 角色判定靠 `anchorCount`（调用方 storyboardPlanToCreateNodesArgs 按「锚先 push、镜头后 push」
 * 的构造序给出），而非 kind——道具锚 kind 也是 image，与镜头 image 无法靠 kind 区分。
 * 原点仍走 `trajectoryOrigin`，保留「新计划落在已有节点下方、不压旧内容」的避让。
 * 间距一律用足迹（含 NODE_RENDER_SAFETY 余量即是间距），与 layoutPlannedNodes 同口径。
 */
export function layoutStoryboardNodes(
  plannedKinds: readonly GenerationNodeKind[],
  anchorCount: number,
  existing: readonly ExistingNodeLite[],
): Array<{ x: number; y: number }> {
  const origin = trajectoryOrigin(existing)
  const anchors = Math.max(0, Math.min(anchorCount, plannedKinds.length))
  const positions: Array<{ x: number; y: number }> = []

  // 参考行：顶部一排，逐个按自身足迹宽累加；行底 = 参考卡中最高的足迹。
  let anchorX = origin.x
  let anchorMaxHeight = 0
  for (let i = 0; i < anchors; i += 1) {
    const size = sizeForKind(plannedKinds[i])
    positions.push({ x: anchorX, y: origin.y })
    anchorX += size.width
    anchorMaxHeight = Math.max(anchorMaxHeight, size.height)
  }

  // 镜头网格：参考行下方（空一档 CLEARANCE_Y 分隔参考区/镜头区）。格子 = 镜头中最大足迹，列对齐。
  const shotTop = anchors > 0 ? origin.y + anchorMaxHeight + CLEARANCE_Y : origin.y
  let cellWidth = 0
  let cellHeight = 0
  for (let i = anchors; i < plannedKinds.length; i += 1) {
    const size = sizeForKind(plannedKinds[i])
    cellWidth = Math.max(cellWidth, size.width)
    cellHeight = Math.max(cellHeight, size.height)
  }
  cellWidth = cellWidth || FALLBACK_SIZE.width
  cellHeight = cellHeight || FALLBACK_SIZE.height
  const shotCount = plannedKinds.length - anchors
  const perRow = Math.max(1, Math.min(STORYBOARD_SHOTS_PER_ROW, shotCount || 1))
  for (let j = 0; j < shotCount; j += 1) {
    const row = Math.floor(j / perRow)
    const col = j % perRow
    positions.push({ x: origin.x + col * cellWidth, y: shotTop + row * cellHeight })
  }
  return positions
}
