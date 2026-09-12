import { readFileSync } from 'node:fs'
import { PanOnScrollMode, SelectionMode } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM } from '../model/canvasFitBounds'
import { canvasWheelGestureProps } from './canvasViewportGestureProps'

const viewportPath = 'src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx'
const viewport = () => readFileSync(viewportPath, 'utf8')

describe('生成画布内核开关（迁移回填①）', () => {
  it('滚轮语义跟着「画布手势」设置走，两档各自只留一个解释', () => {
    // 两档的真相源只有 resolveWheelIntent 那张真值表；这里只把它翻译成 React Flow 的两颗开关。
    // 「⌘/Ctrl + 滚轮」「捏合」两档恒缩放由内核自己兜（@xyflow/system 的
    // isPanOnScroll = panOnScroll && !zoomActivationKeyPressed），所以这里不必也不该再判一次。
    expect(canvasWheelGestureProps('wheel-zoom')).toEqual({
      zoomOnScroll: true,
      panOnScroll: false,
      panOnScrollMode: PanOnScrollMode.Free,
      panOnScrollSpeed: 1,
    })
    expect(canvasWheelGestureProps('modifier-zoom')).toEqual({
      zoomOnScroll: false,
      panOnScroll: true,
      panOnScrollMode: PanOnScrollMode.Free,
      panOnScrollSpeed: 1,
    })
  })

  it('平移档是自由方向、1:1 跟手（旧内核就是 offset − delta）', () => {
    const pan = canvasWheelGestureProps('modifier-zoom')
    // Free 而不是单轴：触控板的斜向滑动被折成一根轴，会立刻被当成「画布卡住了」。
    expect(pan.panOnScrollMode).toBe(PanOnScrollMode.Free)
    // React Flow 默认 0.5 = 同样的两指滑动只走一半路程，和旧画布并排一试就不跟手。
    expect(pan.panOnScrollSpeed).toBe(1)
  })

  it('画布把这两颗开关真的接到内核上，并且由设置订阅式驱动', () => {
    const source = viewport()
    expect(source).toContain("import { useCanvasGestureScheme } from '../../../utils/canvasGesturePreference'")
    expect(source).toContain('canvasWheelGestureProps(useCanvasGestureScheme())')
    expect(source).toContain('zoomOnScroll={wheelGestures.zoomOnScroll}')
    expect(source).toContain('panOnScroll={wheelGestures.panOnScroll}')
    expect(source).toContain('panOnScrollMode={wheelGestures.panOnScrollMode}')
    expect(source).toContain('panOnScrollSpeed={wheelGestures.panOnScrollSpeed}')
  })

  it('框选是「扫到即选」，不是「必须整张落进框」', () => {
    // 2026-06-14 §B2 拍板的 AABB 相交语义。React Flow 的默认是 Full（装机版
    // node_modules/@xyflow/react/dist/esm/index.js:3745 `selectionMode = SelectionMode.Full`）。
    expect(SelectionMode.Partial).toBe('partial')
    expect(viewport()).toContain('selectionMode={SelectionMode.Partial}')
  })

  it('双击空白不缩放：旧画布压根没有这个手势', () => {
    // React Flow 的默认是 true（同一行的 `zoomOnDoubleClick = true`），误触就放大一档。
    expect(viewport()).toContain('zoomOnDoubleClick={false}')
  })

  it('缩放上下限仍是画布自己的 0.2 / 3，不让内核默认值站着', () => {
    expect(CANVAS_MIN_ZOOM).toBe(0.2)
    expect(CANVAS_MAX_ZOOM).toBe(3)
    const source = viewport()
    expect(source).toContain('minZoom={CANVAS_MIN_ZOOM}')
    expect(source).toContain('maxZoom={CANVAS_MAX_ZOOM}')
  })
})
