import React from 'react'

/**
 * 延迟媒体加载的并发队列引擎（非组件逻辑，从 DeferredNodeMedia.tsx 抽出）。
 *
 * 抽出动机：DeferredNodeMedia.tsx 同时导出组件与这些队列/调度/hook 函数，触发
 * react-refresh/only-export-components（fast-refresh 仅当文件只导出组件时生效）。
 * 把非组件逻辑下沉到本 .ts 模块，组件文件回归「只导出组件」，逻辑、行为逐字不动。
 */

export type DeferredNodeMediaKind = 'image' | 'video'

/** Metadata alone has no decoded frame; HAVE_CURRENT_DATA (2) is the first visually safe state. */
export function isDeferredVideoFrameReady(readyState: number): boolean {
  return Number.isFinite(readyState) && readyState >= 2
}

const DEFAULT_MEDIA_LIMITS: Record<DeferredNodeMediaKind, number> = {
  image: 4,
  video: 1,
}
const MEDIA_SLOT_AUTO_RELEASE_MS = 8000
const MEDIA_INTERSECTION_ROOT_MARGIN = '0px'

type DeferredMediaQueueEntry = {
  id: number
  kind: DeferredNodeMediaKind
  activate: (release: () => void) => void
  activated: boolean
  cancelled: boolean
  priority: boolean
  onTimeout?: () => void
  release: (() => void) | null
  autoReleaseTimer: ReturnType<typeof setTimeout> | null
}

export type DeferredNodeMediaSlotRequest = {
  cancel: () => void
  setPriority: (priority: boolean) => void
}

let nextMediaQueueId = 1
const mediaLimits: Record<DeferredNodeMediaKind, number> = { ...DEFAULT_MEDIA_LIMITS }
const activeMediaCounts: Record<DeferredNodeMediaKind, number> = { image: 0, video: 0 }
const mediaQueues: Record<DeferredNodeMediaKind, DeferredMediaQueueEntry[]> = { image: [], video: [] }
const activeMediaEntries = new Set<DeferredMediaQueueEntry>()

function removeQueuedEntry(entry: DeferredMediaQueueEntry): void {
  const queue = mediaQueues[entry.kind]
  const index = queue.indexOf(entry)
  if (index >= 0) queue.splice(index, 1)
}

function sortDeferredMediaQueue(kind: DeferredNodeMediaKind): void {
  mediaQueues[kind].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority ? -1 : 1
    return left.id - right.id
  })
}

function drainDeferredMediaQueue(kind: DeferredNodeMediaKind): void {
  const queue = mediaQueues[kind]
  while (activeMediaCounts[kind] < mediaLimits[kind] && queue.length > 0) {
    const entry = queue.shift()
    if (!entry || entry.cancelled) continue
    entry.activated = true
    activeMediaEntries.add(entry)
    activeMediaCounts[kind] += 1

    let released = false
    const release = () => {
      if (released) return
      released = true
      if (entry.autoReleaseTimer) {
        clearTimeout(entry.autoReleaseTimer)
        entry.autoReleaseTimer = null
      }
      activeMediaEntries.delete(entry)
      activeMediaCounts[kind] = Math.max(0, activeMediaCounts[kind] - 1)
      entry.release = null
      drainDeferredMediaQueue(kind)
    }
    entry.release = release
    entry.autoReleaseTimer = setTimeout(() => {
      if (entry.cancelled) return
      try {
        entry.onTimeout?.()
      } finally {
        release()
      }
    }, MEDIA_SLOT_AUTO_RELEASE_MS)
    entry.activate(release)
  }
}

export function requestDeferredNodeMediaSlot(
  kind: DeferredNodeMediaKind,
  activate: (release: () => void) => void,
  priority = false,
  onTimeout?: () => void,
): DeferredNodeMediaSlotRequest {
  const entry: DeferredMediaQueueEntry = {
    id: nextMediaQueueId,
    kind,
    activate,
    activated: false,
    cancelled: false,
    priority,
    onTimeout,
    release: null,
    autoReleaseTimer: null,
  }
  nextMediaQueueId += 1
  mediaQueues[kind].push(entry)
  sortDeferredMediaQueue(kind)
  drainDeferredMediaQueue(kind)
  return {
    cancel: () => {
      entry.cancelled = true
      if (!entry.activated) removeQueuedEntry(entry)
      entry.release?.()
    },
    setPriority: (nextPriority) => {
      if (entry.cancelled || entry.priority === nextPriority) return
      entry.priority = nextPriority
      if (!entry.activated) sortDeferredMediaQueue(kind)
    },
  }
}

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

export function scheduleAfterCanvasShellPaint(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    const timer = setTimeout(callback, 0)
    return () => clearTimeout(timer)
  }

  const idleWindow = window as IdleCapableWindow
  let cancelled = false
  let firstFrame = 0
  let secondFrame = 0
  let idleHandle: number | null = null
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null

  const run = () => {
    if (cancelled) return
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleHandle = idleWindow.requestIdleCallback(
        () => {
          if (!cancelled) callback()
        },
        { timeout: 350 },
      )
      return
    }
    fallbackTimer = setTimeout(() => {
      if (!cancelled) callback()
    }, 32)
  }

  firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(run)
  })

  return () => {
    cancelled = true
    window.cancelAnimationFrame(firstFrame)
    window.cancelAnimationFrame(secondFrame)
    if (idleHandle !== null && typeof idleWindow.cancelIdleCallback === 'function') {
      idleWindow.cancelIdleCallback(idleHandle)
    }
    if (fallbackTimer) clearTimeout(fallbackTimer)
  }
}

type IntersectionObserverCapableWindow = Window & {
  IntersectionObserver?: typeof IntersectionObserver
}

export function observeDeferredNodeMediaVisibility(
  element: Element | null,
  onVisibilityChange: (visible: boolean) => void,
): () => void {
  const win = typeof window === 'undefined' ? null : (window as IntersectionObserverCapableWindow)
  if (!element || !win?.IntersectionObserver) {
    onVisibilityChange(true)
    return () => {}
  }

  const observer = new win.IntersectionObserver(
    (entries) => {
      onVisibilityChange(entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0))
    },
    {
      root: null,
      rootMargin: MEDIA_INTERSECTION_ROOT_MARGIN,
      threshold: 0,
    },
  )
  observer.observe(element)
  return () => {
    observer.disconnect()
  }
}

/**
 * 「这块区域现在在视口里吗」——等待层用它决定要不要真的跑 WebGL。
 * 复用上面同一个观察器，不为等待层另写一套 IntersectionObserver。
 */
export function useDeferredNodeMediaVisibility(): { ref: (element: HTMLElement | null) => void; visible: boolean } {
  const [visible, setVisible] = React.useState(true)
  const detach = React.useRef<(() => void) | undefined>(undefined)
  const ref = React.useCallback((element: HTMLElement | null) => {
    detach.current?.()
    detach.current = element ? observeDeferredNodeMediaVisibility(element, setVisible) : undefined
  }, [])
  React.useEffect(() => () => detach.current?.(), [])
  return { ref, visible }
}

export type DeferredNodeMediaState = 'idle' | 'queued' | 'loading' | 'ready' | 'error' | 'timeout'

export function useDeferredNodeMediaSrc({
  src,
  kind,
  priority = false,
}: {
  src?: string
  kind: DeferredNodeMediaKind
  priority?: boolean
}): {
  activeSrc: string | null
  readySrc: string | null
  state: DeferredNodeMediaState
  loading: boolean
  placeholderRef: React.RefCallback<HTMLDivElement>
  loadKey: string
  markLoaded: () => boolean
  markFailed: () => boolean
  retry: () => void
} {
  const [activeSrc, setActiveSrc] = React.useState<string | null>(null)
  const [readySrc, setReadySrc] = React.useState<string | null>(null)
  const [state, setState] = React.useState<DeferredNodeMediaState>('idle')
  const [isVisible, setIsVisible] = React.useState(false)
  const [retryToken, setRetryToken] = React.useState(0)
  const [placeholderElement, setPlaceholderElement] = React.useState<HTMLDivElement | null>(null)
  const releaseRef = React.useRef<(() => void) | null>(null)
  const requestRef = React.useRef<DeferredNodeMediaSlotRequest | null>(null)
  const stateRef = React.useRef<DeferredNodeMediaState>('idle')
  const readySrcRef = React.useRef<string | null>(null)
  const activeSrcRef = React.useRef<string | null>(null)
  const priorityRef = React.useRef(priority)
  readySrcRef.current = readySrc
  activeSrcRef.current = activeSrc
  priorityRef.current = priority

  const transitionTo = React.useCallback((nextState: DeferredNodeMediaState) => {
    stateRef.current = nextState
    setState(nextState)
  }, [])

  const releaseSlot = React.useCallback(() => {
    releaseRef.current?.()
    releaseRef.current = null
  }, [])

  React.useEffect(() => {
    releaseSlot()
    requestRef.current?.cancel()
    requestRef.current = null
    setActiveSrc(readySrcRef.current === src ? (src ?? null) : null)
    transitionTo(src && readySrcRef.current === src ? 'ready' : 'idle')
  }, [kind, releaseSlot, src, transitionTo])

  React.useEffect(() => {
    if (!src || !placeholderElement) {
      setIsVisible(false)
      return undefined
    }
    return observeDeferredNodeMediaVisibility(placeholderElement, setIsVisible)
  }, [placeholderElement, src])

  React.useEffect(() => {
    requestRef.current?.setPriority(priority)
  }, [priority])

  React.useEffect(() => {
    if (!src || !isVisible || readySrc === src) return undefined
    if (stateRef.current === 'error' || stateRef.current === 'timeout') return undefined
    let cancelled = false
    let queuedRequest: DeferredNodeMediaSlotRequest | null = null
    transitionTo('queued')
    const cancelPaintWait = scheduleAfterCanvasShellPaint(() => {
      if (cancelled) return
      queuedRequest = requestDeferredNodeMediaSlot(
        kind,
        (release) => {
          if (cancelled) {
            release()
            return
          }
          releaseRef.current = release
          setActiveSrc(src)
          transitionTo('loading')
        },
        priorityRef.current,
        () => {
          if (cancelled || activeSrcRef.current !== src) return
          releaseRef.current = null
          transitionTo('timeout')
        },
      )
      requestRef.current = queuedRequest
    })

    return () => {
      cancelled = true
      cancelPaintWait()
      queuedRequest?.cancel()
      if (requestRef.current === queuedRequest) requestRef.current = null
      releaseSlot()
    }
  }, [isVisible, kind, readySrc, releaseSlot, retryToken, src, transitionTo])

  React.useEffect(() => {
    if (isVisible || !src || readySrc === src) return
    setActiveSrc(null)
    if (stateRef.current === 'queued' || stateRef.current === 'loading') transitionTo('idle')
  }, [isVisible, readySrc, src, transitionTo])

  const placeholderRef = React.useCallback((element: HTMLDivElement | null) => {
    setPlaceholderElement(element)
  }, [])

  const markLoaded = React.useCallback(() => {
    const loadedSrc = activeSrcRef.current
    if (!loadedSrc || loadedSrc !== src || (stateRef.current !== 'loading' && stateRef.current !== 'timeout')) return false
    setReadySrc(loadedSrc)
    transitionTo('ready')
    releaseSlot()
    return true
  }, [releaseSlot, src, transitionTo])

  const markFailed = React.useCallback(() => {
    const failedSrc = activeSrcRef.current
    if (!failedSrc || failedSrc !== src || (stateRef.current !== 'loading' && stateRef.current !== 'ready'))
      return false
    setActiveSrc(null)
    if (readySrcRef.current === failedSrc) setReadySrc(null)
    transitionTo('error')
    releaseSlot()
    return true
  }, [releaseSlot, src, transitionTo])

  const retry = React.useCallback(() => {
    requestRef.current?.cancel()
    requestRef.current = null
    releaseSlot()
    setActiveSrc(null)
    transitionTo('idle')
    setRetryToken((current) => current + 1)
  }, [releaseSlot, transitionTo])

  return {
    activeSrc,
    readySrc,
    state,
    loading: Boolean(src && readySrc !== src && state !== 'error' && state !== 'timeout'),
    placeholderRef,
    loadKey: `${src ?? ''}:${retryToken}`,
    markLoaded,
    markFailed,
    retry,
  }
}

export function __resetDeferredNodeMediaQueueForTests(): void {
  for (const entry of activeMediaEntries) {
    if (entry.autoReleaseTimer) clearTimeout(entry.autoReleaseTimer)
  }
  activeMediaEntries.clear()
  for (const kind of Object.keys(mediaQueues) as DeferredNodeMediaKind[]) {
    for (const entry of mediaQueues[kind]) {
      if (entry.autoReleaseTimer) clearTimeout(entry.autoReleaseTimer)
    }
    mediaQueues[kind] = []
    activeMediaCounts[kind] = 0
    mediaLimits[kind] = DEFAULT_MEDIA_LIMITS[kind]
  }
  nextMediaQueueId = 1
}

export function __setDeferredNodeMediaLimitForTests(kind: DeferredNodeMediaKind, limit: number): void {
  mediaLimits[kind] = Math.max(1, Math.floor(limit))
  drainDeferredMediaQueue(kind)
}
