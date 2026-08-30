import { describe, expect, it, vi } from 'vitest'
import { createPanZoomTakeoverReconciler } from './panZoomTakeoverReconciler'

function frameHarness() {
  const frames = new Map<number, FrameRequestCallback>()
  let nextId = 1
  return {
    frames,
    requestFrame(callback: FrameRequestCallback) {
      const id = nextId++
      frames.set(id, callback)
      return id
    },
    cancelFrame(id: number) {
      frames.delete(id)
    },
    run() {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined
      if (!entry) throw new Error('expected a queued frame')
      frames.delete(entry[0])
      entry[1](0)
    },
  }
}

describe('panZoomTakeoverReconciler', () => {
  it('converges a concurrent native pan without applying the pointer delta twice', () => {
    const frames = frameHarness()
    let viewport = { x: 100, y: 60, zoom: 1.4 }
    const writeViewport = vi.fn((next) => { viewport = next })
    const reconciler = createPanZoomTakeoverReconciler({
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      readViewport: () => viewport,
      writeViewport,
    })

    reconciler.queueDelta({ x: 10, y: 0 })
    viewport = { x: 110, y: 60, zoom: 1.4 }
    frames.run()

    expect(viewport).toEqual({ x: 110, y: 60, zoom: 1.4 })
    expect(writeViewport).toHaveBeenCalledOnce()
  })

  it('overrides a stale native baseline and accumulates multiple moves into one frame', () => {
    const frames = frameHarness()
    let viewport = { x: 100, y: 60, zoom: 1.4 }
    const reconciler = createPanZoomTakeoverReconciler({
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      readViewport: () => viewport,
      writeViewport: (next) => { viewport = next },
    })

    reconciler.queueDelta({ x: 4, y: -2 })
    reconciler.queueDelta({ x: 6, y: 2 })
    viewport = { x: -300, y: -200, zoom: 1.4 }
    frames.run()

    expect(viewport).toEqual({ x: 110, y: 60, zoom: 1.4 })
    expect(frames.frames.size).toBe(0)
  })

  it('flushes the final target synchronously before pointer-end persistence', () => {
    const frames = frameHarness()
    let viewport = { x: 20, y: 30, zoom: 1.2 }
    const reconciler = createPanZoomTakeoverReconciler({
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      readViewport: () => viewport,
      writeViewport: (next) => { viewport = next },
    })

    reconciler.queueDelta({ x: 5, y: 7 })
    expect(reconciler.flush()).toEqual({ x: 25, y: 37, zoom: 1.2 })
    expect(viewport).toEqual({ x: 25, y: 37, zoom: 1.2 })
    expect(frames.frames.size).toBe(0)
  })
})
