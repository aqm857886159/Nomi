/**
 * 画框尺寸 → 画板文档尺寸：提交的是真值，不是路过的中间值（2026-10-27，用户拍板「换」）。
 *
 * 真挂 WhiteboardDrawingTool（react-reconciler 测试渲染器），只把要真 DOM 的叶子换成桩：画框尺寸由假 getComputedStyle 报，
 * ResizeObserver 的通知由测试手动发，计时器是假的。React Flow 的节点尺寸要两段更新才落到 DOM，所以「宿主把画框调到门要的尺寸」
 * 总是晚到：每扇门各跑两种时序——适配在旧的待提交到点之前落地、之后落地。旧实现前一种停在中间值，后一种多写两版、
 * 中间显示过别的尺寸（V 报告 sizerace：18 次里 2 次停在 64 / 100）。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../../ai/v4/testReactRenderer'
import type { CanvasDimensions } from './lib/canvas'
import type { WhiteboardState } from './whiteboardTypes'

type Size = { width: number; height: number }

const harness = vi.hoisted(() => ({
  /** 画框此刻在 DOM 里的 CSS 尺寸（getComputedStyle 报这个）。 */
  frame: { width: 320, height: 180 } as { width: number; height: number },
  observers: [] as Array<{ callback: () => void; disconnected: boolean }>,
  /** 画布每次渲染拿到的尺寸。 */
  displayed: [] as Array<{ width: number; height: number }>,
  toolbar: null as null | Record<string, unknown>,
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../../ui/notificationPolicy', () => ({ notify: () => {} }))
vi.mock('../../adapters/persistNodeImage', () => ({ persistNodeImageFile: vi.fn() }))
vi.mock('../../adapters/assetImportAdapter', () => ({ isProjectImportCancellation: () => false }))
vi.mock('../../../project/projectCanvasReadSurface', () => ({ withProjectAction: vi.fn() }))
vi.mock('../../../../lib/removeBackground', () => ({ removeBackgroundBlob: vi.fn(), blobToDataUrl: vi.fn() }))
vi.mock('../localImageOpPhase', () => ({ removeBackgroundFailureMessage: () => '', removeBackgroundProgressMessage: () => '' }))
vi.mock('@tabler/icons-react', () => ({ IconEye: () => null, IconEyeOff: () => null, IconTrash: () => null }))
vi.mock('./WhiteboardLibraryPanel', () => ({ WhiteboardLibraryPanel: () => null }))
vi.mock('./WhiteboardEditingToolbar', () => ({
  WhiteboardEditingToolbar: (props: Record<string, unknown>) => { harness.toolbar = props; return null },
}))
vi.mock('./WhiteboardLeaferCanvas', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    LeaferCanvas: ReactActual.forwardRef(function LeaferCanvasStub(props: { dimensions: { width: number; height: number } }, ref) {
      ReactActual.useImperativeHandle(ref, () => ({
        getSceneTransforms: () => undefined, measureText: () => ({ width: 10, height: 10 }), captureViewportFile: vi.fn(),
        handleKeyDown: () => false, flipSelection: () => {}, groupSelection: () => {}, deleteSelection: () => false,
      }))
      harness.displayed.push({ width: props.dimensions.width, height: props.dimensions.height })
      return null
    }),
  }
})

import WhiteboardDrawingTool, { type WhiteboardDrawingToolHandle } from './WhiteboardDrawingTool'
import { createDefaultWhiteboardState } from './whiteboardState'
import { readFrameAgainstDocument } from './useWhiteboardFrameSize'

class FakeResizeObserver {
  private readonly entry: { callback: () => void; disconnected: boolean }
  constructor(callback: () => void) {
    this.entry = { callback, disconnected: false }
    harness.observers.push(this.entry)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void { this.entry.disconnected = true }
}

/** 文档 1280×720（16:9），画框 320×180：画框比例 0.25。 */
const SCALE = 0.25
const frameOf = (dimensions: Size): Size => ({ width: dimensions.width * SCALE, height: dimensions.height * SCALE })

function mountBoard(options: { state?: WhiteboardState; frame?: Size } = {}) {
  harness.frame = { ...(options.frame ?? { width: 320, height: 180 }) }
  harness.displayed = []
  const fits: Size[] = []
  const drafts = { count: 0 }
  const ref = React.createRef<WhiteboardDrawingToolHandle>()
  const renderer = createReactTestRenderer()
  const onDraftChange = () => { drafts.count += 1 }
  const onBoardDimensionsChange = (dimensions: CanvasDimensions) => { fits.push({ ...dimensions }) }
  renderer.render(<WhiteboardDrawingTool ref={ref} ownerNodeId="board" initialState={options.state ?? createDefaultWhiteboardState('16:9')}
    onDraftChange={onDraftChange} onBoardDimensionsChange={onBoardDimensionsChange} />)
  renderer.flushPassiveEffects()
  const flush = () => renderer.flushPassiveEffects()
  const toolbar = () => harness.toolbar as {
    dimensions: CanvasDimensions; canRedo: boolean
    onRatioChange: (ratio: string) => void; onDimensionsChange: (dimensions: CanvasDimensions) => void; onUndo: () => void
  }
  return {
    /** ResizeObserver 的一次通知（读的是画框此刻的尺寸）。 */
    notify() { for (const observer of harness.observers) if (!observer.disconnected) observer.callback(); flush() },
    /** 画框在 DOM 里变了尺寸，通知还没到。 */
    resize(size: Size) { harness.frame = { ...size } },
    /** 画框变了尺寸并且通知到了（拖框，或宿主的适配落地）。 */
    land(size: Size) { harness.frame = { ...size }; this.notify() },
    advance(ms: number) { vi.advanceTimersByTime(ms); flush() },
    act(run: () => void) { run(); flush() },
    document: () => ref.current!.getState().canvasDimensions,
    toolbar,
    fits,
    drafts,
    close: () => renderer.close(),
  }
}

type Board = ReturnType<typeof mountBoard>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  harness.observers = []
  harness.toolbar = null
  vi.stubGlobal('window', {
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
    getComputedStyle: () => ({ width: `${harness.frame.width}px`, height: `${harness.frame.height}px` }),
  })
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => { callback(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * 一扇门的格：拖框拖到 S1（提交排着），100ms 后过门，宿主把画框调到门要的尺寸，`fitAfterMs` 之后才落地。
 * 断言：文档是门写的值；过门之后画面和工具条只显示过这个值；过门只多 1 个版本；只请宿主调了这一次画框。
 */
function expectDoorCommitsItsOwnValue(setup: (board: Board) => void, door: (board: Board) => Size, fitAfterMs: number) {
  const board = mountBoard()
  board.notify()
  setup(board)
  board.land({ width: 400, height: board.toolbar().dimensions.height * SCALE }) // creator drags the frame wider
  board.advance(100)
  const draftsBefore = board.drafts.count
  const fitsBefore = board.fits.length
  harness.displayed = []
  let expected: Size = { width: 0, height: 0 }
  board.act(() => { expected = door(board) })
  board.advance(fitAfterMs)
  board.land(frameOf(expected)) // the host's fit lands
  board.advance(600)
  expect(board.document(), 'the document holds what the door wrote').toEqual(expected)
  expect(board.toolbar().dimensions, 'the toolbar reads what the door wrote').toEqual(expected)
  expect(harness.displayed.filter((size) => size.width !== expected.width || size.height !== expected.height), 'nothing else was drawn after the door').toEqual([])
  expect(board.drafts.count - draftsBefore, 'the door is the only new version').toBe(1)
  expect(board.fits.slice(fitsBefore), 'the frame was asked for the door value once').toEqual([expected])
  board.close()
  return board
}

describe('frame size → document size: a round trip leaves the original size', () => {
  it('drag out and back inside 250ms: the original size stays, no version is written', () => {
    const board = mountBoard()
    board.notify()
    const draftsBefore = board.drafts.count
    board.land({ width: 400, height: 180 })
    expect(board.toolbar().dimensions).toEqual({ width: 1600, height: 720 })
    board.advance(100)
    board.land({ width: 320, height: 180 })
    board.advance(300)
    expect(board.document()).toEqual({ width: 1280, height: 720 })
    expect(board.toolbar().dimensions).toEqual({ width: 1280, height: 720 })
    expect(board.drafts.count - draftsBefore).toBe(0)
    board.close()
  })

  it('the frame is already back when the commit is due but its notification is late: nothing is written', () => {
    const board = mountBoard()
    board.notify()
    const draftsBefore = board.drafts.count
    board.land({ width: 400, height: 180 })
    board.advance(100)
    board.resize({ width: 320, height: 180 }) // back in the DOM; ResizeObserver has not reported it yet
    board.advance(160) // the commit is due (250ms after the drag)
    expect(board.document(), 'the commit re-reads the frame instead of writing the size it saw at the drag').toEqual({ width: 1280, height: 720 })
    board.notify()
    board.advance(300)
    expect(board.document()).toEqual({ width: 1280, height: 720 })
    expect(board.drafts.count - draftsBefore).toBe(0)
    board.close()
  })

  it('a drag that rests becomes the document size once', () => {
    const board = mountBoard()
    board.notify()
    const draftsBefore = board.drafts.count
    board.land({ width: 400, height: 180 })
    board.advance(300)
    expect(board.document()).toEqual({ width: 1600, height: 720 })
    expect(board.drafts.count - draftsBefore).toBe(1)
    board.close()
  })
})

describe('every door commits its own value, not one the frame passed through', () => {
  const doors: Array<[string, (board: Board) => void, (board: Board) => Size]> = [
    ['ratio', () => {}, (board) => { board.toolbar().onRatioChange('1:1'); return { width: 1600, height: 1600 } }],
    ['size field', () => {}, (board) => { board.toolbar().onDimensionsChange({ width: 1000, height: 720 }); return { width: 1000, height: 720 } }],
    ['undo', (board) => {
      // One committed size change to undo: the size field writes 1280×960 and its fit lands.
      board.act(() => board.toolbar().onDimensionsChange({ width: 1280, height: 960 }))
      board.land(frameOf({ width: 1280, height: 960 }))
      board.advance(300)
    }, (board) => { board.toolbar().onUndo(); return { width: 1280, height: 720 } }],
  ]
  for (const [name, setup, door] of doors) {
    it(`${name}: the frame lands before the old commit would have been due`, () => {
      const board = expectDoorCommitsItsOwnValue(setup, door, 50)
      if (name === 'undo') expect(board.toolbar().canRedo, 'redo is still there after the undo').toBe(true)
    })
    it(`${name}: the frame lands after the old commit would have been due`, () => {
      const board = expectDoorCommitsItsOwnValue(setup, door, 200)
      if (name === 'undo') expect(board.toolbar().canRedo, 'redo is still there after the undo').toBe(true)
    })
  }

  it('size field typed fast (64, then 640): both fits land in order and the board stays at 640', () => {
    const board = mountBoard()
    board.notify()
    const draftsBefore = board.drafts.count
    board.act(() => board.toolbar().onDimensionsChange({ width: 64, height: 720 }))
    board.advance(20)
    board.act(() => board.toolbar().onDimensionsChange({ width: 640, height: 720 }))
    harness.displayed = []
    board.advance(20)
    board.land(frameOf({ width: 64, height: 720 })) // the first fit lands first
    board.advance(20)
    board.land(frameOf({ width: 640, height: 720 }))
    board.advance(600)
    expect(board.document()).toEqual({ width: 640, height: 720 })
    expect(harness.displayed.filter((size) => size.width !== 640), 'the passed-through 64 is never drawn again').toEqual([])
    expect(board.drafts.count - draftsBefore).toBe(2)
    board.close()
  })

  for (const fitAfterMs of [50, 300]) {
    it(`open: a 4:3 node around a 16:9 board keeps the board 1280×720 (fit lands after ${fitAfterMs}ms)`, () => {
      const board = mountBoard({ frame: { width: 320, height: 240 } })
      const draftsBefore = board.drafts.count
      harness.displayed = []
      board.notify() // ResizeObserver reports the frame as the node was saved
      board.advance(fitAfterMs)
      board.land({ width: 320, height: 180 }) // the host's open fit lands
      board.advance(600)
      expect(board.document()).toEqual({ width: 1280, height: 720 })
      expect(harness.displayed.filter((size) => size.width !== 1280 || size.height !== 720)).toEqual([])
      expect(board.drafts.count - draftsBefore).toBe(0)
      expect(board.fits).toEqual([])
      board.close()
    })
  }
})

describe('one verdict for observation and commit', () => {
  const board = { width: 1280, height: 720 }
  it('a frame within one screen pixel of the board is the same frame (stored node sizes are rounded)', () => {
    expect(readFrameAgainstDocument({ width: 320.6, height: 179.4 }, SCALE, board)).toEqual({ kind: 'same' })
  })
  it('a size that rounds back to the board is the same size', () => {
    // Zoomed-in frame (4 screen px per board px): 1.5 screen px off, but 1280.375 × 720.4 board px rounds back to the board.
    expect(readFrameAgainstDocument({ width: 5121.5, height: 2881.6 }, 4, board)).toEqual({ kind: 'same' })
  })
  it('a frame that cannot be measured decides nothing', () => {
    for (const frame of [null, { width: 0, height: 180 }, { width: 320, height: 0.5 }, { width: Number.NaN, height: 180 }]) {
      expect(readFrameAgainstDocument(frame, SCALE, board)).toEqual({ kind: 'unmeasurable' })
    }
    for (const scale of [null, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readFrameAgainstDocument({ width: 320, height: 180 }, scale, board)).toEqual({ kind: 'unmeasurable' })
    }
  })
  it('anything else is the frame size in board pixels', () => {
    expect(readFrameAgainstDocument({ width: 400, height: 180 }, SCALE, board)).toEqual({ kind: 'changed', dimensions: { width: 1600, height: 720 } })
  })
  it('an unmeasurable moment during a drag leaves the queued commit to re-read the frame', () => {
    const view = mountBoard()
    view.notify()
    view.land({ width: 400, height: 180 })
    view.advance(100)
    view.land({ width: 0, height: 0 }) // the node is collapsed for a moment
    view.resize({ width: 400, height: 180 })
    view.advance(200)
    expect(view.document()).toEqual({ width: 1600, height: 720 })
    view.close()
  })
})
