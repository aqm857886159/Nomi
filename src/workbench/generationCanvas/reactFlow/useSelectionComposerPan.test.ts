import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useCanvasEditingFit, useSelectionComposerPan } from './useSelectionComposerPan'

const { flowMock } = vi.hoisted(() => ({
  flowMock: {
    getNodesBounds: () => ({ x: 80, y: 80, width: 3800, height: 2600 }),
    getNodes: () => [],
    getViewport: () => ({ x: 0, y: 0, zoom: 0.22 }),
    setViewport: vi.fn(),
  },
}))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    useReactFlow: () => flowMock,
    useStoreApi: () => ({ getState: () => ({ nodeLookup: new Map([['idle', {}]]) }) }),
  }
})

vi.mock('./selectionComposerViewport', async (importOriginal) => ({
  ...await importOriginal<typeof import('./selectionComposerViewport')>(),
  editingView: () => ({ left: 0, top: 0, width: 750, height: 580 }),
  selectedEditor: () => ({
    node: { x: 800, y: 80, width: 420, height: 420 },
    composer: { width: 600, height: 220, gap: 12 },
  }),
}))
const mount = useSelectionComposerPan
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function setupSelection() {
  const callbacks = new Map<number, () => void>()
  let sequence = 0
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { callbacks.set(++sequence, cb); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  const tick = () => { for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback() } }
  vi.spyOn(React, 'useRef').mockImplementation(current => ({ current }))
  vi.spyOn(React, 'useCallback').mockImplementation(cb => cb)
  let dispose: void | (() => void)
  vi.spyOn(React, 'useEffect').mockImplementation(effect => { dispose = effect() })
  const host = Object.assign(new EventTarget(), { dataset: {} }) as unknown as HTMLDivElement
  const animate = vi.fn()
  const source = { id: 'image', kind: 'image' as const, title: '', position: { x: 0, y: 0 } }
  const video = { ...source, id: 'video', kind: 'video' as const }
  useGenerationCanvasStore.setState({ nodes: [source], edges: [], selectedNodeIds: [] })
  const takeViewport = mount({ current: host }, { current: [source] }, { current: false },
    () => ({ x: 0, y: 0, zoom: 1 }), animate, vi.fn(), false)
  return { callbacks, tick, host, animate, source, video, takeViewport, dispose: () => dispose?.() }
}

it.each(['pointerdown', 'wheel', 'viewport', 'deselect', 'uninterrupted'] as const)(
  'a selection owns its two deferred frames and model wait until %s', (gesture) => {
    const { callbacks, tick, host, animate, source, video, takeViewport, dispose } = setupSelection()
    try {
      // The right ring and image toolbar connect the new card synchronously after selecting it.
      useGenerationCanvasStore.setState({ nodes: [source, video], selectedNodeIds: [video.id] })
      useGenerationCanvasStore.setState({ edges: [{ id: 'e', source: source.id, target: video.id }] })
      if (gesture !== 'pointerdown') { tick(); tick() } // The derived video now awaits its model.
      expect(callbacks.size).toBe(1)
      if (gesture === 'viewport') takeViewport()
      if (gesture === 'deselect') useGenerationCanvasStore.setState({ selectedNodeIds: [] })
      if (gesture === 'wheel' || gesture === 'pointerdown') host.dispatchEvent(new Event(gesture))
      useGenerationCanvasStore.setState({ nodes: [source, { ...video, meta: { modelKey: 'ready' } }] })
      tick()
      useGenerationCanvasStore.setState({ nodes: [{ ...source, title: 'edited' }, video] })
      tick()
      expect(animate).toHaveBeenCalledTimes(gesture === 'uninterrupted' ? 1 : 0)
      if (gesture === 'uninterrupted') expect(animate.mock.calls[0]![0]).toBeLessThan(1)
      expect(callbacks.size).toBe(0)
    } finally { dispose() }
  })

it.each(['image', 'video'] as const)('keeps the viewport still when a standalone %s box overflows', (kind) => {
  const { callbacks, tick, animate, source, video, dispose } = setupSelection()
  const added = { ...video, kind, meta: { modelKey: 'ready' } }
  try {
    if (kind === 'image') {
      // Imports can add an unselected card and select it in separate writes before rendering.
      useGenerationCanvasStore.setState({ nodes: [source, added] })
      useGenerationCanvasStore.setState({ selectedNodeIds: [added.id] })
    } else {
      useGenerationCanvasStore.setState({ nodes: [source, added], selectedNodeIds: [added.id] })
    }
    tick()
    // An edge arriving after the first frame must not grant the insertion a reveal.
    if (kind === 'video') useGenerationCanvasStore.setState({ edges: [{ id: 'late', source: source.id, target: added.id }] })
    tick()
    tick()
    expect(animate).not.toHaveBeenCalled()
    expect(callbacks.size).toBe(0)
  } finally { dispose() }
})

it('pans an existing, previously unselected overflowing card once at its current zoom', () => {
  const { callbacks, tick, animate, source, dispose } = setupSelection()
  try {
    useGenerationCanvasStore.setState({ selectedNodeIds: [source.id] })
    tick()
    tick()
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate).toHaveBeenCalledWith(1, { x: expect.any(Number), y: expect.any(Number), zoom: 1 }, 200, expect.any(Function))
    useGenerationCanvasStore.setState({ selectedNodeIds: [source.id], nodes: [{ ...source, title: 'edit' }] })
    tick()
    expect(animate).toHaveBeenCalledTimes(1)
    expect(callbacks.size).toBe(0)
  } finally { dispose() }
})

it('reserves composer bounds only during opening fit and keeps manual fitView on full-canvas 0.12 padding', () => {
  vi.spyOn(React, 'useRef').mockImplementation(current => ({ current }))
  vi.spyOn(React, 'useCallback').mockImplementation(cb => cb)
  vi.spyOn(React, 'useEffect').mockImplementation(() => undefined)
  flowMock.setViewport.mockClear()
  const host = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 933 }),
    querySelector: () => null,
    querySelectorAll: () => [],
  } as unknown as HTMLDivElement
  const selected = { id: 'idle', kind: 'video' as const, title: '', position: { x: 80, y: 80 }, size: { width: 384, height: 404 } }
  useGenerationCanvasStore.setState({ nodes: [selected], edges: [], selectedNodeIds: [selected.id] })
  const fitView = useCanvasEditingFit({
    hostRef: { current: host },
    nodes: [selected] as never,
    nodeById: new Map([[selected.id, selected as never]]),
    groupBoxes: [],
    activeCategoryId: 'shots',
    hasRememberedViewport: true,
    ready: true,
    readOnly: false,
    zoomRange: [0.2, 3],
    draggingRef: { current: false },
    zoomRef: { current: 1 },
    offsetRef: { current: { x: 0, y: 0 } },
    animateViewportTo: vi.fn(),
    cancelViewportAnimation: vi.fn(),
  })
  fitView(false, false)
  fitView(false, true)
  expect(flowMock.setViewport).toHaveBeenCalledTimes(2)
  const manual = flowMock.setViewport.mock.calls[0]![0] as { x: number; y: number; zoom: number }
  const opening = flowMock.setViewport.mock.calls[1]![0] as { x: number; y: number; zoom: number }
  expect(manual.y).toBeGreaterThan(opening.y)
})
