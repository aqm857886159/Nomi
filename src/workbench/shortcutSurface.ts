/**
 * 键盘快捷键归哪一面（2026-09-22，核心冒烟「用过的项目」夹具当场抓到）。
 *
 * 生成页上画布和时间轴同时可见时，两边都在 window 上监听 keydown，而且都认领 ⌘Z / Delete。
 * 谁先注册谁赢：时间轴一展开（或者用户去过一次预览页，keep-alive 的那条时间轴还挂着），
 * 在画布上删了东西按 ⌘Z，撤的是时间轴，画布上删掉的编组框回不来。
 *
 * 不变量（唯一 owner 就是这个文件）：
 *   1. 看不见的面不认领任何快捷键（keep-alive 藏起来的那条时间轴不许吃键）。
 *   2. 同屏有两面时，最近一次指针落在哪一面，快捷键就归哪一面；落在别处（Agent 面板、顶栏）不改归属。
 *   3. 还没在任何一面上按过指针时，维持各面原来的行为（不凭空改变没有冲突的场景）。
 *
 * 面的标记：根元素上写 `data-shortcut-surface="<名字>"`。
 */

export const SHORTCUT_SURFACE_ATTRIBUTE = 'data-shortcut-surface'

let lastPointerSurface: Element | null = null
let installedOn: Window | null = null

function recordPointer(event: Event): void {
  const target = event.target as Partial<Element> | null
  if (typeof target?.closest !== 'function') return
  const surface = target.closest(`[${SHORTCUT_SURFACE_ATTRIBUTE}]`)
  if (workspaceInputSurfaceIsActive(surface)) lastPointerSurface = surface
}

/** 幂等：同一个 window 只装一次，捕获期记录，任何浮层 stopPropagation 都挡不住。 */
export function installShortcutSurfaceTracker(target: Window = window): void {
  if (installedOn === target) return
  installedOn?.removeEventListener('pointerdown', recordPointer, true)
  target.addEventListener('pointerdown', recordPointer, true)
  installedOn = target
}

/** Host state is authoritative; CSS layout/visibility is never used to infer input ownership. */
export function workspaceInputAttributes(active: boolean): { 'data-workspace-input-active': 'true' | 'false' } {
  return { 'data-workspace-input-active': active ? 'true' : 'false' }
}

export function workspaceInputSurfaceIsActive(element: Element | null): boolean {
  return Boolean(element && element.isConnected !== false
    && element.closest('[data-workspace-input-active="true"]')
    && !element.closest('[data-workspace-input-active="false"]'))
}

/** A missing surface or a hidden host never claims input; selection is left intact. */
export function shortcutSurfaceMayHandle(surface: Element | null): boolean {
  if (!workspaceInputSurfaceIsActive(surface)) return false
  const last = lastPointerSurface
  return !(last && last !== surface && workspaceInputSurfaceIsActive(last))
}

export function canvasSurfaceMayHandleInput(): boolean {
  return typeof document !== 'undefined'
    && workspaceInputSurfaceIsActive(document.querySelector('[data-shortcut-surface="canvas"]'))
}

const canvasGestureCleanups = new Set<EventListenerOrEventListenerObject>()

/** Hiding the host explicitly interrupts its in-progress gestures; no input is fabricated on window. */
export function cancelCanvasInputGestures(): void {
  const interrupted = new Event('blur')
  for (const listener of [...canvasGestureCleanups]) {
    if (typeof listener === 'function') listener.call(window, interrupted)
    else listener.handleEvent(interrupted)
  }
}

/** Native listener lifecycle, with the same explicit canvas host authority for every global input consumer. */
function canvasInputEvents(target: () => EventTarget): Pick<Window, 'addEventListener' | 'removeEventListener'> {
  const wrappers = new WeakMap<EventListenerOrEventListenerObject, EventListener>()
  const wrapped = (listener: EventListenerOrEventListenerObject): EventListener => {
    let value = wrappers.get(listener)
    if (!value) {
      value = (event) => {
        if (!canvasSurfaceMayHandleInput()) return
        if (typeof listener === 'function') listener.call(target(), event)
        else listener.handleEvent(event)
      }
      wrappers.set(listener, value)
    }
    return value
  }
  return {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type === 'blur') canvasGestureCleanups.add(listener)
      target().addEventListener(type, type === 'blur' ? listener : wrapped(listener), options)
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
      if (type === 'blur') canvasGestureCleanups.delete(listener)
      const value = type === 'blur' ? listener : wrappers.get(listener)
      if (value) target().removeEventListener(type, value, options)
    },
  } as Pick<Window, 'addEventListener' | 'removeEventListener'>
}

export const canvasWindowInput = canvasInputEvents(() => window)
export const canvasDocumentInput = canvasInputEvents(() => document)

/** 仅供单测：回到「还没按过指针」。 */
export function resetShortcutSurfaceForTest(): void {
  lastPointerSurface = null
}
