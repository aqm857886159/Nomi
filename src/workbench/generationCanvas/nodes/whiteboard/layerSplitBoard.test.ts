// 图层分离 → 白板的摆法（设计卡 docs/plan/2026-11-26-layer-split.md ★9 第 3、7 条）。
// 反例：把排序删掉 → 「按叠放序从下到上」红；把框的缩放删掉 → 「框按画布比例缩」红；预建「图层 1」→ 「不预建」红；
// 整幅透明图也缩进框 → 「两种都落对位置」红。
import { describe, expect, it } from 'vitest'
import { buildLayerSplitBoard, layerSplitBaseIndex, layerSplitBoardDimensions, layerSplitCompositePixelRatio } from './layerSplitBoard'

let seq = 0
const createId = (prefix: string) => `${prefix}-${++seq}`
const board = () => buildLayerSplitBoard({
  baseSize: { width: 2560, height: 1440 },
  baseName: '底图',
  fallbackName: (n) => `图层 ${n}`,
  createId,
  pieces: [
    { url: 'nomi-local://base.png', layer: { zIndex: 0, name: '背景' } },
    { url: 'nomi-local://title.png', layer: { zIndex: 2, text: '夏日限定', box: { left: 100, top: 40, right: 1100, bottom: 240 } } },
    { url: 'nomi-local://cup.png', layer: { zIndex: 1, name: '杯子', box: { left: 1280, top: 720, right: 1920, bottom: 1440 } } },
    { url: 'nomi-local://blob.png', layer: { zIndex: 3, box: { left: 0, top: 0, right: 10, bottom: 10 } } },
  ],
})

describe('buildLayerSplitBoard', () => {
  it('画布按底图原比例、长边 1280；底图铺满，名字是「底图」（不用供应商给底图起的名）', () => {
    const state = board()
    expect(state.canvasDimensions).toEqual({ width: 1280, height: 720 })
    expect(state.activeRatio).toBe('16:9')
    expect(state.canvasAssets[0]).toMatchObject({ name: '底图', url: 'nomi-local://base.png', x: 0, y: 0, width: 1280, height: 720, source: 'generated' })
  })

  it('各层按叠放序从下到上；名字取 name → 识别出的字 → 「图层 n」', () => {
    const state = board()
    expect(state.layers.map((layer) => layer.name)).toEqual(['背景', '底图', '杯子', '夏日限定', '图层 3'])
    expect(state.canvasAssets.map((asset) => asset.url)).toEqual(['nomi-local://base.png', 'nomi-local://cup.png', 'nomi-local://title.png', 'nomi-local://blob.png'])
    expect(state.activeLayerId).toBe(state.layers.at(-1)!.id)
  })

  it('框按画布比例缩（底图像素 → 画布像素），每层自己的图缩进框里', () => {
    const cup = board().canvasAssets.find((asset) => asset.url.endsWith('cup.png'))!
    expect(cup).toMatchObject({ x: 640, y: 360, width: 320, height: 360 })
  })

  it('回来的形状说明没写死：和底图一样大的整幅透明图铺满、不缩进框；裁好的小图缩进框（两种都落对位置）', () => {
    const shaped = (size: { width: number; height: number } | null) => buildLayerSplitBoard({
      baseSize: { width: 2560, height: 1440 },
      baseName: '底图',
      fallbackName: (n) => `图层 ${n}`,
      createId,
      pieces: [
        { url: 'nomi-local://base.png', layer: { zIndex: 0 }, size: { width: 2560, height: 1440 } },
        { url: 'nomi-local://cup.png', layer: { zIndex: 1, name: '杯子', box: { left: 1280, top: 720, right: 1920, bottom: 1440 } }, size },
      ],
    }).canvasAssets[1]
    expect(shaped({ width: 2560, height: 1440 })).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 })
    expect(shaped({ width: 640, height: 720 })).toMatchObject({ x: 640, y: 360, width: 320, height: 360 })
    expect(shaped(null)).toMatchObject({ x: 640, y: 360, width: 320, height: 360 })
  })

  it('不预建空的「图层 1」：只有背景（锁住、在最底）+ 底图 + 各层', () => {
    const state = board()
    expect(state.layers.some((layer) => layer.id === 'drawing-layer-1')).toBe(false)
    expect(state.layers[0]).toMatchObject({ kind: 'background', locked: true })
    expect(state.layers.slice(1).every((layer) => layer.kind === 'asset' && !layer.locked)).toBe(true)
    expect(state.strokes).toEqual([])
  })
})

describe('底图与合成清晰度', () => {
  it('底图是第一张没有框的；都有框取第一张', () => {
    expect(layerSplitBaseIndex([{ zIndex: 1, box: { left: 0, top: 0, right: 1, bottom: 1 } }, { zIndex: 0 }])).toBe(1)
    expect(layerSplitBaseIndex([{ zIndex: 0, box: { left: 0, top: 0, right: 1, bottom: 1 } }])).toBe(0)
  })

  it('竖图长边也是 1280', () => {
    expect(layerSplitBoardDimensions({ width: 1080, height: 1920 })).toEqual({ width: 720, height: 1280 })
  })

  it('合成图保住底图清晰度（2K 不缩成 1280），受总像素预算约束，底图比画布小时按 1', () => {
    expect(layerSplitCompositePixelRatio({ width: 1280, height: 720 }, { width: 2560, height: 1440 })).toBe(2)
    expect(layerSplitCompositePixelRatio({ width: 1280, height: 1280 }, { width: 8000, height: 8000 })).toBeCloseTo(Math.sqrt(16_000_000 / (1280 * 1280)), 9)
    expect(layerSplitCompositePixelRatio({ width: 1280, height: 720 }, { width: 640, height: 360 })).toBe(1)
  })
})
