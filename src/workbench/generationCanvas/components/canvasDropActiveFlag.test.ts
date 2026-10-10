import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_DROP_ACTIVE_ATTRIBUTE, CANVAS_DROP_ACTIVE_CLASS_NAME, CANVAS_DROP_PASS_THROUGH_SELECTORS, watchCanvasDropActive } from './canvasDropActiveFlag'

function fakeStage() {
  const attrs = new Map<string, string>()
  return {
    attrs,
    setAttribute: (key: string, value: string) => attrs.set(key, value),
    removeAttribute: (key: string) => attrs.delete(key),
  } as unknown as HTMLElement & { attrs: Map<string, string> }
}
const dragEvent = (type: string, types: string[]) => Object.assign(new Event(type), { dataTransfer: { types } })

let win: EventTarget & { setTimeout: (fn: () => void, ms: number) => unknown }
let doc: EventTarget & { hidden: boolean }
beforeEach(() => {
  vi.useFakeTimers()
  win = Object.assign(new EventTarget(), { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) })
  doc = Object.assign(new EventTarget(), { hidden: false })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('canvas drop-active flag', () => {
  it('lists every pass-through overlay in the class string', () => {
    for (const selector of CANVAS_DROP_PASS_THROUGH_SELECTORS) expect(CANVAS_DROP_ACTIVE_CLASS_NAME.replaceAll('\\_', '_'), selector).toContain(selector)
  })

  it('raises on an acceptable drag start and ignores other drags', () => {
    const stage = fakeStage()
    watchCanvasDropActive(stage, (types) => types.includes('accept'))
    win.dispatchEvent(dragEvent('dragstart', ['text/plain']))
    vi.runAllTimers()
    expect(stage.attrs.has(CANVAS_DROP_ACTIVE_ATTRIBUTE)).toBe(false)
    win.dispatchEvent(dragEvent('dragstart', ['accept']))
    vi.runAllTimers()
    expect(stage.attrs.get(CANVAS_DROP_ACTIVE_ATTRIBUTE)).toBe('true')
  })

  it.each([
    ['dragend', () => win.dispatchEvent(new Event('dragend'))],
    ['drop', () => win.dispatchEvent(new Event('drop'))],
    ['Escape', () => win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))],
    ['window blur', () => win.dispatchEvent(new Event('blur'))],
    ['page hidden', () => { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')) }],
  ] as const)('drops the flag on %s', (_name, end) => {
    const stage = fakeStage()
    watchCanvasDropActive(stage, () => true)
    win.dispatchEvent(dragEvent('dragstart', ['x']))
    vi.runAllTimers()
    expect(stage.attrs.size).toBe(1)
    end()
    expect(stage.attrs.size).toBe(0)
  })

  it('does not leave the flag up when dragend arrives before the deferred raise', () => {
    const stage = fakeStage()
    watchCanvasDropActive(stage, () => true)
    win.dispatchEvent(dragEvent('dragstart', ['x']))
    win.dispatchEvent(new Event('dragend'))
    vi.runAllTimers()
    expect(stage.attrs.size).toBe(0)
  })

  it('drops the flag and the listeners on unmount', () => {
    const stage = fakeStage()
    const stop = watchCanvasDropActive(stage, () => true)
    win.dispatchEvent(dragEvent('dragstart', ['x']))
    vi.runAllTimers()
    stop()
    expect(stage.attrs.size).toBe(0)
    win.dispatchEvent(dragEvent('dragstart', ['x']))
    vi.runAllTimers()
    expect(stage.attrs.size).toBe(0)
  })
})
