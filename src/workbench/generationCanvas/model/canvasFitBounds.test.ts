import { describe, expect, it } from 'vitest'
import { unionCanvasFitBounds } from './canvasFitBounds'
import { FRAME_CONTENT_PADDING, FRAME_LABEL_HEIGHT, frameBoundsFromMembers } from './canvasFrameBounds'

describe('canvas fit bounds', () => {
  it('把框的标签带一起算进「适应视图」要框住的那块地方', () => {
    // 一个成员 + 包着它的框：框的上沿比成员高「留白 24 + 标签带 28」，名字就写在那条带上。
    const member = { x: 400, y: 300, width: 320, height: 180 }
    const frame = frameBoundsFromMembers([member])!
    const nodesOnly = unionCanvasFitBounds([{ x: member.x, y: member.y, width: member.width, height: member.height }])!
    const withFrame = unionCanvasFitBounds([
      { x: member.x, y: member.y, width: member.width, height: member.height },
      { x: frame.x, y: frame.y, width: frame.w, height: frame.h },
    ])!
    // 阳性对照：只按节点算的那一版，上沿正好把标签带留在外面（这就是被切掉的那 52px）。
    expect(nodesOnly.y - withFrame.y).toBe(FRAME_CONTENT_PADDING + FRAME_LABEL_HEIGHT)
    expect(withFrame.y).toBe(frame.y)
    expect(withFrame.height).toBeGreaterThan(nodesOnly.height)
  })

  it('框比成员大得多时，fit 按框算——大空框挤小视图是用户自己画的那一下', () => {
    const bounds = unionCanvasFitBounds([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: -600, y: -400, width: 2000, height: 1500 },
    ])
    expect(bounds).toEqual({ x: -600, y: -400, width: 2000, height: 1500 })
  })

  it('零尺寸 / 非有限 / 空数组都返回 null，调用方据此什么都不做', () => {
    expect(unionCanvasFitBounds([])).toBeNull()
    expect(unionCanvasFitBounds([null, undefined])).toBeNull()
    expect(unionCanvasFitBounds([{ x: 0, y: 0, width: 0, height: 0 }])).toBeNull()
    expect(unionCanvasFitBounds([{ x: Number.NaN, y: 0, width: 10, height: 10 }])).toBeNull()
    // 一块能用、一块不能用时，只按能用的那块算（不要被 NaN 污染成 NaN 视口）。
    expect(unionCanvasFitBounds([{ x: Number.NaN, y: 0, width: 10, height: 10 }, { x: 5, y: 6, width: 7, height: 8 }]))
      .toEqual({ x: 5, y: 6, width: 7, height: 8 })
  })
})
