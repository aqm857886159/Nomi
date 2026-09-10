import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDirectorStore } from './model/directorStore'
import type { CaptureFrameRequest, ViewportApi, ViewportApiRef } from './scene/ViewportApiContext'
import { startMobilePreview } from './useMobilePreview'

afterEach(() => vi.useRealTimers())

describe('mobile monitor capture lifetime', () => {
  it('has one capture in flight, caps dimensions, and discards a late frame after detach', async () => {
    vi.useFakeTimers()
    let resolve!: (image: { blob: Blob; dataUrl: string; width: number; height: number }) => void
    const pending = new Promise<{ blob: Blob; dataUrl: string; width: number; height: number }>((done) => { resolve = done })
    const captureFrame = vi.fn((_request: CaptureFrameRequest) => pending)
    const api = { captureFrame, getViewportSize: () => ({ width: 1200, height: 900 }) } as unknown as ViewportApi
    const feedback = vi.fn(async () => true)
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    store.setState({ activeCameraId: 'camera' })
    const stop = startMobilePreview(store, { current: api }, feedback)
    await vi.advanceTimersByTimeAsync(2000)
    expect(captureFrame).toHaveBeenCalledTimes(1)
    expect(captureFrame.mock.calls[0]?.[0]).toMatchObject({ width: 480, height: 270 })
    stop()
    resolve({ blob: new Blob(['png']), dataUrl: '', width: 480, height: 270 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(feedback).not.toHaveBeenCalled()
    expect(captureFrame).toHaveBeenCalledTimes(1)
  })

  it('never queues another capture behind a pending transfer and excludes oversized frames', async () => {
    vi.useFakeTimers()
    let release!: (value: boolean) => void
    const transfer = new Promise<boolean>((done) => { release = done })
    const feedback = vi.fn(() => transfer)
    const captureFrame = vi.fn(async () => ({ blob: new Blob([new Uint8Array(1024 * 1024 + 1)]), dataUrl: '', width: 1, height: 1 }))
    const apiRef = { current: { captureFrame, getViewportSize: () => ({ width: 600, height: 900 }) } } as unknown as ViewportApiRef
    const stop = startMobilePreview(createDirectorStore({ defaultSceneName: 'S1' }), apiRef, feedback)
    await vi.advanceTimersByTimeAsync(2000)
    expect(captureFrame).toHaveBeenCalledTimes(1)
    expect(feedback).toHaveBeenCalledWith({ recording: false, frame: undefined })
    stop()
    release(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(captureFrame).toHaveBeenCalledTimes(1)
  })
})
