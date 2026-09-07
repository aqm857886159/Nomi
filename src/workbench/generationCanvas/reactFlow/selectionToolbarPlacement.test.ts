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

describe('selection toolbar vs the bottom dock', () => {
  // 真机实拍 10-frame-moved.png 那一屏的复刻：一个几乎占满这一屏的框被整个选中，
  // 浮条被排到选区下方，正好压在底部居中的「时间轴」胶囊上（「生成选中 3 个」被挡半截）。
  const stage = { width: 1540, height: 1010 }
  const viewport = { x: 0, y: 0, zoom: 1 }
  // 选区上方只剩 39px（塞不下 52px 高的浮条），下方看起来还有 78px——但那 78px 里
  // 有 48px 是底部停靠区的地盘。
  const bounds = { minX: 300, minY: 63, width: 900, height: 862 }
  // 底部居中的时间轴胶囊：离底 12px、高 30px（真机量到的量级）。
  const timelineCapsule = { left: 700, top: 968, right: 900, bottom: 998 }
  const TOOLBAR_HEIGHT = 52

  /** 浮条此刻占的那个矩形（`transform` 里 y 的语义随 placement 翻转，所以在这里算清楚）。 */
  function toolbarRect(placement: ReturnType<typeof resolveSelectionToolbarPlacement>) {
    const top = placement.placement === 'above' ? placement.y - TOOLBAR_HEIGHT : placement.y
    return {
      left: placement.x - placement.maxWidth / 2,
      right: placement.x + placement.maxWidth / 2,
      top,
      bottom: top + TOOLBAR_HEIGHT,
    }
  }

  function intersects(a: ReturnType<typeof toolbarRect>, b: typeof timelineCapsule) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  }

  it('阳性对照：不告诉它底部有东西，浮条就压在时间轴胶囊上', () => {
    // 这条是上一条的量具校准：避让关掉（不传 dock）必须红——否则下一条的绿说明不了任何事。
    const placed = resolveSelectionToolbarPlacement(bounds, viewport, stage)
    expect(placed.placement).toBe('below')
    expect(intersects(toolbarRect(placed), timelineCapsule)).toBe(true)
  })

  it('把底部停靠区告诉它，浮条就翻到选区上方，不再叠压', () => {
    const placed = resolveSelectionToolbarPlacement(bounds, viewport, stage, [timelineCapsule])
    expect(placed.placement).toBe('above')
    expect(intersects(toolbarRect(placed), timelineCapsule)).toBe(false)
  })

  it('横向压不上的那块不参与——左下角的缩略图不该把靠右的浮条往上顶', () => {
    // 选区靠右：浮条居中在 x=1100、宽 760，左沿 720；左下工具簇（含展开的缩略图）在 [16, 280]。
    // 两者横向差着 440px，不可能撞上——这块不该逼浮条改位置。
    const rightBounds = { minX: 950, minY: 63, width: 300, height: 862 }
    const leftDock = { left: 16, top: 800, right: 280, bottom: 998 }
    const withDock = resolveSelectionToolbarPlacement(rightBounds, viewport, stage, [leftDock])
    const withoutDock = resolveSelectionToolbarPlacement(rightBounds, viewport, stage)
    expect(leftDock.right).toBeLessThan(withDock.x - withDock.maxWidth / 2)
    expect(withDock).toEqual(withoutDock)
  })

  it('上下都塞不下时贴到视口内侧的上边，而不是叠在停靠区上', () => {
    const squashed = { width: 800, height: 200 }
    const fullBounds = { minX: 0, minY: 10, width: 700, height: 180 }
    const dock = { left: 0, top: 120, right: 800, bottom: 200 }
    const placed = resolveSelectionToolbarPlacement(fullBounds, viewport, squashed, [dock])
    expect(placed.placement).toBe('above')
    // clamp 的 min 大于 max 时返回 min：浮条贴在视口内侧上边（y 是下沿，8 + 52）。
    expect(placed.y).toBe(60)
    expect(toolbarRect(placed).top).toBe(8)
  })

  it('不在这一屏里的停靠区不参与（时间轴展开后胶囊被顶出去）', () => {
    const gone = { left: 700, top: 1100, right: 900, bottom: 1130 }
    expect(resolveSelectionToolbarPlacement(bounds, viewport, stage, [gone]))
      .toEqual(resolveSelectionToolbarPlacement(bounds, viewport, stage))
  })
})
