import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipRect } from '../../scene/pipCamera'

type Effect = { deps: readonly unknown[]; cleanup?: (() => void) | void }
const runtime = vi.hoisted(() => ({
  refs: [] as { current: unknown }[], refIndex: 0, effects: [] as Effect[], effectIndex: 0,
  layoutEffects: [] as (() => void)[], effectsAfterCommit: [] as (() => void)[],
  layout: { left: 14, top: 14, width: 280, collapsed: false }, show: true, camera: true,
}))
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>()
  const schedule = (queue: (() => void)[]) => (setup: () => (() => void) | void, deps: readonly unknown[]) => {
    const index = runtime.effectIndex++; const previous = runtime.effects[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      queue.push(() => { previous?.cleanup?.(); runtime.effects[index] = { deps, cleanup: setup() } })
    }
  }
  return { ...actual, default: { ...actual,
    useRef: (current: unknown) => runtime.refs[runtime.refIndex++] ??= { current },
    useState: () => [runtime.layout, (next: typeof runtime.layout) => { runtime.layout = next }],
    useCallback: (fn: unknown) => fn,
    useLayoutEffect: (...args: Parameters<ReturnType<typeof schedule>>) => schedule(runtime.layoutEffects)(...args),
    useEffect: (...args: Parameters<ReturnType<typeof schedule>>) => schedule(runtime.effectsAfterCommit)(...args),
  } }
})
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../../../../design', () => ({ NomiSelect: 'select', WorkbenchButton: 'button', WorkbenchIconButton: 'button' }))
vi.mock('../../DirectorEditorContext', () => ({
  useDirectorStoreApi: () => ({}),
  useDirectorStore: (select: (state: unknown) => unknown) => select({
    activeScene: () => ({ cameras: runtime.camera ? [{ id: 'camera', fov: 45, focalLengthMm: 29 }] : [] }),
    project: { exportRatio: '16:9' }, activeCameraId: 'free', previewCameraId: 'camera', selection: { cameraId: null },
    timeline: { isPlaying: false, currentTime: 0 }, recording: null,
    isCameraInCloseupAt: () => false, showCameraPreview: runtime.show,
  }),
}))
import { PipViewport } from './PipViewport'

type Element = React.ReactElement<{ children?: React.ReactNode; style?: React.CSSProperties }> & { ref?: { current: unknown } }
function attachChildren(node: React.ReactNode, screen: unknown) {
  if (Array.isArray(node)) { node.forEach((child) => attachChildren(child, screen)); return }
  if (!React.isValidElement(node)) return
  const element = node as Element
  if (element.ref) element.ref.current = screen
  attachChildren(element.props.children, screen)
}
function fixture(hostAlreadyMounted = false) {
  const box = { left: 24, top: 48, width: 280, height: 157.5 }
  const screen = { getBoundingClientRect: () => box }
  const host = { getBoundingClientRect: () => ({ left: 10, top: 20 }) }
  const hostRef = { current: hostAlreadyMounted ? host as HTMLDivElement : null }
  const rectRef = { current: null as PipRect }
  const observers: { callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn(); disconnect = vi.fn()
    constructor(public callback: () => void) { observers.push(this) }
  })
  const render = () => {
    runtime.refIndex = 0; runtime.effectIndex = 0; runtime.layoutEffects = []; runtime.effectsAfterCommit = []
    const element = PipViewport({ rectRef, canvasHostRef: hostRef })
    runtime.refs.forEach((ref) => { ref.current = null }); attachChildren(element, screen)
    // React 18 visits child layout effects before attaching the outer HostComponent ref.
    runtime.layoutEffects.forEach((effect) => effect()); hostRef.current = host as HTMLDivElement
    runtime.effectsAfterCommit.forEach((effect) => effect())
  }
  return { rectRef, observers, render, box }
}
beforeEach(() => {
  runtime.refs = []; runtime.effects = []; runtime.show = true; runtime.camera = true
  runtime.layout = { left: 14, top: 14, width: 280, collapsed: false }
})
afterEach(() => { runtime.effects.forEach((effect) => effect.cleanup?.()); vi.unstubAllGlobals() })

describe('PiP committed screen and rectangle lifetime', () => {
  it('measures a camera present at cold mount after the parent host ref attaches', () => {
    const view = fixture(); view.render()
    expect(view.rectRef.current).toEqual({ x: 14, y: 28, width: 280, height: 157.5 })
    expect(view.observers).toHaveLength(1); expect(view.observers[0].observe).toHaveBeenCalledTimes(2)
  })
  it('measures when the first camera is added after an empty scene', () => {
    const view = fixture(); runtime.camera = false; view.render(); expect(view.rectRef.current).toBeNull()
    runtime.camera = true; view.render(); expect(view.rectRef.current?.width).toBe(280)
  })
  it('measures an initially hidden preview when it becomes visible', () => {
    const view = fixture(); runtime.show = false; view.render(); expect(view.rectRef.current).toBeNull()
    runtime.show = true; view.render(); expect(view.rectRef.current?.width).toBe(280)
  })
  it('releases the old screen on hide and acquires the new screen on show', () => {
    const view = fixture(true); view.render(); const old = view.observers[0]
    runtime.show = false; view.render(); expect(view.rectRef.current).toBeNull(); expect(old.disconnect).toHaveBeenCalledOnce()
    view.box.width = 320; runtime.show = true; view.render()
    expect(view.rectRef.current?.width).toBe(320); expect(view.observers).toHaveLength(2)
  })
  it('tracks resize, clears collapsed screens and releases the expanded observer on unmount', () => {
    const view = fixture(true); view.render(); view.box.width = 400; view.observers[0].callback()
    expect(view.rectRef.current?.width).toBe(400)
    runtime.layout = { ...runtime.layout, collapsed: true }; view.render(); expect(view.rectRef.current).toBeNull()
    runtime.layout = { ...runtime.layout, collapsed: false }; view.render(); expect(view.rectRef.current?.width).toBe(400)
    runtime.effects.forEach((effect) => effect.cleanup?.()); runtime.effects = []
    expect(view.rectRef.current).toBeNull(); expect(view.observers[1].disconnect).toHaveBeenCalledOnce()
  })
})
