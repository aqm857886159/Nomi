import { describe, expect, it } from 'vitest'
import { assessDeleteTarget, canDrawOnLayer, commitStrokeToState, deleteTargetFromState, LEGACY_DRAWING_LAYER_ID, mergeResultLibraryItems } from './whiteboardStateOps'
import { buildLayerSplitBoard } from './layerSplitBoard'
import type { CanvasStroke } from './whiteboardCanvasTypes'
import type { CanvasObjectTarget } from './WhiteboardLeaferCanvas'
import type { WhiteboardState } from './whiteboardTypes'
import type { CanvasAsset, LayerItem } from './lib/canvas'

const layer = (over: Partial<LayerItem> & { id: string }): LayerItem => ({
  name: over.id,
  visible: true,
  locked: false,
  opacity: 1,
  kind: 'asset',
  thumbnail: 'image',
  ...over,
})

const asset = (over: Partial<CanvasAsset> & { id: string; layerId: string }): CanvasAsset => ({
  name: over.id,
  url: 'data:image/png;base64,x',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  ...over,
})

const state = (): WhiteboardState => ({
  strokes: [],
  canvasAssets: [
    asset({ id: 'a-free', layerId: 'l-free' }),
    asset({ id: 'a-locked', layerId: 'l-locked' }),
    asset({ id: 'a-bg', layerId: 'background' }),
  ],
  layers: [
    layer({ id: 'background', kind: 'background', locked: true }),
    layer({ id: 'drawing-layer-1', kind: 'drawing' }),
    layer({ id: 'l-free' }),
    layer({ id: 'l-locked', locked: true }),
  ],
  activeLayerId: 'drawing-layer-1',
  activeRatio: '16:9',
})

describe('assessDeleteTarget（删除可行性单一真相源，静默 no-op 根治）', () => {
  it('普通资产 → ok；锁定层 → locked；背景层 → background；不存在 → missing', () => {
    const s = state()
    expect(assessDeleteTarget(s, { kind: 'asset', id: 'a-free' })).toBe('ok')
    expect(assessDeleteTarget(s, { kind: 'asset', id: 'a-locked' })).toBe('locked')
    expect(assessDeleteTarget(s, { kind: 'asset', id: 'a-bg' })).toBe('background')
    expect(assessDeleteTarget(s, { kind: 'asset', id: 'ghost' })).toBe('missing')
  })

  it('deleteTargetFromState 与判定同源：非 ok 一律原样返回，ok 真删', () => {
    const s = state()
    expect(deleteTargetFromState(s, { kind: 'asset', id: 'a-locked' })).toBe(s)
    expect(deleteTargetFromState(s, { kind: 'asset', id: 'a-bg' })).toBe(s)
    const after = deleteTargetFromState(s, { kind: 'asset', id: 'a-free' })
    expect(after.canvasAssets.map((item) => item.id)).toEqual(['a-locked', 'a-bg'])
    expect(after.layers.some((item) => item.id === 'l-free')).toBe(false)
  })
})

describe('mergeResultLibraryItems（结果页签 IA 归位：已连线在前，画布成图去重补后）', () => {
  it('同一节点连了线就不再以「来自画布」重复出现；画布独有的标 fromCanvas', () => {
    const connected = [{ id: 'result:n1:r1', nodeId: 'n1', name: '连线图', url: 'u1' }]
    const canvas = [
      { id: 'canvas:n1:r1', nodeId: 'n1', name: '连线图', url: 'u1' },
      { id: 'canvas:n2:r2', nodeId: 'n2', name: '画布图', url: 'u2' },
    ]
    const merged = mergeResultLibraryItems(connected, canvas)
    expect(merged.map((item) => item.id)).toEqual(['result:n1:r1', 'canvas:n2:r2'])
    expect(merged[0].fromCanvas).toBeUndefined()
    expect(merged[1].fromCanvas).toBe(true)
  })
})

// 删层之后还能接着画（设计卡 docs/plan/2026-11-26-layer-split.md「顺手修」；协调 2026-11-26 拍板按 P2 补）：
// 当前层的回退只有 fallbackActiveLayerId 一个口径；画笔每一笔自己建层，不靠当前层在不在。
// 反例：canDrawOnLayer 退回「当前层得在且没锁」→ 拆出来的画板删一层后「画一笔落成新的一层」红。
describe('删掉任意一层后画一笔，必须落成新的一层', () => {
  let seq = 0
  const createId = (prefix: string) => `${prefix}-${++seq}`
  const splitBoard = () => buildLayerSplitBoard({
    baseSize: { width: 1280, height: 720 },
    baseName: 'BASE',
    fallbackName: (n) => `L${n}`,
    createId,
    pieces: [
      { url: 'nomi-local://base.png', layer: { zIndex: 0 } },
      { url: 'nomi-local://a.png', layer: { zIndex: 1, name: 'A', box: { left: 0, top: 0, right: 100, bottom: 100 } } },
      { url: 'nomi-local://b.png', layer: { zIndex: 2, name: 'B', box: { left: 200, top: 0, right: 300, bottom: 100 } } },
    ],
  })
  const brush = (id: string, layerId: string): CanvasStroke => ({ id, layerId, color: '#000', size: 4, path: 'M0 0L1 1', tool: 'brush' })
  /** 照真实界面的顺序走：删 → 按当前层判能不能落笔 → 落笔。 */
  const deleteThenDraw = (before: WhiteboardState, target: CanvasObjectTarget) => {
    const afterDelete = deleteTargetFromState(before, target)
    expect(afterDelete).not.toBe(before)
    const activeLayer = afterDelete.layers.find((item) => item.id === afterDelete.activeLayerId)
    expect(canDrawOnLayer('brush', activeLayer)).toBe(true)
    const afterDraw = commitStrokeToState(afterDelete, brush(`s-${++seq}`, afterDelete.activeLayerId), (n) => `P${n}`, createId)
    expect(afterDraw.layers).toHaveLength(afterDelete.layers.length + 1)
    expect(afterDraw.activeLayerId).toBe(afterDraw.layers.at(-1)!.id)
    expect(afterDraw.strokes.at(-1)!.layerId).toBe(afterDraw.activeLayerId)
    return { afterDelete, afterDraw }
  }

  it('拆出来的画板（没有「图层 1」）：底图和每一层逐个删，删完都能落笔成新层', () => {
    const board = splitBoard()
    expect(board.layers.some((item) => item.id === LEGACY_DRAWING_LAYER_ID)).toBe(false)
    for (const asset of board.canvasAssets) {
      const { afterDelete } = deleteThenDraw(board, { kind: 'asset', id: asset.id })
      // 当前层落在一层还在的、没锁的层上（不指向不存在的「图层 1」）。
      expect(afterDelete.layers.find((item) => item.id === afterDelete.activeLayerId)?.locked).toBe(false)
    }
  })

  it('删到只剩背景：当前层为空，画笔照样能落笔成新层，橡皮擦不能擦', () => {
    let board = splitBoard()
    for (const asset of [...board.canvasAssets]) board = deleteTargetFromState(board, { kind: 'asset', id: asset.id })
    expect(board.layers.map((item) => item.kind)).toEqual(['background'])
    expect(board.activeLayerId).toBe('')
    expect(canDrawOnLayer('brush', undefined)).toBe(true)
    expect(canDrawOnLayer('eraser', undefined)).toBe(false)
    expect(canDrawOnLayer('eraser', board.layers[0])).toBe(false)
    const drawn = commitStrokeToState(board, brush('s-last', board.activeLayerId), (n) => `P${n}`, createId)
    expect(drawn.layers.map((item) => item.kind)).toEqual(['background', 'drawing'])
  })

  it('老项目的「图层 1」原样保留：删别的层后回到它，它本身不被删', () => {
    const old = state()
    const { afterDelete, afterDraw } = deleteThenDraw(old, { kind: 'asset', id: 'a-free' })
    expect(afterDelete.activeLayerId).toBe(LEGACY_DRAWING_LAYER_ID)
    expect(afterDraw.layers.map((item) => item.id).slice(0, 3)).toEqual(['background', LEGACY_DRAWING_LAYER_ID, 'l-locked'])
  })

  it('橡皮擦不建层，落在它擦的那一层', () => {
    const old = state()
    const erased = commitStrokeToState(old, { ...brush('e1', 'l-free'), tool: 'eraser' }, (n) => `P${n}`, createId)
    expect(erased.layers).toBe(old.layers)
    expect(erased.strokes.at(-1)!.layerId).toBe('l-free')
  })
})
