import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../../workbenchStore'
import { placeBlockInVisibleArea, publishCanvasStageSize, visibleCanvasRect, visibleInsertionPoint } from './canvasVisibleArea'

const stage = { width: 1000, height: 600 }

describe('canvasVisibleArea', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({ categoryViewports: { shots: { zoom: 0.5, offset: { x: -200, y: -100 } } } })
  })

  it('reads the visible canvas rect from the remembered viewport and the published stage', () => {
    expect(visibleCanvasRect('shots', stage)).toEqual({ x: 400, y: 200, width: 2000, height: 1200 })
  })

  it('reported case: an import with no explicit position lands inside what the user sees', () => {
    const point = visibleInsertionPoint('shots', stage)!
    const rect = visibleCanvasRect('shots', stage)!
    expect(point.x).toBeGreaterThan(rect.x)
    expect(point.x).toBeLessThan(rect.x + rect.width)
    expect(point.y).toBeGreaterThan(rect.y)
    expect(point.y).toBeLessThan(rect.y + rect.height)
  })

  it('no stage ever measured → no visible area (callers keep their own layout)', () => {
    expect(visibleCanvasRect('shots', { width: 0, height: 0 })).toBeNull()
  })

  it('a zero-size measurement (canvas hidden) never overwrites the last real stage', () => {
    publishCanvasStageSize(stage)
    publishCanvasStageSize({ width: 0, height: 0 })
    expect(visibleCanvasRect('shots')).toEqual({ x: 400, y: 200, width: 2000, height: 1200 })
  })

  describe('placeBlockInVisibleArea', () => {
    const block = [{ x: 160, y: 3000, width: 200, height: 112 }, { x: 420, y: 3000, width: 200, height: 112 }]

    it('moves a batch that landed below all content into view, keeping its internal layout', () => {
      const placed = placeBlockInVisibleArea('shots', block, [], stage)
      const rect = visibleCanvasRect('shots', stage)!
      expect(placed[1].x - placed[0].x).toBe(260)
      expect(placed[0].y).toBe(placed[1].y)
      for (const point of placed) {
        expect(point.x).toBeGreaterThanOrEqual(rect.x)
        expect(point.y).toBeGreaterThanOrEqual(rect.y)
      }
    })

    it('class: never overlaps existing nodes and never shrinks the batch — it stays put instead', () => {
      const rect = visibleCanvasRect('shots', stage)!
      const occupied = [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }]
      expect(placeBlockInVisibleArea('shots', block, occupied, stage)).toEqual(block.map(({ x, y }) => ({ x, y })))
      const huge = [{ x: 0, y: 0, width: 5000, height: 112 }]
      expect(placeBlockInVisibleArea('shots', huge, [], stage)).toEqual([{ x: 0, y: 0 }])
    })
  })
})
