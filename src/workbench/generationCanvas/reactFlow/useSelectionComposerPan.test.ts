import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useSelectionComposerPan } from './useSelectionComposerPan'

vi.mock('./selectionComposerViewport', () => ({
  editingView: () => ({}), selectedEditor: () => ({}), revealEditor: () => ({ zoom: 1, x: 10, y: 10 }),
}))
const mount = useSelectionComposerPan
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['pointerdown', 'wheel', 'viewport', 'deselect', 'uninterrupted'] as const)(
  'a selection owns its two deferred frames and model wait until %s', (gesture) => {
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
    const takeViewport = mount({ current: host }, { current: false }, () => ({ x: 0, y: 0, zoom: 1 }), animate, vi.fn(), false)
    try {
      useGenerationCanvasStore.setState({ nodes: [source, video], edges: [{ id: 'e', source: source.id, target: video.id }], selectedNodeIds: [video.id] })
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
      expect(callbacks.size).toBe(0)
    } finally { dispose!() }
  })
