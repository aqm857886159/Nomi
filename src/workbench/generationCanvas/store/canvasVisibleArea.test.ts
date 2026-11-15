import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../../workbenchStore'
import { composerFocusFootprint } from '../nodes/composerCanvasPlacement'
import { CANVAS_FOCUS_PADDING } from '../reactFlow/focusViewportRecovery'
import { placeBlockInVisibleArea, publishCanvasStageSize, visibleCanvasRect, visibleInsertionPoint } from './canvasVisibleArea'
import { getGenerationNodeFootprintSize } from '../model/generationNodeKinds'

const stageSize = { width: 1000, height: 600 }
const stage = { stage: stageSize, free: { left: 0, top: 0, width: 1000, height: 600 } }

describe('canvasVisibleArea', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({ categoryViewports: { shots: { zoom: 0.5, offset: { x: -200, y: -100 } } } })
  })

  it('reads the visible canvas rect from the remembered viewport and the published stage', () => {
    expect(visibleCanvasRect('shots', stage)).toEqual({ x: 400, y: 200, width: 2000, height: 1200 })
  })

  it('reported case: an import with no explicit position lands inside what the user sees', () => {
    const point = visibleInsertionPoint('shots', undefined, stage)!
    const rect = visibleCanvasRect('shots', stage)!
    expect(point.x).toBeGreaterThan(rect.x)
    expect(point.x).toBeLessThan(rect.x + rect.width)
    expect(point.y).toBeGreaterThan(rect.y)
    expect(point.y).toBeLessThan(rect.y + rect.height)
  })

  it('no stage ever measured → no visible area (callers keep their own layout)', () => {
    expect(visibleCanvasRect('shots', { stage: { width: 0, height: 0 }, free: { left: 0, top: 0, width: 0, height: 0 } })).toBeNull()
  })

  it('a zero-size measurement (canvas hidden) never overwrites the last real stage', () => {
    publishCanvasStageSize(stageSize, stage.free)
    publishCanvasStageSize({ width: 0, height: 0 }, { left: 0, top: 0, width: 0, height: 0 })
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

  describe('new node lands together with its composer inside the free area', () => {
    // 1440×960 默认窗口：舞台 876 高，底部加节点条占掉最下面 56，空地 820 高。1280×800：舞台 716，空地 660。1100×720：舞台 636，空地 580。
    const view = (width: number, stageHeight: number, freeHeight: number) => ({
      stage: { width, height: stageHeight },
      free: { left: 0, top: 0, width, height: freeHeight },
    })
    const roomy = view(1440, 876, 820)
    const short = view(1280, 716, 660)
    const shortest = view(1100, 636, 580)
    const block = (kind: string) => {
      const composer = composerFocusFootprint(kind)
      return getGenerationNodeFootprintSize(kind as never).height + (composer ? composer.gap + composer.height : 0)
    }
    beforeEach(() => {
      useWorkbenchStore.setState({ categoryViewports: {} })
    })

    it('default window, kinds without a composer: lands exactly where the proportional point always was (x 38% / y 28% of the stage)', () => {
      for (const kind of ['asset', 'whiteboard', 'panorama']) {
        expect(visibleInsertionPoint('shots', kind, roomy)).toEqual({ x: 1440 * 0.38, y: 876 * 0.28 })
      }
      // 没给 kind（素材导入、截图这类还没有种类的入口）也一样
      expect(visibleInsertionPoint('shots', undefined, roomy)).toEqual({ x: 1440 * 0.38, y: 876 * 0.28 })
    })

    it('default window, kinds with a composer: x unchanged, y only goes up until node + gap + worst-case composer ends one margin above the free area bottom', () => {
      for (const kind of ['image', 'video', 'text']) {
        const point = visibleInsertionPoint('shots', kind, roomy)!
        expect(point.x).toBe(1440 * 0.38)
        expect(point.y).toBeLessThanOrEqual(876 * 0.28)
        const expected = Math.min(876 * 0.28, 820 - CANVAS_FOCUS_PADDING - block(kind))
        expect(point.y).toBe(Math.max(CANVAS_FOCUS_PADDING, expected))
        if (block(kind) <= 820 - CANVAS_FOCUS_PADDING * 2) expect(point.y + block(kind)).toBeLessThanOrEqual(820 - CANVAS_FOCUS_PADDING + 1e-9)
      }
    })

    it('default window numbers: image lifts to 46 (stage y 86), text stays at 245.28, video no longer fits and sits flush at the margin', () => {
      expect(visibleInsertionPoint('shots', 'image', roomy)!.y).toBe(820 - CANVAS_FOCUS_PADDING - (280 + 64 + 14 + 400))
      expect(visibleInsertionPoint('shots', 'text', roomy)!.y).toBe(876 * 0.28)
      expect(visibleInsertionPoint('shots', 'video', roomy)!.y).toBe(CANVAS_FOCUS_PADDING)
    })

    it('block taller than the free area (short windows): node top sits one margin below the free area top, same margin as focus', () => {
      for (const v of [short, shortest]) {
        for (const kind of ['image', 'video']) {
          expect(visibleInsertionPoint('shots', kind, v)!.y).toBe(CANVAS_FOCUS_PADDING)
        }
      }
    })

    it('the free area, not the whole stage, bounds the landing point: moving the free top down moves the node down with it', () => {
      const lowered = { stage: short.stage, free: { left: 0, top: 100, width: 1280, height: 560 } }
      expect(visibleInsertionPoint('shots', 'image', lowered)!.y).toBe(100 + CANVAS_FOCUS_PADDING)
    })

    it('zoomed in to 200%: no crash, the block is measured in canvas units (composer stays screen-sized), viewport untouched by the call', () => {
      const viewports = { shots: { zoom: 2, offset: { x: -400, y: -200 } } }
      useWorkbenchStore.setState({ categoryViewports: viewports })
      const point = visibleInsertionPoint('shots', 'image', roomy)!
      const area = visibleCanvasRect('shots', roomy)!
      expect(point.y).toBeGreaterThanOrEqual(area.y + CANVAS_FOCUS_PADDING / 2 - 1e-9)
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
      expect(useWorkbenchStore.getState().categoryViewports).toEqual(viewports)
    })

    it('agent block placement is bounded by the free area: never lands under the bottom docks', () => {
      const small = [{ x: 0, y: 5000, width: 200, height: 112 }]
      const placed = placeBlockInVisibleArea('shots', small, [], short)[0]
      const area = visibleCanvasRect('shots', short)!
      expect(placed.y + 112).toBeLessThanOrEqual(area.y + area.height)
      expect(area.height).toBe(660)
    })
  })
})
