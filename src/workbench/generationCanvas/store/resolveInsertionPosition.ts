import { DEFAULT_NODE_SIZE } from '../model/generationNodeKinds'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'

/**
 * 新建节点落点真碰撞避让（审计 A4 根治）。
 *
 * 旧实现（GenerationCanvas.getToolbarInsertionPosition）的「避让」是把已有节点原点
 * 四舍五入成 `"x,y"` 整数点塞进 Set，只在新点与某原点**像素级相同**时才判冲突——
 * 错开 1px、或两卡包围盒大面积重叠，都检测不到 → 几乎总返回中心 basePosition，
 * 手动建的节点恒压在中心已有节点上（真机复现：生成图片 / 添加 3D / 图片节点全中招）。
 *
 * 本版改用**真实 AABB 包围盒**判重叠：每个候选位置都拿「新节点尺寸」对全体已有节点
 * 的盒做相交测试，命中就按螺旋顺序换下一个候选，找到第一个不压任何已有节点的空位。
 * 步距 derive 自节点尺寸（不 hardcode），与 trajectoryLayout 的「间距从尺寸推导」一致。
 */

const FALLBACK_SIZE = { width: 340, height: 280 }
const GAP = 48
// 名义尺寸（registry.defaultSize）与真实渲染高度有差：如 image 名义 340×280，空态实际
// 渲染约 340 高。若按名义算步距，两卡会重叠 ≈(渲染-名义) px（真机实测 12px）。给碰撞足迹
// 统一外扩这个安全余量，让间距吸收「渲染比名义高」的增量 → 任何模型空态都不重叠。
const RENDER_SAFETY = 64

export type NodeBox = {
  kind: GenerationNodeKind
  position: { x: number; y: number }
  size?: { width: number; height: number }
}

type Size = { width: number; height: number }
type Point = { x: number; y: number }

/** 节点足迹 = 名义尺寸 + RENDER_SAFETY 外扩（吸收渲染比名义大的增量）。 */
function sizeFor(node: Pick<NodeBox, 'kind' | 'size'>): Size {
  const base = node.size ?? DEFAULT_NODE_SIZE[node.kind] ?? FALLBACK_SIZE
  return { width: base.width + RENDER_SAFETY, height: base.height + RENDER_SAFETY }
}

/** 两个轴对齐矩形是否相交。 */
function overlaps(aPos: Point, aSize: Size, bPos: Point, bSize: Size): boolean {
  return (
    aPos.x < bPos.x + bSize.width &&
    aPos.x + aSize.width > bPos.x &&
    aPos.y < bPos.y + bSize.height &&
    aPos.y + aSize.height > bPos.y
  )
}

function collidesAny(pos: Point, size: Size, existing: readonly NodeBox[]): boolean {
  return existing.some((node) => overlaps(pos, size, node.position, sizeFor(node)))
}

/**
 * 从 base 起，按螺旋顺序找第一个不与任何已有节点重叠的落点。
 * 螺旋环 r=0..maxRings，每环 8 个方向，步距 = 新节点尺寸 + GAP（保证一步就能跨过一张卡）。
 * 全部命中（极端密集）→ 返回最后一个候选（不再无限找，行为可预期）。
 */
export function resolveInsertionPosition(
  newKind: GenerationNodeKind,
  base: Point,
  existing: readonly NodeBox[],
  maxRings = 6,
): Point {
  const size = sizeFor({ kind: newKind })
  if (!collidesAny(base, size, existing)) return base

  const stepX = Math.round(size.width + GAP)
  const stepY = Math.round(size.height + GAP)
  // 8 个方向（先右/下，再四角/左/上），保证优先往右下铺、视觉自然。
  const dirs: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: -1, y: -1 },
  ]
  let last = base
  for (let ring = 1; ring <= maxRings; ring += 1) {
    for (const dir of dirs) {
      const candidate = {
        x: Math.round(base.x + dir.x * stepX * ring),
        y: Math.round(base.y + dir.y * stepY * ring),
      }
      last = candidate
      if (!collidesAny(candidate, size, existing)) return candidate
    }
  }
  return last
}
