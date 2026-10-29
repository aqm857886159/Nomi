import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'

const fixture = vi.hoisted(() => ({
  controller: new AbortController(),
  capture: vi.fn(), persist: vi.fn(), crop: vi.fn(), feedback: vi.fn(),
  update: vi.fn(), add: vi.fn(), connect: vi.fn(), select: vi.fn(), size: vi.fn(),
  removeBackground: vi.fn(), fallback: vi.fn(), setters: [] as ReturnType<typeof vi.fn>[],
  callbacks: [] as Promise<unknown>[], selection: null as unknown,
  nodes: [] as GenerationCanvasNode[],
  initialImageStatus: null as null | 'failed',
  boardState: null as null | import('./whiteboardTypes').WhiteboardState,
  captureEffects: false, effects: [] as Array<() => void>, drawingHandle: null as null | import('./WhiteboardDrawingTool').WhiteboardDrawingToolHandle,
}))
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>()
  return { ...actual, default: { ...actual,
    useCallback: (callback: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
      const result = callback(...args)
      if (result instanceof Promise) fixture.callbacks.push(result)
      return result
    },
    useState: (initial: unknown) => {
      const setter = vi.fn(); fixture.setters.push(setter)
      return [fixture.setters.length === 1 && fixture.selection ? fixture.selection
        : typeof initial === 'function' ? initial() : initial === 'loading' && fixture.initialImageStatus ? fixture.initialImageStatus : initial, setter]
    },
    useRef: (current: unknown) => ({ current: current ?? { captureViewportFile: fixture.capture, getState: () => fixture.boardState, isBusy: () => false, getSceneTransforms: () => ({ offsets: {}, assetTransforms: {}, flips: {} }) } }),
    useMemo: (compute: () => unknown) => compute(), useEffect: (callback: () => void) => { if (fixture.captureEffects) fixture.effects.push(callback) }, useLayoutEffect: () => {}, useImperativeHandle: (_ref: unknown, create: () => typeof fixture.drawingHandle) => { if (fixture.captureEffects) fixture.drawingHandle = create() },
    forwardRef: (component: unknown) => component,
  } }
})
vi.mock('@mantine/hooks', async () => {
  const { default: React } = await import('react')
  return {
    useStateHistory: (initial: unknown) => {
      const [value, set] = React.useState(initial)
      return [value, { set, back: vi.fn(), forward: vi.fn(), reset: vi.fn() }, { history: [initial], current: 0 }]
    },
    // The frame-size hook's debounce; its timing has its own test (useWhiteboardFrameSize.test.tsx).
    useDebouncedCallback: (callback: () => void) => Object.assign(() => callback(), { cancel: vi.fn(), flush: vi.fn() }),
  }
})
vi.mock('./WhiteboardEditingToolbar', () => ({ WhiteboardEditingToolbar: 'toolbar' }))
vi.mock('../nodeAttachedPanel', () => ({ useNodeAttachedPanel: () => {} }))
vi.mock('./whiteboardSession', () => ({ registerWhiteboardFinish: () => () => {}, closeWhiteboard: () => {} }))
vi.mock('react-dom', () => ({ createPortal: (element: unknown) => element }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../../i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../../../design', () => ({ WorkbenchButton: 'button' }))
vi.mock('../../../../ui/notificationPolicy', () => ({ notify: fixture.feedback }))
vi.mock('../../../../ui/app-shell/windowChrome', () => ({ currentFullscreenOverlayTopOffset: () => 0 }))
vi.mock('../../../project/projectCanvasReadSurface', () => ({
  isProjectImportCancellation: () => false,
  // The single issuance point hands the originating project to the action.
  withProjectAction: (run: (project: unknown) => unknown) => run(screenshotProject()),
}))
vi.mock('../../store/generationCanvasStore', () => {
  const getState = () => ({ nodes: fixture.nodes, edges: [], updateNode: fixture.update, addNode: fixture.add, addDerivedOutput: (request: { node: unknown }) => fixture.add(request.node),
    selectNode: fixture.select, connectNodes: fixture.connect })
  return { useGenerationCanvasStore: Object.assign((selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState()), { getState }) }
})
vi.mock('../../adapters/persistNodeImage', () => ({
  persistNodeImageFile: fixture.persist, dataUrlToFile: () => new File(['png'], 'screenshot.png', { type: 'image/png' }),
}))
vi.mock('../../components/screenshotCropGeometry', () => ({
  cropScreenshotRegion: fixture.crop, normalizeSelectionRect: () => ({ x: 0, y: 0, width: 0.5, height: 0.5 }),
}))
vi.mock('./WhiteboardLeaferCanvas', () => ({ LeaferCanvas: 'leafer' }))
vi.mock('./WhiteboardLibraryPanel', () => ({ WhiteboardLibraryPanel: 'library' }))
vi.mock('./whiteboardState', async original => ({ ...await original<typeof import('./whiteboardState')>(), loadImageSize: fixture.size }))
vi.mock('../../../../lib/removeBackground', () => ({ removeBackgroundBlob: fixture.removeBackground, blobToDataUrl: fixture.fallback }))

import InlineWhiteboard from './InlineWhiteboard'
import WhiteboardDrawingTool from './WhiteboardDrawingTool'
import { ScreenshotCropOverlay } from '../../components/ScreenshotCropOverlay'
import { createDefaultWhiteboardState } from './whiteboardState'

function find(tree: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> {
  for (const element of Array.isArray(tree) ? tree : [tree]) {
    if (!element || typeof element !== 'object' || !('props' in element)) continue
    const node = element as ReactElement<Record<string, unknown>>
    if (predicate(node)) return node
    const child = find(node.props.children as ReactNode, predicate)
    if (child) return child
  }
  return undefined as unknown as ReactElement<Record<string, unknown>>
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function replaceProject() { fixture.controller.abort(); fixture.controller = new AbortController() }
function screenshotProject() {
  const signal = fixture.controller.signal
  return { signal, binding: { projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 },
    assertCurrent() { if (signal.aborted) throw Object.assign(new Error('stale'), { code: 'project_binding_stale' }) } }
}
const source = { id: 'source', kind: 'image', title: 'source', position: { x: 0, y: 0 } } as GenerationCanvasNode
beforeEach(() => {
  vi.clearAllMocks(); fixture.controller = new AbortController(); fixture.setters = []; fixture.callbacks = []; fixture.selection = null
  fixture.initialImageStatus = null; fixture.boardState = null; fixture.captureEffects = false; fixture.effects = []; fixture.drawingHandle = null
  fixture.nodes = [source]
  fixture.add.mockReturnValue({ ...source, id: 'created' })
  fixture.persist.mockResolvedValue('nomi-local://stored')
  fixture.size.mockResolvedValue({ width: 100, height: 100 })
  fixture.capture.mockResolvedValue(new File(['png'], 'board.png', { type: 'image/png' }))
  fixture.fallback.mockResolvedValue('data:image/png;base64,cG5n')
  vi.stubGlobal('document', { body: {}, querySelector: () => ({}) })
})
afterEach(() => vi.unstubAllGlobals())

it.each(['image', 'whiteboard'] as const)('cancels %s screenshot before publication after project replacement during capture', async sourceKind => {
  const captured = deferred<File>(); fixture.capture.mockReturnValue(captured.promise)
  const tree = InlineWhiteboard({ nodeId: 'source', sourceKind, onClose: vi.fn() })
  const screenshot = find(tree, node => typeof node.props.onScreenshot === 'function').props.onScreenshot as () => Promise<void>
  const result = screenshot()
  fixture.update.mockClear(); replaceProject()
  captured.resolve(new File(['png'], 'board.png', { type: 'image/png' }))
  await result
  await Promise.allSettled(fixture.callbacks)
  expect(fixture.persist).not.toHaveBeenCalled()
  expect(fixture.update).not.toHaveBeenCalled()
  expect(fixture.add).not.toHaveBeenCalled()
  expect(fixture.feedback).not.toHaveBeenCalled()
})

it('passes the original project lifetime into a same-project whiteboard screenshot', async () => {
  const tree = InlineWhiteboard({ nodeId: 'source', sourceKind: 'whiteboard', onClose: vi.fn() })
  await (find(tree, node => typeof node.props.onScreenshot === 'function').props.onScreenshot as () => Promise<void>)()
  await Promise.allSettled(fixture.callbacks)
  expect(fixture.persist.mock.calls[0][2]).toMatchObject({ binding: { projectId: 'a' }, signal: fixture.controller.signal })
  expect(fixture.feedback).not.toHaveBeenCalled()
  expect(fixture.add).toHaveBeenCalledOnce()
})

it.each([null, 'nomi-local://old-project'])('does not fallback or mutate whiteboard state after a project switch during upload (%s)', async localUrl => {
  const uploaded = deferred<string | null>(); fixture.persist.mockReturnValue(uploaded.promise)
  const tree = WhiteboardDrawingTool({ ownerNodeId: 'source' })
  const input = find(tree, node => node.type === 'input' && node.props.type === 'file')
  ;(input.props.onChange as (event: unknown) => void)({ currentTarget: { files: [new File(['png'], 'upload.png', { type: 'image/png' })], value: 'file' } })
  fixture.setters.forEach(setter => setter.mockClear()); replaceProject()
  uploaded.resolve(localUrl)
  await Promise.allSettled(fixture.callbacks)
  expect(fixture.size).not.toHaveBeenCalled()
  expect(fixture.setters.every(setter => setter.mock.calls.length === 0)).toBe(true)
  expect(fixture.feedback).not.toHaveBeenCalled()
})

it('does not add a whiteboard image after switching away and back during dimension loading', async () => {
  const sized = deferred<{ width: number; height: number }>()
  fixture.size.mockImplementation(() => { replaceProject(); return sized.promise })
  const tree = WhiteboardDrawingTool({ ownerNodeId: 'source' })
  const input = find(tree, node => node.type === 'input' && node.props.type === 'file')
  ;(input.props.onChange as (event: unknown) => void)({ currentTarget: { files: [new File(['png'], 'upload.png', { type: 'image/png' })], value: '' } })
  fixture.setters.forEach(setter => setter.mockClear())
  sized.resolve({ width: 100, height: 100 })
  await Promise.allSettled(fixture.callbacks)
  expect(fixture.setters.every(setter => setter.mock.calls.length === 0)).toBe(true)
  expect(fixture.feedback).not.toHaveBeenCalled()
})

it('ignores stale remove-background progress and does not persist its result', async () => {
  const initialState = createDefaultWhiteboardState()
  initialState.canvasAssets = [{ id: 'asset', layerId: 'layer', url: 'nomi-local://source', name: 'image', source: 'upload', x: 0, y: 0, width: 100, height: 100 }]
  fixture.removeBackground.mockImplementation(async (_url, progress) => {
    fixture.setters.forEach(setter => setter.mockClear()); replaceProject()
    progress({ key: 'compute:inference', current: 1, total: 2 })
    return new Blob(['png'])
  })
  const tree = WhiteboardDrawingTool({ ownerNodeId: 'source', initialState })
  const remove = find(tree, node => typeof node.props.onRemoveBackground === 'function').props.onRemoveBackground as (target: unknown) => unknown
  await remove({ kind: 'asset', id: 'asset' })
  await Promise.allSettled(fixture.callbacks)
  expect(fixture.setters.every(setter => setter.mock.calls.length === 0)).toBe(true)
  expect(fixture.persist).not.toHaveBeenCalled()
  expect(fixture.fallback).not.toHaveBeenCalled()
})

it('does not add or close a screenshot for the next project when cropping completes late', async () => {
  fixture.selection = { start: { x: 0, y: 0 }, end: { x: 0.5, y: 0.5 } }
  const cropped = deferred<{ dataUrl: string }>(); fixture.crop.mockReturnValue(cropped.promise)
  const onClose = vi.fn()
  const tree = ScreenshotCropOverlay({ capture: { url: 'nomi-local://capture', width: 100, height: 100 }, project: screenshotProject(), basePosition: { x: 0, y: 0 }, onClose })
  const click = find(tree, node => node.type === 'button' && node.props.children === 'generationCommon.screenshot.commit').props.onClick as () => unknown
  const pending = click(); replaceProject()
  cropped.resolve({ dataUrl: 'data:image/png;base64,cG5n' })
  await pending
  expect(fixture.add).not.toHaveBeenCalled()
  expect(fixture.update).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

it.each(['image', 'whiteboard'] as const)('ignores %s screenshot completion after project replacement during storage', async sourceKind => {
  fixture.persist.mockImplementation(async () => {
    replaceProject(); fixture.update.mockClear(); fixture.setters.forEach(setter => setter.mockClear())
    return 'nomi-local://old-project'
  })
  const tree = InlineWhiteboard({ nodeId: 'source', sourceKind, onClose: vi.fn() })
  ;(find(tree, node => typeof node.props.onScreenshot === 'function').props.onScreenshot as () => void)()
  await Promise.allSettled(fixture.callbacks)
  expect(fixture.update).not.toHaveBeenCalled()
  expect(fixture.add).not.toHaveBeenCalled()
  expect(fixture.feedback).not.toHaveBeenCalled()
  expect(fixture.setters.every(setter => setter.mock.calls.length === 0)).toBe(true)
})

it('does not close a new screenshot overlay or rewrite its nodes after storage completes late', async () => {
  fixture.selection = { start: { x: 0, y: 0 }, end: { x: 0.5, y: 0.5 } }
  fixture.crop.mockResolvedValue({ dataUrl: 'data:image/png;base64,cG5n' })
  fixture.persist.mockImplementation(async () => {
    replaceProject(); fixture.update.mockClear(); fixture.setters.forEach(setter => setter.mockClear())
    return 'nomi-local://old-project'
  })
  const onClose = vi.fn()
  const tree = ScreenshotCropOverlay({ capture: { url: 'nomi-local://capture', width: 100, height: 100 }, project: screenshotProject(), basePosition: { x: 0, y: 0 }, onClose })
  await (find(tree, node => node.type === 'button' && node.props.children === 'generationCommon.screenshot.commit').props.onClick as () => Promise<void>)()
  expect(fixture.update).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  expect(fixture.setters.every(setter => setter.mock.calls.length === 0)).toBe(true)
})

it('handles a failed screenshot save after switching projects without stale error feedback', async () => {
  fixture.persist.mockImplementation(async () => { replaceProject(); throw new Error('disk failed after switch') })
  // The image entrance only exists on a node that has a picture; Done then always goes through the save transaction.
  fixture.nodes = [{ ...source, result: { id: 'original', type: 'image', url: 'nomi-local://original' } } as GenerationCanvasNode]
  const onClose = vi.fn()
  const tree = InlineWhiteboard({ nodeId: 'source', sourceKind: 'image', onClose })
  ;(find(tree, node => typeof node.props.onDone === 'function').props.onDone as () => void)()
  await Promise.allSettled(fixture.callbacks)
  expect(fixture.update).not.toHaveBeenCalled()
  expect(fixture.feedback).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

// User 2026-10-22 (replaces board O40): Done leaves a picture on a board node that has something on it.
describe('board Done', () => {
  const board = { id: 'source', kind: 'whiteboard', title: 'Board', position: { x: 0, y: 0 } } as GenerationCanvasNode
  const drawn = () => ({ ...createDefaultWhiteboardState(), strokes: [{ id: 's', layerId: 'drawing-layer-1', tool: 'brush' as const, color: '#111827', size: 8, path: 'M 0 0 L 10 10' }] })
  const done = async (node: GenerationCanvasNode, initialState = createDefaultWhiteboardState()) => {
    fixture.nodes = [node]
    const onClose = vi.fn()
    const tree = InlineWhiteboard({ nodeId: 'source', sourceKind: 'whiteboard', initialState, onClose })
    ;(find(tree, element => typeof element.props.onDone === 'function').props.onDone as () => void)()
    await Promise.allSettled(fixture.callbacks)
    return onClose
  }
  it('an empty board that never produced a picture saves its state only and keeps the launcher', async () => {
    fixture.boardState = createDefaultWhiteboardState()
    const onClose = await done(board)
    expect(fixture.capture).not.toHaveBeenCalled()
    expect(fixture.update.mock.calls.every(([, patch]) => !('result' in patch))).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('a drawn board exports one picture as the node result', async () => {
    fixture.boardState = drawn()
    const onClose = await done(board)
    expect(fixture.capture).toHaveBeenCalledOnce()
    const published = fixture.update.mock.calls.find(([, patch]) => 'result' in patch)![1]
    expect(published.result).toMatchObject({ type: 'image', url: 'nomi-local://stored' })
    expect(published.history).toHaveLength(1)
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('a board saved as state alone (no picture yet) gets its picture on an unchanged Done', async () => {
    fixture.boardState = drawn()
    await done({ ...board, meta: { whiteboardState: drawn() } } as GenerationCanvasNode, drawn())
    expect(fixture.capture).toHaveBeenCalledOnce()
  })
  it('an unchanged Done on a board whose picture already exists adds no version', async () => {
    fixture.boardState = drawn()
    const onClose = await done({ ...board, result: { id: 'v1', type: 'image', url: 'nomi-local://v1' }, history: [{ id: 'v1', type: 'image', url: 'nomi-local://v1' }], meta: { whiteboardState: drawn() } } as unknown as GenerationCanvasNode, drawn())
    expect(fixture.capture).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })
  // 2026-10-27: Done no longer saves a screenshot, so a failed save says the drawing was not saved; the board stays open.
  it.each([
    ['the store returns no address', () => fixture.persist.mockResolvedValue(null)],
    ['the save fails without a message', () => fixture.persist.mockRejectedValue(new Error(''))],
  ])('a Done whose drawing cannot be saved says so and keeps the board open (%s)', async (_case, arrange) => {
    arrange()
    fixture.boardState = drawn()
    const onClose = await done(board)
    expect(fixture.feedback).toHaveBeenCalledOnce()
    expect(fixture.feedback.mock.calls[0][0].message).toBe('generationCommon.whiteboard.drawingSaveFailed')
    expect(onClose).not.toHaveBeenCalled()
    expect(fixture.update.mock.calls.every(([, patch]) => !('result' in patch))).toBe(true)
  })
})

// The camera button runs a different transaction per entrance: an image saves the drawing as its primary picture, a
// board makes a screenshot node. A failure names the one that failed (2026-10-27).
describe('camera failure copy', () => {
  const camera = async (sourceKind: 'image' | 'whiteboard') => {
    const tree = InlineWhiteboard({ nodeId: 'source', sourceKind, onClose: vi.fn() })
    await (find(tree, node => typeof node.props.onScreenshot === 'function').props.onScreenshot as () => Promise<unknown>)()
    await Promise.allSettled(fixture.callbacks)
    expect(fixture.feedback).toHaveBeenCalledOnce()
    return fixture.feedback.mock.calls[0][0].message as string
  }
  it('an image entrance that cannot save the drawing says the drawing was not saved', async () => {
    fixture.persist.mockResolvedValue(null)
    expect(await camera('image')).toBe('generationCommon.whiteboard.drawingSaveFailed')
  })
  it.each([
    ['the store returns no address', () => fixture.persist.mockResolvedValue(null)],
    ['the screenshot node cannot be made', () => fixture.add.mockReturnValue(null)],
    ['the save fails without a message', () => fixture.persist.mockRejectedValue(new Error(''))],
  ])('a board entrance whose screenshot cannot be saved says the screenshot was not saved (%s)', async (_case, arrange) => {
    arrange()
    expect(await camera('whiteboard')).toBe('generationCommon.whiteboard.screenshotSaveFailed')
  })
  it('an image entrance whose save fails without a message still says the drawing was not saved', async () => {
    fixture.persist.mockRejectedValue(new Error(''))
    expect(await camera('image')).toBe('generationCommon.whiteboard.drawingSaveFailed')
  })
})
it('publishes the imported raster baseline before the first edit and never publishes the loading empty draft', async () => {
  fixture.captureEffects = true
  const onRasterBaseline = vi.fn()
  const onDraftChange = vi.fn()
  const tree = WhiteboardDrawingTool({ ownerNodeId: 'source', initialImage: { url: 'nomi-local://source', aspectRatio: '16:9' }, onRasterBaseline, onDraftChange })
  fixture.effects.forEach(effect => effect())
  expect(onDraftChange).not.toHaveBeenCalled()
  await Promise.allSettled(fixture.callbacks)
  expect(onRasterBaseline).toHaveBeenCalledOnce()
  expect(onRasterBaseline.mock.calls[0][0].canvasAssets).toHaveLength(1)
  const canvas = find(tree, node => typeof node.props.onStrokeCommit === 'function')
  ;(canvas.props.onStrokeCommit as (stroke: unknown) => void)({ id: 'first-edit', layerId: 'drawing-layer-1', tool: 'brush', color: '#111827', size: 8, path: 'M 0 0 L 10 10' })
  expect(fixture.drawingHandle!.getState().strokes).toHaveLength(1)
  expect(onRasterBaseline.mock.calls[0][0].strokes).toHaveLength(0)
})

it('publishes against current history after asynchronous storage, without resurrecting deleted versions', async () => {
  const older = { id: 'deleted-during-save', type: 'image' as const, url: 'nomi-local://older', createdAt: 1 }
  const current = { id: 'current', type: 'image' as const, url: 'nomi-local://current', createdAt: 2 }
  fixture.nodes = [{ ...source, result: current, history: [older, current] }]
  const stored = deferred<string>(); fixture.persist.mockReturnValue(stored.promise)
  const tree = InlineWhiteboard({ nodeId: 'source', sourceKind: 'image', onClose: vi.fn() })
  ;(find(tree, node => typeof node.props.onScreenshot === 'function').props.onScreenshot as () => void)()
  await Promise.resolve(); await Promise.resolve()
  expect(fixture.persist).toHaveBeenCalledOnce()
  fixture.nodes = [{ ...fixture.nodes[0], history: [current], meta: { concurrentlyUpdated: true } }]
  stored.resolve('nomi-local://new-snapshot')
  await Promise.allSettled(fixture.callbacks)
  const patch = fixture.update.mock.calls.at(-1)![1]
  expect(patch.history.some((result: { id: string }) => result.id === older.id)).toBe(false)
  expect(patch.meta.concurrentlyUpdated).toBe(true)
})

it('failed initial import blocks draft and save, while Retry and Cancel remain actionable', () => {
  fixture.captureEffects = true
  fixture.initialImageStatus = 'failed'
  const onDone = vi.fn(), onAbort = vi.fn(), onDraftChange = vi.fn()
  const tree = WhiteboardDrawingTool({ ownerNodeId: 'source', initialImage: { url: 'nomi-local://source', aspectRatio: '16:9' }, onDone, onAbort, onDraftChange })
  expect(fixture.drawingHandle!.initialImageStatus()).toBe('failed')
  expect(fixture.drawingHandle!.isBusy()).toBe(true)
  fixture.effects.at(-1)!()
  expect(onDraftChange).not.toHaveBeenCalled()
  const toolbar = find(tree, node => node.type === 'toolbar')
  ;(toolbar.props.onDone as () => void)()
  expect(onDone).not.toHaveBeenCalled()
  const root = find(tree, node => typeof node.props.onKeyDownCapture === 'function')
  ;(root.props.onKeyDownCapture as (event: unknown) => void)({ key: 'Escape', keyCode: 27, nativeEvent: {}, target: { closest: () => null }, preventDefault: vi.fn(), stopPropagation: vi.fn() })
  expect(onDone).not.toHaveBeenCalled()
  expect(onAbort).toHaveBeenCalledOnce()
  ;(find(tree, node => node.type === 'button' && node.props.children === 'common.cancel').props.onClick as () => void)()
  expect(onAbort).toHaveBeenCalledTimes(2)
  ;(find(tree, node => node.type === 'button' && node.props.children === 'generationCommon.whiteboard.retryImport').props.onClick as () => void)()
  expect(fixture.setters.some(setter => setter.mock.calls.some(([value]) => value === 'loading'))).toBe(true)
  expect(fixture.update).not.toHaveBeenCalled()
  expect(fixture.persist).not.toHaveBeenCalled()
})

it('a failed image decode cannot establish a raster baseline or publish an empty document', async () => {
  fixture.captureEffects = true
  fixture.size.mockResolvedValue(null)
  const baseline = vi.fn(), draft = vi.fn()
  WhiteboardDrawingTool({ ownerNodeId: 'source', initialImage: { url: 'nomi-local://broken', aspectRatio: '16:9' }, onRasterBaseline: baseline, onDraftChange: draft })
  fixture.effects.forEach(effect => effect())
  await Promise.allSettled(fixture.callbacks)
  expect(baseline).not.toHaveBeenCalled()
  expect(draft).not.toHaveBeenCalled()
  expect(fixture.setters.some(setter => setter.mock.calls.some(([value]) => value === 'failed'))).toBe(true)
})

it.each([{ dimensions: undefined, expectedHeight: 337.5 }, { dimensions: { width: 1280, height: 900 }, expectedHeight: 421.875 }])('opens a different version with its own document frame: $expectedHeight', ({ dimensions, expectedHeight }) => {
  fixture.captureEffects = true
  fixture.nodes = [{ ...source, size: { width: 600, height: 600 }, result: { id: 'old', type: 'image', url: 'nomi-local://old', createdAt: 1 }, meta: { imageWidth: 1920, imageHeight: 1080, whiteboardFrameScale: 0.5, whiteboardResultIdentity: 'different' } }]
  const initialState = dimensions ? { ...createDefaultWhiteboardState(), canvasDimensions: dimensions } : undefined
  InlineWhiteboard({ nodeId: 'source', sourceKind: 'image', initialState, initialImage: { url: 'nomi-local://old', aspectRatio: '16:9' }, onClose: vi.fn() })
  fixture.effects[0]()
  expect(fixture.update).toHaveBeenCalledWith('source', expect.objectContaining({ size: { width: 600, height: expectedHeight } }), { history: false, persist: false, emit: false })
})
