/**
 * 画板卡片：有可见内容就看得见画的东西（2026-10-27）。
 *
 * 0.23.0 和 10-22 之前画的画板只存了 state、没有结果图，卡片以前只认结果图，于是和空画板一样只剩「打开画板」启动器。
 * 现在没有结果、但 state 里有可见内容时，卡片显示按 state 离屏现画的预览（whiteboardStatePreview）：只在内存里，
 * 不写 store、不落盘；按「完成」用的同一个光栅键缓存；一次只画一张；不在视口不开始；失败回到启动器并记日志。
 *
 * 真挂 WhiteboardCardBody 和真的预览缓存；离屏 Leafer 换成假类（记下构造参数、导出参数、是否销毁），场景渲染器换成记录参数的桩，
 * 卡片叶子组件换成「挂上 / 卸下」登记表。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../../ai/v4/testReactRenderer'
import type { GenerationCanvasNode, GenerationNodeResult } from '../../model/generationCanvasTypes'
import type { CanvasStroke } from './whiteboardCanvasTypes'
import type { WhiteboardState } from './whiteboardTypes'

const harness = vi.hoisted(() => ({
  mounted: new Set<{ kind: string; props: Record<string, unknown> }>(),
  /** What the viewport observer reports to a card when it mounts; `setVisible` plays the observer's later callbacks. */
  visible: true,
  visibilitySetters: [] as Array<(visible: boolean) => void>,
  boards: [] as Array<{ config: Record<string, unknown>; exportOptions: Record<string, unknown> | null; destroyed: boolean }>,
  /** Exports waiting for the test to finish them, in the order they started. */
  pendingExports: [] as Array<(outcome: 'ok' | 'error') => void>,
  sceneCalls: [] as Array<Record<string, unknown>>,
  warn: vi.fn(),
  updateNode: vi.fn(),
  selectNode: vi.fn(),
  persist: vi.fn(),
  openWhiteboard: vi.fn(),
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@tabler/icons-react', () => ({ IconBrush: () => null }))
vi.mock('../../../../desktop/rendererLog', () => ({ logRendererWarn: harness.warn, logRendererError: vi.fn() }))
vi.mock('../../adapters/persistNodeImage', () => ({ persistNodeImageFile: harness.persist, persistNodeImageBlob: harness.persist }))
vi.mock('./whiteboardSession', () => ({ openWhiteboard: harness.openWhiteboard }))
vi.mock('../nodeSizing', () => ({ resolveNodeVisualSize: () => ({ width: 144, height: 81 }) }))
vi.mock('../../store/generationCanvasStore', () => {
  const store = { selectNode: harness.selectNode, updateNode: harness.updateNode }
  return {
    useGenerationCanvasStore: Object.assign((selector: (state: typeof store) => unknown) => selector(store), {
      getState: () => store,
      setState: harness.updateNode,
    }),
  }
})
vi.mock('../deferredNodeMediaQueue', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    useDeferredNodeMediaVisibility: () => {
      const [visible, setVisible] = ReactActual.useState(harness.visible)
      harness.visibilitySetters.push(setVisible)
      return { ref: () => {}, visible }
    },
  }
})
vi.mock('../render/CardCommon', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const useMounted = (kind: string, props: Record<string, unknown>) => {
    const [entry] = ReactActual.useState(() => ({ kind, props }))
    entry.props = props
    ReactActual.useLayoutEffect(() => {
      harness.mounted.add(entry)
      return () => { harness.mounted.delete(entry) }
    }, [entry])
  }
  return {
    CardActivationButton: (props: Record<string, unknown>) => {
      useMounted(String(props.testId), props)
      return ReactActual.createElement('button', null, props.children as React.ReactNode)
    },
    EmptyStateLauncher: (props: Record<string, unknown>) => {
      useMounted(String(props.testId), props)
      return null
    },
  }
})
vi.mock('../DeferredNodeMedia', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const useMounted = (kind: string, props: Record<string, unknown>) => {
    const [entry] = ReactActual.useState(() => ({ kind, props }))
    entry.props = props
    ReactActual.useLayoutEffect(() => {
      harness.mounted.add(entry)
      return () => { harness.mounted.delete(entry) }
    }, [entry])
  }
  return {
    DeferredNodeImage: (props: Record<string, unknown>) => { useMounted('picture', props); return null },
    DeferredNodeMediaPlaceholder: (props: Record<string, unknown>) => { useMounted('placeholder', props); return null },
  }
})
vi.mock('./whiteboardSceneRender', () => ({
  renderWhiteboardScene: (params: Record<string, unknown>) => { harness.sceneCalls.push(params) },
}))
vi.mock('@leafer-in/export', () => ({}))
vi.mock('leafer-ui', () => {
  class Leafer {
    readonly record: { config: Record<string, unknown>; exportOptions: Record<string, unknown> | null; destroyed: boolean }
    constructor(config: Record<string, unknown>) {
      this.record = { config, exportOptions: null, destroyed: false }
      harness.boards.push(this.record)
    }
    add(): void {}
    export(_type: string, options: Record<string, unknown>) {
      this.record.exportOptions = options
      return new Promise((resolve) => {
        harness.pendingExports.push((outcome) => resolve(outcome === 'ok'
          ? { data: new Blob(['png'], { type: 'image/png' }) }
          : { data: '', error: new Error('export failed') }))
      })
    }
    destroy(): void { this.record.destroyed = true }
  }
  class Shape {}
  return { Leafer, Group: Shape, Box: Shape, Image: Shape, Path: Shape, Rect: Shape, Text: Shape, PathCommandMap: {}, PathConvert: {}, PathNumberCommandLengthMap: {} }
})

import WhiteboardCardBody from './WhiteboardCardBody'
import { createDefaultWhiteboardState } from './whiteboardState'
import {
  resetWhiteboardStatePreviewsForTests,
  WHITEBOARD_STATE_PREVIEW_SPARE_LIMIT,
  whiteboardStatePreviewPixelRatio,
} from './whiteboardStatePreview'
import { CANVAS_PREVIEW_LONG_EDGE_PX } from '../../../../../electron/shared/canvas/canvasMediaPreview'

const brush = (id: string, path = 'M0 0 L40 40 L0 40 Z'): CanvasStroke => ({ id, layerId: 'drawing-layer-1', color: '#222222', size: 6, path, tool: 'brush' })

/** A board as 0.23.0 saved it: state on the node, no result. */
function legacyState(strokes: CanvasStroke[] = [brush('s1')], dimensions = { width: 1280, height: 720 }): WhiteboardState {
  return { ...createDefaultWhiteboardState('16:9'), canvasDimensions: dimensions, strokes }
}

function boardNode(id: string, state: WhiteboardState | undefined, result?: GenerationNodeResult): GenerationCanvasNode {
  return { id, kind: 'whiteboard', title: `Board ${id}`, position: { x: 0, y: 0 }, ...(state ? { meta: { whiteboardState: state } } : {}), ...(result ? { result } : {}) }
}

const mountedOf = (kind: string) => [...harness.mounted].filter((entry) => entry.kind === kind)
const pictures = () => mountedOf('picture').map((entry) => ({ alt: entry.props.alt, src: entry.props.src }))
const aliveBoards = () => harness.boards.filter((board) => !board.destroyed).length

/** Let dynamic imports, exports and the cache's notifications run, then flush React's effects. */
async function settle(renderer: ReturnType<typeof createReactTestRenderer>) {
  for (let round = 0; round < 6; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    renderer.flushPassiveEffects()
  }
}

function mountCards(nodes: GenerationCanvasNode[]) {
  const renderer = createReactTestRenderer()
  const show = (next: GenerationCanvasNode[]) => {
    renderer.render(<>{next.map((node) => <WhiteboardCardBody key={node.id} node={node} />)}</>)
    renderer.flushPassiveEffects()
  }
  show(nodes)
  return { renderer, show, settle: () => settle(renderer) }
}

/** Finish the oldest waiting export. */
async function finishExport(renderer: ReturnType<typeof createReactTestRenderer>, outcome: 'ok' | 'error' = 'ok') {
  const finish = harness.pendingExports.shift()
  if (!finish) throw new Error('no export is waiting')
  finish(outcome)
  await settle(renderer)
}

let objectUrls = 0
let revoked: string[] = []
let renderers: Array<ReturnType<typeof createReactTestRenderer>> = []

function track<T extends { renderer: ReturnType<typeof createReactTestRenderer> }>(mounted: T): T {
  renderers.push(mounted.renderer)
  return mounted
}

beforeEach(() => {
  harness.mounted.clear()
  harness.visible = true
  harness.visibilitySetters = []
  harness.boards = []
  harness.pendingExports = []
  harness.sceneCalls = []
  harness.warn.mockClear()
  harness.updateNode.mockClear()
  harness.persist.mockClear()
  objectUrls = 0
  revoked = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++objectUrls}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => { revoked.push(url) })
})

afterEach(() => {
  for (const renderer of renderers) renderer.close()
  renderers = []
  resetWhiteboardStatePreviewsForTests()
  vi.restoreAllMocks()
})

describe('只有 state 的老画板', () => {
  it('卡片显示按 state 现画的图，不是启动器（A1）', async () => {
    const state = legacyState()
    const { renderer, settle: wait } = track(mountCards([boardNode('legacy', state)]))
    await wait()

    expect(mountedOf('whiteboard-empty-action')).toHaveLength(0)
    expect(mountedOf('whiteboard-open-preview')).toHaveLength(1)
    expect(mountedOf('placeholder')).toHaveLength(1) // drawing: the same static block a queued result shows
    expect(harness.sceneCalls).toHaveLength(1)
    expect(harness.sceneCalls[0].strokes).toEqual(state.strokes)
    expect(Object.keys(harness.sceneCalls[0].context as object)).not.toContain('app')

    await finishExport(renderer)
    expect(pictures()).toEqual([{ alt: 'Board legacy', src: 'blob:preview-1' }])
    expect(mountedOf('placeholder')).toHaveLength(0)
    expect(mountedOf('whiteboard-empty-action')).toHaveLength(0)
  })

  it('空画板、只有橡皮、只有空白文字都是启动器；有结果时显示结果图；都不现画（A2）', async () => {
    const eraserOnly: WhiteboardState = { ...legacyState([]), strokes: [{ ...brush('e1'), tool: 'eraser' }] }
    const blankText: WhiteboardState = {
      ...legacyState([]),
      texts: [{ id: 't1', layerId: 'drawing-layer-1', text: '   ', x: 0, y: 0, width: 10, height: 10, fontSize: 24, color: '#222222' }],
    }
    const result: GenerationNodeResult = { id: 'r1', type: 'image', url: 'nomi-local://p/board.png', thumbnailUrl: 'nomi-local://p/board-thumb.png', createdAt: 1 }
    const { settle: wait } = track(mountCards([
      boardNode('empty', createDefaultWhiteboardState('16:9')),
      boardNode('eraser', eraserOnly),
      boardNode('blank-text', blankText),
      boardNode('no-state', undefined),
      boardNode('finished', legacyState(), result),
    ]))
    await wait()

    expect(mountedOf('whiteboard-empty-action')).toHaveLength(4)
    expect(mountedOf('whiteboard-open-preview')).toHaveLength(1)
    expect(pictures()).toEqual([{ alt: 'Board finished', src: 'nomi-local://p/board-thumb.png' }])
    expect(harness.boards).toHaveLength(0)
    expect(harness.sceneCalls).toHaveLength(0)
  })

  it('同一份画的两张卡只现画一次（A3）', async () => {
    const { renderer, settle: wait } = track(mountCards([boardNode('a', legacyState()), boardNode('b', legacyState())]))
    await wait()
    await finishExport(renderer)

    expect(harness.boards).toHaveLength(1)
    expect(pictures().map((picture) => picture.src)).toEqual(['blob:preview-1', 'blob:preview-1'])
  })

  it('只改图层名或选中的图层不重画；改了笔画会重画（A3）', async () => {
    const state = legacyState()
    const mounted = track(mountCards([boardNode('board', state)]))
    await mounted.settle()
    await finishExport(mounted.renderer)

    const relabelled: WhiteboardState = {
      ...state,
      activeLayerId: 'background',
      layers: state.layers.map((layer) => ({ ...layer, name: `${layer.id} renamed`, thumbnail: 'image' as const })),
    }
    mounted.show([boardNode('board', relabelled)])
    await mounted.settle()
    expect(harness.boards).toHaveLength(1)
    expect(pictures()).toEqual([{ alt: 'Board board', src: 'blob:preview-1' }])

    mounted.show([boardNode('board', { ...state, strokes: [...state.strokes, brush('s2', 'M50 50 L90 90 L50 90 Z')] })])
    await mounted.settle()
    expect(harness.boards).toHaveLength(2)
    await finishExport(mounted.renderer)
    expect(pictures()).toEqual([{ alt: 'Board board', src: 'blob:preview-2' }])
  })

  it('同一时刻最多一张在画，画完一张才开始下一张（A3）', async () => {
    const nodes = [1, 2, 3].map((index) => boardNode(`board-${index}`, legacyState([brush(`s${index}`, `M${index} 0 L40 40 L0 40 Z`)])))
    const { renderer, settle: wait } = track(mountCards(nodes))
    await wait()
    const alive: number[] = [aliveBoards()]
    while (harness.pendingExports.length > 0) {
      await finishExport(renderer)
      alive.push(aliveBoards())
    }

    expect(harness.boards).toHaveLength(3)
    expect(alive).toEqual([1, 1, 1, 0])
    expect(pictures().map((picture) => picture.src).sort()).toEqual(['blob:preview-1', 'blob:preview-2', 'blob:preview-3'])
  })

  it('现画失败回到启动器，记一次渲染层日志（A4）', async () => {
    const { renderer, settle: wait } = track(mountCards([boardNode('broken', legacyState())]))
    await wait()
    await finishExport(renderer, 'error')

    expect(mountedOf('whiteboard-open-preview')).toHaveLength(0)
    expect(mountedOf('whiteboard-empty-action')).toHaveLength(1)
    expect(harness.warn).toHaveBeenCalledTimes(1)
    expect(harness.warn.mock.calls[0][0]).toBe('whiteboard-state-preview-failed')
  })

  it('现画不写 store、不落盘；离屏 Leafer 导出后销毁；预览长边不超过画布预览上限（A5）', async () => {
    const { renderer, settle: wait } = track(mountCards([boardNode('large', legacyState([brush('s1')], { width: 2560, height: 1440 }))]))
    await wait()
    await finishExport(renderer)

    const [board] = harness.boards
    const pixelRatio = board.config.pixelRatio as number
    expect(board.config).toMatchObject({ width: 2560, height: 1440 })
    expect(board.config.view).toBeUndefined()
    expect(board.exportOptions).toEqual({ blob: true, screenshot: true, pixelRatio })
    expect(Math.ceil(2560 * pixelRatio)).toBeLessThanOrEqual(CANVAS_PREVIEW_LONG_EDGE_PX)
    expect(board.destroyed).toBe(true)
    expect(harness.updateNode).not.toHaveBeenCalled()
    expect(harness.persist).not.toHaveBeenCalled()
  })

  it('不在视口时不开始现画，进了视口才开始（A5）', async () => {
    harness.visible = false
    const { renderer, settle: wait } = track(mountCards([boardNode('offscreen', legacyState())]))
    await wait()
    expect(harness.boards).toHaveLength(0)
    expect(mountedOf('placeholder')).toHaveLength(1)

    for (const setVisible of harness.visibilitySetters) setVisible(true)
    renderer.flushPassiveEffects()
    await wait()
    expect(harness.boards).toHaveLength(1)
  })

  it(`没有卡片在用的预览最多留 ${WHITEBOARD_STATE_PREVIEW_SPARE_LIMIT} 张，多出来的交还 blob 地址`, async () => {
    const nodes = Array.from({ length: WHITEBOARD_STATE_PREVIEW_SPARE_LIMIT + 2 }, (_, index) =>
      boardNode(`board-${index}`, legacyState([brush(`s${index}`, `M${index} 0 L40 40 L0 40 Z`)])))
    const mounted = track(mountCards([]))
    for (const node of nodes) {
      mounted.show([node])
      await mounted.settle()
      await finishExport(mounted.renderer)
    }
    mounted.show([])
    await mounted.settle()
    expect(revoked).toEqual(['blob:preview-1', 'blob:preview-2'])

    mounted.show([nodes[nodes.length - 1]])
    await mounted.settle()
    expect(harness.boards).toHaveLength(nodes.length) // still cached: no new render
    mounted.show([nodes[0]])
    await mounted.settle()
    expect(harness.boards).toHaveLength(nodes.length + 1) // given back: drawn again
  })
})

describe('预览的像素比', () => {
  it.each([
    [1280, 720],
    [1281, 721],
    [2560, 1440],
    [720, 1280],
    [4096, 4096],
    [1000, 600],
  ])('%i×%i 的画板，预览长边不超过上限', (width, height) => {
    const pixelRatio = whiteboardStatePreviewPixelRatio({ width, height })
    const longEdge = Math.max(width, height)
    expect(Math.ceil(longEdge * pixelRatio)).toBeLessThanOrEqual(CANVAS_PREVIEW_LONG_EDGE_PX)
    expect(Math.ceil(longEdge * pixelRatio)).toBeGreaterThanOrEqual(Math.min(longEdge, CANVAS_PREVIEW_LONG_EDGE_PX - 1))
  })
})
