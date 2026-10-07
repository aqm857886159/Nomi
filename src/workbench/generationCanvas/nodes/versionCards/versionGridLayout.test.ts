import { describe, expect, it } from 'vitest'
import {
  chooseVersionGridPlacement,
  isNodeLabelCoveredByGrid,
  layoutVersionGrid,
  VERSION_GRID_NODE_GAP,
  versionGridItems,
  versionGridShape,
} from './versionGridLayout'

const NODE = { width: 240, height: 135 }
const newestFirst = (count: number) => Array.from({ length: count }, (_, index) => count - index)

describe('version grid layout', () => {
  it('shapes the grid close to a square (user 10-06: 2→1×2, 3–4→2×2, 5–6→3×2, 7–9→3×3)', () => {
    expect([2, 3, 4, 5, 6, 7, 9, 12].map((count) => versionGridShape(count))).toEqual([
      { columns: 2, rows: 1 }, { columns: 2, rows: 2 }, { columns: 2, rows: 2 }, { columns: 3, rows: 2 },
      { columns: 3, rows: 2 }, { columns: 3, rows: 3 }, { columns: 3, rows: 3 }, { columns: 4, rows: 3 },
    ])
  })

  it('shows at most 9 cells: the newest 8 plus "+N" holding the oldest', () => {
    const items = versionGridItems(newestFirst(12))
    expect(items).toHaveLength(9)
    expect(items.slice(0, 8).map((item) => item.kind === 'version' && item.version)).toEqual([12, 11, 10, 9, 8, 7, 6, 5])
    expect(items[8]).toEqual({ kind: 'more', hidden: [4, 3, 2, 1] })
    expect(versionGridItems(newestFirst(12), { showAll: true })).toHaveLength(12)
    expect(versionGridItems(newestFirst(9)).every((item) => item.kind === 'version')).toBe(true)
  })

  it('puts the generating placeholder first, where the new version will land', () => {
    const items = versionGridItems(newestFirst(9), { pending: true })
    expect(items[0]).toEqual({ kind: 'pending' })
    expect(items).toHaveLength(9)
    expect(items[8].kind).toBe('more')
  })

  it('keeps the newest card next to the node on either side (left placement mirrors)', () => {
    const right = layoutVersionGrid(versionGridItems(newestFirst(4)), NODE, 'right')
    expect(right.cells[0]).toMatchObject({ x: NODE.width + VERSION_GRID_NODE_GAP, y: 0, column: 0, row: 0 })
    expect(right.cells[1].x).toBeGreaterThan(right.cells[0].x)
    const left = layoutVersionGrid(versionGridItems(newestFirst(4)), NODE, 'left')
    expect(left.cells[0]).toMatchObject({ x: -VERSION_GRID_NODE_GAP - NODE.width, y: 0 })
    expect(left.cells[1].x).toBeLessThan(left.cells[0].x)
    expect(left.bounds.x + left.bounds.width).toBe(-VERSION_GRID_NODE_GAP)
  })

  it('opens to the right when it fits, otherwise left, otherwise the roomier side', () => {
    expect(chooseVersionGridPlacement({ requiredWidth: 500, rightSpace: 600, leftSpace: 900 })).toBe('right')
    expect(chooseVersionGridPlacement({ requiredWidth: 500, rightSpace: 300, leftSpace: 600 })).toBe('left')
    expect(chooseVersionGridPlacement({ requiredWidth: 900, rightSpace: 300, leftSpace: 200 })).toBe('right')
  })

  it('hides a neighbour title only when the grid actually covers that neighbour', () => {
    const layout = layoutVersionGrid(versionGridItems(newestFirst(4)), NODE, 'right')
    const cells = layout.cells.map((cell) => ({ ...cell, ...NODE }))
    const origin = { x: 80, y: 120 }
    expect(isNodeLabelCoveredByGrid({ x: 440, y: 120, ...NODE }, origin, cells)).toBe(true)
    expect(isNodeLabelCoveredByGrid({ x: 1100, y: 120, ...NODE }, origin, cells)).toBe(false)
  })
})
