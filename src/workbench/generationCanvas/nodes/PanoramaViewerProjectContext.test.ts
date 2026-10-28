import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const fixture = vi.hoisted(() => ({
  controller: new AbortController(), viewer: {} as unknown,
  encode: vi.fn(), notify: vi.fn(), setters: [] as ReturnType<typeof vi.fn>[],
}))
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>()
  return { ...actual, default: { ...actual,
    useState: (value: unknown) => { const setter = vi.fn(); fixture.setters.push(setter); return [value, setter] },
    useCallback: (callback: unknown) => callback,
    useRef: (current: unknown) => ({ current }),
    useContext: () => fixture.viewer, useId: () => 'capture', useEffect: () => {}, useLayoutEffect: () => {},
  } }
})
vi.mock('react-dom', () => ({ createPortal: (element: unknown) => element }))
vi.mock('../../generation/pageLayerContext', () => ({ useGenerationPageLayerActive: () => true, useGenerationPageLayerTenantOpen: () => true, setGenerationPageLayerTenantOpen: () => {} }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../../design/media', () => ({ NomiImage: 'img' }))
vi.mock('../../../design/actions', () => ({ WorkbenchIconButton: 'button' }))
vi.mock('../../../ui/notificationPolicy', () => ({ notify: fixture.notify }))
vi.mock('@photo-sphere-viewer/core', () => ({ Viewer: class {}, EquirectangularAdapter: class {} }))
vi.mock('../adapters/assetImportAdapter', () => ({ isProjectImportCancellation: (error: { code?: string }) => error.code === 'project_binding_stale' }))
vi.mock('../../project/projectCanvasReadSurface', () => ({
  // The single issuance point hands the originating project to the action.
  withProjectAction: (run: (project: unknown) => unknown) => run((() => {
    const signal = fixture.controller.signal
    return { signal, binding: { projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 },
      assertCurrent() { if (signal.aborted) throw Object.assign(new Error('stale'), { code: 'project_binding_stale' }) },
    }
  })()),
}))

import PanoramaViewer from './PanoramaViewer'

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
const rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }
type ScreenshotCallback = NonNullable<Parameters<typeof PanoramaViewer>[0]['onScreenshot']>
function screenshotClick(onScreenshot: ScreenshotCallback): () => unknown {
  const tree = PanoramaViewer({ nodeId: 'panorama-test', imageUrl: 'nomi-local://panorama', width: 100, height: 100, onScreenshot })
  const controls = find(tree, node => typeof node.type === 'function' && node.type.name === 'PanoramaDialogControls')
  ;(controls.props.captureFrameRef as { current: unknown }).current = { getBoundingClientRect: () => rect }
  const rendered = (controls.type as (props: Record<string, unknown>) => ReactNode)(controls.props)
  return find(rendered, node => node.props.label === 'generationCommon.panorama.captureFrame').props.onClick as () => unknown
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers()
  fixture.controller = new AbortController(); fixture.setters = []
  vi.stubGlobal('document', { body: {} })
  class CaptureCanvas { width = 100; height = 100 }
  vi.stubGlobal('HTMLCanvasElement', CaptureCanvas)
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { drawImage() {} } }
    convertToBlob() { return fixture.encode() }
  })
  let render: () => void
  fixture.viewer = {
    renderer: { renderer: { domElement: new CaptureCanvas() } },
    container: { getBoundingClientRect: () => rect },
    addEventListener: (_event: unknown, listener: () => void) => { render = listener },
    needsUpdate: () => render(),
  }
  fixture.encode.mockResolvedValue(new Blob(['png']))
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('does not deliver a panorama captured in A after A to B to A while PNG encoding is pending', async () => {
  const encoded = deferred<Blob>(); fixture.encode.mockReturnValue(encoded.promise)
  const onScreenshot = vi.fn<ScreenshotCallback>(); screenshotClick(onScreenshot)()
  expect(fixture.encode).toHaveBeenCalledOnce()
  fixture.notify.mockClear(); fixture.setters.forEach(setter => setter.mockClear()); replaceProject()
  encoded.resolve(new Blob(['png']))
  await vi.runAllTimersAsync()
  expect(onScreenshot).not.toHaveBeenCalled()
  expect(fixture.notify).not.toHaveBeenCalled()
  expect(fixture.setters.every(setter => setter.mock.calls.length === 0)).toBe(true)
})

it('passes the project captured before rendering to the panorama publication callback', async () => {
  const onScreenshot = vi.fn<ScreenshotCallback>(); screenshotClick(onScreenshot)()
  await vi.runAllTimersAsync()
  expect(onScreenshot).toHaveBeenCalledOnce()
  expect(onScreenshot.mock.calls[0][1]).toMatchObject({ binding: { projectId: 'a' }, signal: fixture.controller.signal })
})
