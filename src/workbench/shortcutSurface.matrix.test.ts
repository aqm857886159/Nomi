import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasKeydownHandler } from './generationCanvas/components/useCanvasShortcuts'
import { dispatchTimelineShortcut } from './timeline/timelineShortcuts'
import { canvasWindowInput, cancelCanvasInputGestures, resetShortcutSurfaceForTest, shortcutSurfaceMayHandle } from './shortcutSurface'

const KEYS = [
  { key: 'Delete' }, { key: 'Backspace' }, { key: 'z', metaKey: true },
  { key: 'z', metaKey: true, shiftKey: true }, ...['c', 'x', 'v', 'd', 'a'].map(key => ({ key, metaKey: true })),
]
const HIDES = ['unmounted', 'display:none', 'invisible+inert', 'content-visibility']
const HOSTS = ['canvas', 'generation-timeline', 'preview-timeline']
const body = { matches: () => false, closest: () => null }
beforeEach(() => {
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('document', { body, activeElement: body, querySelector: () => null })
  vi.stubGlobal('window', { getSelection: () => ({ isCollapsed: true }) })
})
afterEach(() => { resetShortcutSurfaceForTest(); vi.unstubAllGlobals() })

function host(active: boolean, hide: string): Element {
  // CSS shape is intentionally independent of the authoritative host declaration.
  const element = {
    isConnected: hide !== 'unmounted', offsetParent: hide === 'display:none' ? null : {},
    style: { visibility: hide === 'invisible+inert' ? 'hidden' : 'visible', contentVisibility: hide === 'content-visibility' ? 'hidden' : 'visible' },
    closest: (selector: string) => selector.includes('="false"') ? (active ? null : element) : element,
    getAttribute: () => active ? 'true' : 'false',
  }
  return element as unknown as Element
}

function keyEvent(input: (typeof KEYS)[number]): KeyboardEvent {
  const event = new Event('keydown', { cancelable: true })
  Object.defineProperties(event, {
    key: { value: input.key }, code: { value: input.key.length === 1 ? `Key${input.key.toUpperCase()}` : input.key },
    metaKey: { value: Boolean('metaKey' in input && input.metaKey) }, ctrlKey: { value: false },
    shiftKey: { value: Boolean('shiftKey' in input && input.shiftKey) }, altKey: { value: false },
    target: { value: body },
  })
  return event as KeyboardEvent
}

const cells = HOSTS.flatMap(name => HIDES.flatMap(hide => KEYS.map(key => ({ name, hide, key }))))
describe('actual shortcut handlers obey host authority across hiding shapes', () => {
  it.each(cells)('$name / $hide / $key', ({ name, hide, key }) => {
    const surface = host(false, hide)
    const effect = vi.fn()
    const event = keyEvent(key)
    if (name === 'canvas') {
      createCanvasKeydownHandler({
        stageRef: { current: surface as HTMLDivElement }, selectedNodeCount: 1, selectedGroupCount: 1, activeCategoryId: 'shots',
        setActiveEdge: effect, cancelConnection: effect, deleteSelectedNodes: effect, groupSelectedNodes: effect,
        ungroupSelectedNodes: effect, copySelectedNodes: effect, cutSelectedNodes: effect, pasteNodes: effect,
        zoomByStep: effect, undo: effect, redo: effect, duplicateSelectedNodes: effect, connectSelectedNodes: effect,
        openAddNodeMenu: effect, tidyCanvas: effect,
      })(event)
    } else {
      dispatchTimelineShortcut(event, { hasSelection: true, hasPrimaryClip: true, hasSelectedTextClip: false, splitMode: false }, effect, surface)
    }
    expect(effect).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
  it.each(HOSTS)('%s: explicit active host is eligible', () => {
    expect(shortcutSurfaceMayHandle(host(true, 'visible'))).toBe(true)
    expect(shortcutSurfaceMayHandle(null)).toBe(false)
  })
})


describe('global pointer/keyboard registrations use the same host authority', () => {
  it.each(['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'paste'])('%s is ignored while hidden and works after activation', (type) => {
    const events = new EventTarget()
    let active = false
    vi.stubGlobal('window', events)
    vi.stubGlobal('document', { querySelector: () => host(active, 'invisible+inert') })
    const callback = vi.fn()
    canvasWindowInput.addEventListener(type, callback)
    events.dispatchEvent(new Event(type))
    expect(callback).not.toHaveBeenCalled()
    active = true
    events.dispatchEvent(new Event(type))
    expect(callback).toHaveBeenCalledOnce()
    canvasWindowInput.removeEventListener(type, callback)
    events.dispatchEvent(new Event(type))
    expect(callback).toHaveBeenCalledOnce()
  })
  it('hiding explicitly interrupts canvas gestures without dispatching blur to unrelated window listeners', () => {
    const events = new EventTarget()
    vi.stubGlobal('window', events)
    const cleanup = vi.fn()
    const unrelated = vi.fn()
    events.addEventListener('blur', unrelated)
    canvasWindowInput.addEventListener('blur', cleanup)
    cancelCanvasInputGestures()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(unrelated).not.toHaveBeenCalled()
    canvasWindowInput.removeEventListener('blur', cleanup)
    cancelCanvasInputGestures()
    expect(cleanup).toHaveBeenCalledOnce()
  })
})
