import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDeferredNodeMediaQueueForTests,
  __setDeferredNodeMediaLimitForTests,
  observeDeferredNodeMediaVisibility,
  requestDeferredNodeMediaSlot,
} from './deferredNodeMediaQueue'

describe('deferred node media queue', () => {
  afterEach(() => {
    __resetDeferredNodeMediaQueueForTests()
    vi.unstubAllGlobals()
  })

  it('limits image activation until an active slot is released', () => {
    __setDeferredNodeMediaLimitForTests('image', 2)
    const activated: string[] = []
    const releases: Array<() => void> = []

    requestDeferredNodeMediaSlot('image', (release) => {
      activated.push('first')
      releases.push(release)
    })
    requestDeferredNodeMediaSlot('image', (release) => {
      activated.push('second')
      releases.push(release)
    })
    requestDeferredNodeMediaSlot('image', (release) => {
      activated.push('third')
      releases.push(release)
    })

    expect(activated).toEqual(['first', 'second'])

    releases[0]()

    expect(activated).toEqual(['first', 'second', 'third'])
  })

  it('lets priority media move ahead of queued normal media', () => {
    __setDeferredNodeMediaLimitForTests('image', 1)
    const activated: string[] = []
    const releases: Array<() => void> = []

    requestDeferredNodeMediaSlot('image', (release) => {
      activated.push('active')
      releases.push(release)
    })
    requestDeferredNodeMediaSlot('image', (release) => {
      activated.push('normal')
      releases.push(release)
    })
    requestDeferredNodeMediaSlot(
      'image',
      (release) => {
        activated.push('priority')
        releases.push(release)
      },
      true,
    )

    releases[0]()

    expect(activated).toEqual(['active', 'priority'])
  })

  it('keeps video activation on its own lower concurrency lane', () => {
    __setDeferredNodeMediaLimitForTests('image', 2)
    __setDeferredNodeMediaLimitForTests('video', 1)
    const activated: string[] = []

    requestDeferredNodeMediaSlot('video', () => {
      activated.push('video-1')
    })
    requestDeferredNodeMediaSlot('video', () => {
      activated.push('video-2')
    })
    requestDeferredNodeMediaSlot('image', () => {
      activated.push('image-1')
    })

    expect(activated).toEqual(['video-1', 'image-1'])
  })

  it('waits for IntersectionObserver visibility before activating media', () => {
    let observerCallback: IntersectionObserverCallback | null = null
    const disconnect = vi.fn()
    const observe = vi.fn()
    class FakeIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback
      }

      observe = observe
      disconnect = disconnect
    }
    vi.stubGlobal('window', { IntersectionObserver: FakeIntersectionObserver })
    const onVisible = vi.fn()
    const element = {} as Element

    const cleanup = observeDeferredNodeMediaVisibility(element, onVisible)

    expect(observe).toHaveBeenCalledWith(element)
    expect(onVisible).not.toHaveBeenCalled()

    observerCallback?.([{ isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(onVisible).not.toHaveBeenCalled()

    observerCallback?.([{ isIntersecting: true, intersectionRatio: 0 } as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(onVisible).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)

    observerCallback?.([{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(onVisible).toHaveBeenCalledTimes(1)

    cleanup()
  })

  it('falls back to immediate activation when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('window', {})
    const onVisible = vi.fn()

    observeDeferredNodeMediaVisibility({} as Element, onVisible)

    expect(onVisible).toHaveBeenCalledTimes(1)
  })
})
