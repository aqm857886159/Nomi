import type { GenerationCanvasNode } from './generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'

export type GroupArrangeMode = 'grid' | 'horizontal' | 'vertical'

type Point = { x: number; y: number }

const GAP = 32

/**
 * Arrange only the members of one group. The first member keeps the group's current
 * top-left anchor; callers can update the frame bounds in the same store transaction.
 * This is deliberately a pure model function so grid/horizontal/vertical cannot grow
 * a second layout implementation in the toolbar or store.
 */
export function arrangeGroupNodes(
  nodes: readonly GenerationCanvasNode[],
  mode: GroupArrangeMode,
): Map<string, Point> {
  const sorted = [...nodes].sort((left, right) => (
    (left.shotIndex ?? Number.MAX_SAFE_INTEGER) - (right.shotIndex ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id)
  ))
  if (!sorted.length) return new Map()

  const result = new Map<string, Point>()
  if (mode === 'horizontal') {
    let x = sorted[0].position.x
    const y = Math.min(...sorted.map((node) => node.position.y))
    for (const node of sorted) {
      result.set(node.id, { x, y })
      x += resolveNodeVisualSize(node).width + GAP
    }
    return result
  }
  if (mode === 'vertical') {
    const x = Math.min(...sorted.map((node) => node.position.x))
    let y = sorted[0].position.y
    for (const node of sorted) {
      result.set(node.id, { x, y })
      y += resolveNodeVisualSize(node).height + GAP
    }
    return result
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(sorted.length)))
  const columnWidths = Array.from({ length: columns }, () => 0)
  const rowHeights: number[] = []
  for (let index = 0; index < sorted.length; index += 1) {
    const row = Math.floor(index / columns)
    const column = index % columns
    const size = resolveNodeVisualSize(sorted[index])
    columnWidths[column] = Math.max(columnWidths[column], size.width)
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, size.height)
  }
  const originX = Math.min(...sorted.map((node) => node.position.x))
  const originY = Math.min(...sorted.map((node) => node.position.y))
  for (let index = 0; index < sorted.length; index += 1) {
    const row = Math.floor(index / columns)
    const column = index % columns
    const x = originX + columnWidths.slice(0, column).reduce((sum, width) => sum + width + GAP, 0)
    const y = originY + rowHeights.slice(0, row).reduce((sum, height) => sum + height + GAP, 0)
    result.set(sorted[index].id, { x, y })
  }
  return result
}
