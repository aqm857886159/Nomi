import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const fixture = vi.hoisted(() => ({
  controller: new AbortController(),
  update: vi.fn(), add: vi.fn(), select: vi.fn(), connect: vi.fn(),
  persist: vi.fn(), removeBackground: vi.fn(), nodes: [] as GenerationCanvasNode[],
  grid: null as 1 | 2 | null,
}))
vi.mock('react', () => ({ default: {
  useCallback: (callback: unknown) => callback,
  useState: (value: unknown) => [value === null ? fixture.grid : value, vi.fn()],
} }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../project/projectCanvasReadSurface', () => ({
  // The single issuance point hands the originating project to the action.
  withProjectAction: (run: (project: unknown) => unknown) => run((() => {
    const signal = fixture.controller.signal
    return { signal, binding: { projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 },
      assertCurrent() { if (signal.aborted) throw Object.assign(new Error('stale'), { code: 'project_binding_stale' }) },
    }
  })()),
}))
vi.mock('../store/generationCanvasStore', () => {
  const getState = () => ({ nodes: fixture.nodes, updateNode: fixture.update, addNode: fixture.add, addDerivedOutput: (request: { node: unknown }) => fixture.add(request.node),
    selectNode: fixture.select, connectNodes: fixture.connect })
  return { useGenerationCanvasStore: Object.assign((selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState()), { getState }) }
})
vi.mock('../adapters/persistNodeImage', () => ({ persistNodeImageBlob: fixture.persist, persistNodeImageFile: fixture.persist }))
vi.mock('../adapters/assetImportAdapter', () => ({ isProjectImportCancellation: (error: { code?: string }) => error.code === 'project_binding_stale' }))
vi.mock('../../../lib/removeBackground', () => ({ removeBackgroundBlob: fixture.removeBackground }))
vi.mock('../../workbenchStore', () => ({ useWorkbenchStore: { getState: () => ({ requestCanvasFit: vi.fn() }) } }))

import { useNodeImageEditing } from './useNodeImageEditing'
import { useNodePanoramaHandlers } from './useNodePanoramaHandlers'
import { buildContactSheetNode } from './buildContactSheetNode'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'

const originProject = () => withProjectAction((project: ProjectExecutionContext) => project)!

const node = { id: 'source', kind: 'image', title: 'source', position: { x: 0, y: 0 },
  result: { id: 'result', type: 'image', url: 'nomi-local://source', createdAt: 1 } } as GenerationCanvasNode
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function replaceProject() { fixture.controller.abort(); fixture.controller = new AbortController() }
beforeEach(() => {
  vi.clearAllMocks()
  fixture.controller = new AbortController()
  fixture.grid = null
  fixture.nodes = [node, { ...node, id: 'second' }]
  fixture.add.mockReturnValue({ ...node, id: 'created' })
  fixture.persist.mockResolvedValue({ url: 'nomi-local://stored', localOnly: false })
  vi.stubGlobal('document', {})
  vi.stubGlobal('Image', class { onload?: () => void; naturalWidth = 100; naturalHeight = 100; set src(_url: string) { this.onload?.() } })
  vi.stubGlobal('OffscreenCanvas', class {
    getContext() { return { fillRect() {}, fillText() {}, drawImage() {}, translate() {}, rotate() {}, scale() {} } }
    convertToBlob() { return Promise.resolve(new Blob(['png'])) }
  })
})
afterEach(() => vi.unstubAllGlobals())

it('does not publish a contact sheet when the project changes during rendering', async () => {
  const encoded = deferred<Blob>()
  vi.stubGlobal('OffscreenCanvas', class {
    getContext() { return { fillRect() {}, fillText() {}, drawImage() {} } }
    convertToBlob() { replaceProject(); return encoded.promise }
  })
  const result = buildContactSheetNode(['source', 'second'], vi.fn())
  encoded.resolve(new Blob(['png']))
  await expect(result).resolves.toBe(false)
  expect(fixture.add).not.toHaveBeenCalled()
  expect(fixture.persist).not.toHaveBeenCalled()
})

it('does not persist an image transform after A to B to A during decoding', async () => {
  const decoded = deferred<ImageBitmap>()
  vi.stubGlobal('createImageBitmap', () => { replaceProject(); return decoded.promise })
  const feedback = vi.fn()
  const result = useNodeImageEditing(node, { width: 300, height: 200 }, feedback).handleImageTransform('rotate-left')
  decoded.resolve({ width: 100, height: 100, close: vi.fn() } as unknown as ImageBitmap)
  await result
  expect(fixture.persist).not.toHaveBeenCalled()
  expect(fixture.update).not.toHaveBeenCalled()
  expect(feedback).not.toHaveBeenCalled()
})

it('ignores background-removal progress and completion after project replacement', async () => {
  fixture.removeBackground.mockImplementation(async (_url, progress) => {
    replaceProject()
    progress({ key: 'compute:inference', current: 1, total: 2 })
    return new Blob(['png'])
  })
  await useNodeImageEditing(node, { width: 300, height: 200 }, vi.fn()).handleRemoveBackground()
  expect(fixture.update).toHaveBeenCalledTimes(1)
  expect(fixture.persist).not.toHaveBeenCalled()
})

it('does not attach a panorama screenshot when storage completes after project replacement', async () => {
  fixture.persist.mockImplementation(async () => { replaceProject(); return { url: 'nomi-local://stored', localOnly: false } })
  const feedback = vi.fn()
  await useNodePanoramaHandlers(node, { width: 300, height: 200 }, feedback).handlePanoramaScreenshot({
    blob: new Blob(['png']), dimensions: { width: 100, height: 100 },
  }, originProject())
  expect(fixture.update).not.toHaveBeenCalled()
  expect(fixture.connect).not.toHaveBeenCalled()
  expect(feedback).not.toHaveBeenCalled()
})

it('preserves a same-project image transform and passes the original identity to storage', async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ width: 100, height: 100, close: vi.fn() }))
  await useNodeImageEditing(node, { width: 300, height: 200 }, vi.fn()).handleImageTransform('rotate-left')
  expect(fixture.update).toHaveBeenCalledOnce()
  expect(fixture.persist.mock.calls[0][3]).toMatchObject({ binding: { projectId: 'a' }, signal: fixture.controller.signal })
})

it.each([1, 2] as const)('does not apply crop grid %s or restore old progress after storage crosses project replacement', async grid => {
  fixture.grid = grid
  vi.stubGlobal('createImageBitmap', async () => ({ width: 100, height: 100, close: vi.fn() }))
  fixture.persist.mockImplementation(async () => { replaceProject(); return { url: 'nomi-local://stored', localOnly: false } })
  const feedback = vi.fn()
  await useNodeImageEditing(node, { width: 300, height: 200 }, feedback).handleEditConfirm({
    rect: { x: 0, y: 0, w: 1, h: 1 }, cols: grid === 2 ? [0.5] : [], rows: [],
  })
  expect(fixture.add).not.toHaveBeenCalled()
  expect(fixture.update.mock.calls.every(([, patch]) => patch.status === 'running')).toBe(true)
  expect(feedback).not.toHaveBeenCalled()
})

it('marks the existing panorama screenshot node failed when ordinary storage fails', async () => {
  fixture.persist.mockRejectedValue(new Error('cannot encode or persist image'))
  const feedback = vi.fn()
  await useNodePanoramaHandlers(node, { width: 300, height: 200 }, feedback).handlePanoramaScreenshot({
    blob: new Blob(['png']), dimensions: { width: 100, height: 100 },
  }, originProject())
  expect(fixture.update).toHaveBeenCalledWith('created', { status: 'error', error: 'generationCommon.panorama.captureFailed' })
  expect(feedback).toHaveBeenCalledOnce()
})

it('refuses a stale panorama capture instead of recapturing the currently active project', async () => {
  const originalProject = originProject()
  replaceProject()
  const feedback = vi.fn()
  await useNodePanoramaHandlers(node, { width: 300, height: 200 }, feedback).handlePanoramaScreenshot({
    blob: new Blob(['png']), dimensions: { width: 100, height: 100 },
  }, originalProject)
  expect(fixture.add).not.toHaveBeenCalled()
  expect(fixture.persist).not.toHaveBeenCalled()
  expect(feedback).not.toHaveBeenCalled()
})
