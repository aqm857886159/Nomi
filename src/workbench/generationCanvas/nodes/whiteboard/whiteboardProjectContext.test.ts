import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'

const fixture = vi.hoisted(() => ({
  controller: new AbortController(),
  capture: vi.fn(), persist: vi.fn(), crop: vi.fn(), feedback: vi.fn(),
  update: vi.fn(), add: vi.fn(), connect: vi.fn(), select: vi.fn(), size: vi.fn(),
  removeBackground: vi.fn(), fallback: vi.fn(), setters: [] as ReturnType<typeof vi.fn>[],
  callbacks: [] as Promise<unknown>[], selection: null as unknown,
  nodes: [] as GenerationCanvasNode[],
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
        : typeof initial === 'function' ? initial() : initial, setter]
    },
    useRef: (current: unknown) => ({ current: current ?? { captureViewportFile: fixture.capture, getState: () => null } }),
    useMemo: (compute: () => unknown) => compute(), useEffect: () => {}, useImperativeHandle: () => {},
    forwardRef: (component: unknown) => component,
  } }
})
vi.mock('react-dom', () => ({ createPortal: (element: unknown) => element }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../../i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../../../design', () => ({ WorkbenchButton: 'button' }))
vi.mock('../../../../ui/notificationPolicy', () => ({ notify: fixture.feedback }))
vi.mock('../../../../ui/app-shell/windowChrome', () => ({ currentFullscreenOverlayTopOffset: () => 0 }))
vi.mock('../../../project/projectCanvasReadSurface', () => ({
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
vi.mock('./WhiteboardToolbarControls', () => ({ AspectRatioPopover: 'ratio', ToolIconButton: 'button', TOOL_ITEMS: [] }))
vi.mock('./WhiteboardLibraryPanel', () => ({ WhiteboardLibraryPanel: 'library' }))
vi.mock('./whiteboardState', async original => ({ ...await original<typeof import('./whiteboardState')>(), loadImageSize: fixture.size }))
vi.mock('../../../../lib/removeBackground', () => ({ removeBackgroundBlob: fixture.removeBackground, blobToDataUrl: fixture.fallback }))

import WhiteboardModal from './WhiteboardModal'
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
  const tree = WhiteboardModal({ nodeId: 'source', sourceKind, onClose: vi.fn() })
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
  const tree = WhiteboardModal({ nodeId: 'source', sourceKind: 'whiteboard', onClose: vi.fn() })
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
  const tree = WhiteboardModal({ nodeId: 'source', sourceKind, onClose: vi.fn() })
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
  const onClose = vi.fn()
  const tree = WhiteboardModal({ nodeId: 'source', sourceKind: 'image', onClose })
  ;(find(tree, node => node.props['aria-label'] === 'generationCommon.whiteboard.doneAria').props.onClick as () => void)()
  await Promise.allSettled(fixture.callbacks)
  expect(fixture.update).not.toHaveBeenCalled()
  expect(fixture.feedback).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})
