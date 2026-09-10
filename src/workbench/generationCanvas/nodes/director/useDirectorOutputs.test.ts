import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDirectorStore, type DirectorStore } from './model/directorStore'
import { buildCameraFromPreset, CAMERA_PRESETS } from './model/cameraPresets'
import type { ViewportApiRef } from './scene/ViewportApiContext'

const runtime = vi.hoisted(() => ({ store: null as unknown as DirectorStore, cleanups: [] as (() => void)[], persist: vi.fn(), screenshot: vi.fn(), toast: vi.fn() }))
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>()
  return { ...actual, default: { ...actual, useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useEffect: (fn: () => (() => void) | void) => { const cleanup = fn(); if (cleanup) runtime.cleanups.push(cleanup) } } }
})
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../../ui/toast', () => ({ toast: runtime.toast }))
vi.mock('./DirectorEditorContext', () => ({ useDirectorStoreApi: () => runtime.store }))
vi.mock('./bridge/persistOutputs', () => ({ persistDirectorFramesVideo: runtime.persist, persistDirectorScreenshot: runtime.screenshot }))
import { useDirectorOutputs } from './useDirectorOutputs'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function OutputsHarness() {
  runtime.store = createDirectorStore({ defaultSceneName: 'Scene' })
  const id = runtime.store.getState().addCamera(buildCameraFromPreset({ preset: CAMERA_PRESETS[0], id: 'camera', name: 'Camera' }))
  runtime.store.getState().addTrajectoryClip(id, 0, 1 / 30)
  runtime.store.getState().setTimelineContext({ currentTime: 0.5 })
  const captureFrame = vi.fn().mockResolvedValue({ dataUrl: 'frame', blob: new Blob() })
  const apiRef = { current: { captureFrame, getViewportSize: () => ({ width: 16, height: 9 }) } } as unknown as ViewportApiRef
  return { api: useDirectorOutputs({ apiRef }), captureFrame }
}

beforeEach(() => {
  vi.clearAllMocks()
  runtime.cleanups = []
  runtime.persist.mockResolvedValue({ url: 'asset:video', localOnly: false })
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { queueMicrotask(() => fn(0)); return 1 })
})
afterEach(() => { runtime.cleanups.forEach((cleanup) => cleanup()); vi.unstubAllGlobals() })

describe('director output operation ownership', () => {
  it('holds the recording lock through encoding and rejects another recording', async () => {
    const encoded = deferred<{ url: string; localOnly: boolean }>()
    const started = deferred<void>()
    runtime.persist.mockImplementation(() => { started.resolve(); return encoded.promise })
    const { api } = OutputsHarness()
    const first = api.recordVideo()
    await started.promise
    const busyDuringEncoding = runtime.store.getState().videoRecording !== null
    const second = api.recordVideo()
    encoded.resolve({ url: 'asset:video', localOnly: false })
    expect(await first).toBe(true)
    expect(await second).toBe(false)
    expect(busyDuringEncoding).toBe(true)
    expect(runtime.store.getState().project.outputs.videos).toHaveLength(1)
    expect(runtime.store.getState().timeline.currentTime).toBe(0.5)
    expect(runtime.store.getState().videoRecording).toBeNull()
  })

  it('cancellation during encoding suppresses late output registration', async () => {
    const encoded = deferred<{ url: string; localOnly: boolean }>()
    const started = deferred<void>()
    runtime.persist.mockImplementation(() => { started.resolve(); return encoded.promise })
    const { api } = OutputsHarness()
    const result = api.recordVideo()
    await started.promise
    api.cancelRecording()
    encoded.resolve({ url: 'asset:video', localOnly: false })
    expect(await result).toBe(false)
    expect(runtime.store.getState().project.outputs.videos).toHaveLength(0)
    expect(runtime.store.getState().videoRecording).toBeNull()
  })

  it('reports capture exceptions and restores the timeline without rejecting its caller', async () => {
    const { api, captureFrame } = OutputsHarness()
    captureFrame.mockRejectedValue(new Error('context lost'))
    await expect(api.recordVideo()).resolves.toBe(false)
    expect(runtime.toast).toHaveBeenCalledWith('director.timeline.recordVideoFailed', 'error')
    expect(runtime.store.getState().timeline.currentTime).toBe(0.5)
    expect(runtime.store.getState().videoRecording).toBeNull()
  })

  it('closing the editor invalidates capture work before encoding', async () => {
    const capture = deferred<null>()
    const started = deferred<void>()
    const { api, captureFrame } = OutputsHarness()
    captureFrame.mockImplementation(() => { started.resolve(); return capture.promise })
    const result = api.recordVideo()
    await started.promise
    runtime.cleanups.forEach((cleanup) => cleanup())
    capture.resolve(null)
    expect(await result).toBe(false)
    expect(runtime.persist).not.toHaveBeenCalled()
    expect(runtime.toast).not.toHaveBeenCalled()
  })
})
