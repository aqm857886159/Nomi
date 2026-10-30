import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { dispatchTimelineShortcut } from './timeline/timelineShortcuts'
import { installShortcutSurfaceTracker, resetShortcutSurfaceForTest, shortcutSurfaceMayHandle } from './shortcutSurface'

type FakeSurface = { name: string; offsetParent: object | null; isConnected: boolean; active: boolean; closest(selector: string): FakeSurface | null }

function surface(name: string, shown = true): FakeSurface {
  const value: FakeSurface = { name, offsetParent: shown ? {} : null, isConnected: true, active: shown,
    closest: (selector) => selector.includes('="false"') ? (value.active ? null : value) : value,
  }
  return value
}

/** 一次真的 pointerdown（捕获期），目标落在某一面里（或哪一面都不是）。 */
function pointerDownIn(target: EventTarget, owner: FakeSurface | null): void {
  const event = new Event('pointerdown')
  Object.defineProperty(event, 'target', { value: { closest: () => owner } })
  target.dispatchEvent(event)
}

function modZ(): KeyboardEvent {
  const event = new Event('keydown', { cancelable: true })
  Object.defineProperties(event, {
    key: { value: 'z' }, metaKey: { value: true }, ctrlKey: { value: false }, shiftKey: { value: false },
    target: { value: { closest: () => null } },
  })
  return event as KeyboardEvent
}

const CONTEXT = { hasSelection: false, hasPrimaryClip: false, hasSelectedTextClip: false, splitMode: false }

afterEach(() => resetShortcutSurfaceForTest())

// 单测跑在 node 环境：时间轴的「在输入框里就不认领」判据要用到 HTMLElement，给一个空类即可（假目标都不是它的实例）。
const hadHTMLElement = 'HTMLElement' in globalThis
beforeAll(() => { if (!hadHTMLElement) (globalThis as { HTMLElement?: unknown }).HTMLElement = class {} })
afterAll(() => { if (!hadHTMLElement) delete (globalThis as { HTMLElement?: unknown }).HTMLElement })

describe('shortcut surface ownership', () => {
  it('reported case: after the user clicks the canvas, an expanded timeline no longer swallows ⌘Z', () => {
    const eventWindow = new EventTarget()
    installShortcutSurfaceTracker(eventWindow as Window)
    const canvas = surface('canvas')
    const timeline = surface('timeline')
    pointerDownIn(eventWindow, canvas)

    const onAction = vi.fn()
    const event = modZ()
    expect(dispatchTimelineShortcut(event, CONTEXT, onAction, timeline as unknown as Element)).toBe(false)
    expect(onAction).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(shortcutSurfaceMayHandle(canvas as unknown as Element)).toBe(true)
  })

  it('the surface the pointer last landed in owns shortcuts; the other visible surface yields', () => {
    const eventWindow = new EventTarget()
    installShortcutSurfaceTracker(eventWindow as Window)
    const canvas = surface('canvas') as unknown as Element
    const timeline = surface('timeline') as unknown as Element
    pointerDownIn(eventWindow, timeline as unknown as FakeSurface)
    expect(shortcutSurfaceMayHandle(timeline)).toBe(true)
    expect(shortcutSurfaceMayHandle(canvas)).toBe(false)
    // 落在两面之外（Agent 面板、顶栏）不改归属。
    pointerDownIn(eventWindow, null)
    expect(shortcutSurfaceMayHandle(canvas)).toBe(false)
    pointerDownIn(eventWindow, canvas as unknown as FakeSurface)
    expect(shortcutSurfaceMayHandle(canvas)).toBe(true)
    expect(shortcutSurfaceMayHandle(timeline)).toBe(false)
  })

  it('a hidden surface (keep-alive, display:none) never claims a shortcut, even if it was clicked last', () => {
    const eventWindow = new EventTarget()
    installShortcutSurfaceTracker(eventWindow as Window)
    const hiddenTimeline = surface('timeline', false)
    const canvas = surface('canvas')
    pointerDownIn(eventWindow, hiddenTimeline)
    expect(shortcutSurfaceMayHandle(hiddenTimeline as unknown as Element)).toBe(false)
    // 上一次按下的那一面已经看不见了：不再挡住看得见的那一面。
    expect(shortcutSurfaceMayHandle(canvas as unknown as Element)).toBe(true)
    const onAction = vi.fn()
    expect(dispatchTimelineShortcut(modZ(), CONTEXT, onAction, hiddenTimeline as unknown as Element)).toBe(false)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('a click in the generation list makes the still-visible timeline yield', () => {
    const eventWindow = new EventTarget()
    installShortcutSurfaceTracker(eventWindow as Window)
    const list = surface('generation-list')
    const timeline = surface('timeline')
    pointerDownIn(eventWindow, list)
    expect(shortcutSurfaceMayHandle(timeline as unknown as Element)).toBe(false)
    expect(shortcutSurfaceMayHandle(list as unknown as Element)).toBe(true)
  })

  it('before any pointer lands in a surface, each visible surface keeps its previous behaviour', () => {
    const timeline = surface('timeline') as unknown as Element
    const onAction = vi.fn()
    expect(dispatchTimelineShortcut(modZ(), CONTEXT, onAction, timeline)).toBe(true)
    expect(onAction).toHaveBeenCalledWith({ type: 'undo' })
    expect(shortcutSurfaceMayHandle(null)).toBe(false)
  })
})
