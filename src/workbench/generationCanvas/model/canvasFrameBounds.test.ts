import { describe, expect, it } from 'vitest'
import {
  FRAME_CONTENT_PADDING,
  FRAME_DRAW_NOISE_THRESHOLD,
  FRAME_LABEL_HEIGHT,
  backfillGroupFrameBounds,
  drawPreviewRect,
  frameBoundsFromMembers,
  frameRectsOverlap,
  normalizeDrawnFrameBounds,
  unionFrameBounds,
  type CanvasFrameRect,
  type CanvasMemberRect,
} from './canvasFrameBounds'

function member(x: number, y: number, width = 200, height = 100): CanvasMemberRect {
  return { x, y, width, height }
}

describe('frameBoundsFromMembers — 成员外接矩形 + 留白 + 标签带', () => {
  it('留白与标签带的算式与 2026-09-06 之前画布内联的那份逐字一致', () => {
    // 旧组回填要复现「它当时本来就长的那个样子」，靠的就是这一条：算式一变，
    // 升级当天所有旧组会集体跳一下（而且没人看得出是谁干的）。
    expect(frameBoundsFromMembers([member(100, 200)])).toEqual({
      x: 100 - FRAME_CONTENT_PADDING,
      y: 200 - FRAME_CONTENT_PADDING - FRAME_LABEL_HEIGHT,
      w: 200 + FRAME_CONTENT_PADDING * 2,
      h: 100 + FRAME_CONTENT_PADDING * 2 + FRAME_LABEL_HEIGHT,
    })
  })

  it('多个成员取并集', () => {
    const bounds = frameBoundsFromMembers([member(0, 0, 100, 100), member(300, 400, 100, 100)])
    expect(bounds).toEqual({
      x: -FRAME_CONTENT_PADDING,
      y: -FRAME_CONTENT_PADDING - FRAME_LABEL_HEIGHT,
      w: 400 + FRAME_CONTENT_PADDING * 2,
      h: 500 + FRAME_CONTENT_PADDING * 2 + FRAME_LABEL_HEIGHT,
    })
  })

  it('没有成员就没有内容矩形（不硬造一个 0×0）', () => {
    expect(frameBoundsFromMembers([])).toBeNull()
  })
})

describe('unionFrameBounds — 只长不缩', () => {
  const drawn: CanvasFrameRect = { x: 0, y: 0, w: 600, h: 400 }

  it('成员都在框内时，框仍是用户画的那个大小（不缩到贴住内容）', () => {
    const content = frameBoundsFromMembers([member(200, 150, 100, 80)])
    expect(unionFrameBounds(drawn, content)).toEqual(drawn)
  })

  it('成员探出框外时框跟着长，且结果仍完整包含用户画的矩形', () => {
    const content = frameBoundsFromMembers([member(700, 150, 100, 80)])
    const box = unionFrameBounds(drawn, content)
    expect(box).not.toBeNull()
    expect(box!.x).toBeLessThanOrEqual(drawn.x)
    expect(box!.y).toBeLessThanOrEqual(drawn.y)
    expect(box!.x + box!.w).toBeGreaterThan(drawn.x + drawn.w)
    expect(box!.x + box!.w).toBeGreaterThanOrEqual(700 + 100 + FRAME_CONTENT_PADDING)
  })

  it('成员回到框内后框回到用户画的大小——不塌陷到比它更小', () => {
    // 「只长不缩」说的是**永不小于用户画的那个矩形**，不是「长过就再也回不去」。
    // 后者要藏一份隐式状态，而且用户没法把一个被撑大的框恢复原样。
    const grown = unionFrameBounds(drawn, frameBoundsFromMembers([member(700, 150)]))
    const back = unionFrameBounds(drawn, frameBoundsFromMembers([member(200, 150, 100, 80)]))
    expect(grown!.w).toBeGreaterThan(drawn.w)
    expect(back).toEqual(drawn)
  })

  it('空框（有画的矩形、零成员）照样有框', () => {
    expect(unionFrameBounds(drawn, null)).toEqual(drawn)
  })

  it('既没画过也没成员 → 不画（不冒出幽灵框）', () => {
    expect(unionFrameBounds(null, null)).toBeNull()
    expect(unionFrameBounds(undefined, undefined)).toBeNull()
  })

  it('非有限数的矩形当作没有，不把 NaN 传染给渲染', () => {
    expect(unionFrameBounds({ x: NaN, y: 0, w: 10, h: 10 }, drawn)).toEqual(drawn)
  })
})

describe('normalizeDrawnFrameBounds — 用户拖出来的两点', () => {
  const minContent = { width: 240, height: 120 }

  it('反向拖（右下往左上）得到同一个矩形', () => {
    const forward = normalizeDrawnFrameBounds({ x: 10, y: 20 }, { x: 610, y: 420 }, minContent)
    const backward = normalizeDrawnFrameBounds({ x: 610, y: 420 }, { x: 10, y: 20 }, minContent)
    expect(forward).toEqual(backward)
    expect(forward).toEqual({ x: 10, y: 20, w: 600, h: 400 })
  })

  it('短边小于误点阈值 → 不建框', () => {
    const noise = FRAME_DRAW_NOISE_THRESHOLD - 1
    expect(normalizeDrawnFrameBounds({ x: 0, y: 0 }, { x: 400, y: noise }, minContent)).toBeNull()
  })

  it('画得偏小但不是误点 → 补到「至少装得下一个最小节点」，下限由调用方给的节点尺寸派生', () => {
    const rect = normalizeDrawnFrameBounds({ x: 0, y: 0 }, { x: 60, y: 60 }, minContent)
    expect(rect).toEqual({
      x: 0,
      y: 0,
      w: minContent.width + FRAME_CONTENT_PADDING * 2,
      h: minContent.height + FRAME_CONTENT_PADDING * 2 + FRAME_LABEL_HEIGHT,
    })
  })

  it('起点即终点 → 不建框（单击不该留下一个框）', () => {
    expect(normalizeDrawnFrameBounds({ x: 100, y: 100 }, { x: 100, y: 100 }, minContent)).toBeNull()
  })
})

describe('drawPreviewRect / frameRectsOverlap', () => {
  it('预览矩形所见即手上的动作——不补下限也不判误点', () => {
    expect(drawPreviewRect({ x: 50, y: 80 }, { x: 20, y: 30 })).toEqual({ x: 20, y: 30, w: 30, h: 50 })
  })

  it('交叠判定用于「框里不能再画框」那条提示', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 }
    expect(frameRectsOverlap(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(true)
    expect(frameRectsOverlap(a, { x: 100, y: 0, w: 100, h: 100 })).toBe(false)
  })
})

describe('backfillGroupFrameBounds — 旧组原地升级', () => {
  const rects: Record<string, CanvasMemberRect> = {
    a: member(100, 100),
    b: member(400, 300),
  }
  const rectOf = (nodeId: string): CanvasMemberRect | null => rects[nodeId] ?? null

  it('没有 frameBounds 的组按成员包围盒补一次', () => {
    const [group] = backfillGroupFrameBounds<{ nodeIds: string[]; frameBounds?: CanvasFrameRect }>(
      [{ nodeIds: ['a', 'b'] }],
      rectOf,
    )
    expect(group.frameBounds).toEqual(frameBoundsFromMembers([rects.a, rects.b]))
  })

  it('幂等：跑两次结果相同，第二次连对象引用都不换', () => {
    // 它每次载入快照都会跑。不幂等的迁移会在每次开项目时改写一遍数据，
    // 顺带把 persistRevision 顶高、把「项目有改动」这件事变成噪音。
    const once = backfillGroupFrameBounds<{ nodeIds: string[]; frameBounds?: CanvasFrameRect }>(
      [{ nodeIds: ['a', 'b'] }],
      rectOf,
    )
    const twice = backfillGroupFrameBounds(once, rectOf)
    expect(twice).toEqual(once)
    expect(twice[0]).toBe(once[0])
  })

  it('已经有 frameBounds 的组不被覆盖——用户画的边界优先于成员包围盒', () => {
    const drawn: CanvasFrameRect = { x: -999, y: -999, w: 10, h: 10 }
    const [group] = backfillGroupFrameBounds([{ nodeIds: ['a', 'b'], frameBounds: drawn }], rectOf)
    expect(group.frameBounds).toEqual(drawn)
  })

  it('成员一个都取不到的组不硬造 bounds（凭空一个 0×0 的框比没有更糟）', () => {
    const [group] = backfillGroupFrameBounds<{ nodeIds: string[]; frameBounds?: CanvasFrameRect }>(
      [{ nodeIds: ['gone'] }],
      rectOf,
    )
    expect(group.frameBounds).toBeUndefined()
  })
})
