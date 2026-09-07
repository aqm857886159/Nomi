import { describe, expect, it } from 'vitest'
import { expandSelectionBoundsToOwningFrame, resolveSelectionToolbarPlacement } from './selectionToolbarPlacement'

describe('selection toolbar screen placement', () => {
  it('keeps a canvas-space selection toolbar at a fixed screen position after zoom', () => {
    const result = resolveSelectionToolbarPlacement(
      { minX: 200, minY: 180, width: 400, height: 240 },
      { x: -100, y: -80, zoom: 1.5 },
      { width: 1440, height: 900 },
    )

    expect(result).toMatchObject({ placement: 'above', maxWidth: 760 })
    expect(result.transform).toBe('translate3d(500px, 174px, 0) translate(-50%, -100%)')
  })

  it('moves below a top-edge selection and clamps inside a narrow viewport', () => {
    const result = resolveSelectionToolbarPlacement(
      { minX: -200, minY: 0, width: 120, height: 100 },
      { x: 0, y: 0, zoom: 1 },
      { width: 390, height: 420 },
    )

    expect(result).toMatchObject({ placement: 'below', maxWidth: 374, x: 195, y: 116 })
  })
})

describe('selection bounds expanded to the owning frame', () => {
  const bounds = { minX: 200, minY: 180, width: 400, height: 240 }

  it('lifts the top edge to the frame so the toolbar clears the frame label band', () => {
    // 框上沿比成员外接盒高 52（留白 24 + 标签带 28）——名字/计数就写在这条带上。
    const expanded = expandSelectionBoundsToOwningFrame(
      bounds,
      [{ top: 128, nodeIds: ['a', 'b'] }],
      ['a', 'b'],
    )
    expect(expanded).toEqual({ minX: 200, minY: 128, width: 400, height: 292 })
    // 下沿不能动：只往上让，往下让会白白把浮条推远。
    expect(expanded.minY + expanded.height).toBe(bounds.minY + bounds.height)
  })

  it('leaves a selection that is not entirely inside one frame alone', () => {
    // 半框半散 / 跨框：没有一个「你选中的那个框」可以让开，原样返回。
    expect(expandSelectionBoundsToOwningFrame(bounds, [{ top: 128, nodeIds: ['a'] }], ['a', 'b'])).toEqual(bounds)
    expect(expandSelectionBoundsToOwningFrame(bounds, [], ['a'])).toEqual(bounds)
    expect(expandSelectionBoundsToOwningFrame(bounds, [{ top: 128, nodeIds: ['a'] }], [])).toEqual(bounds)
  })

  it('does not push the toolbar further away when the frame top is not above the selection', () => {
    // 框上沿不比成员高（空框被拖到成员下方这种边角）就别动——扩了只会让浮条无谓地飘远。
    expect(expandSelectionBoundsToOwningFrame(bounds, [{ top: 999, nodeIds: ['a'] }], ['a'])).toEqual(bounds)
  })

  it('actually changes where the toolbar lands', () => {
    // 证明这层扩展不是空话：同一批选中，扩之前和扩之后的浮条落点不同。
    const viewport = { x: 0, y: 0, zoom: 1 }
    const stage = { width: 1440, height: 900 }
    const before = resolveSelectionToolbarPlacement(bounds, viewport, stage)
    const after = resolveSelectionToolbarPlacement(
      expandSelectionBoundsToOwningFrame(bounds, [{ top: 128, nodeIds: ['a'] }], ['a']),
      viewport,
      stage,
    )
    expect(after.y).toBe(before.y - 52)
  })
})
