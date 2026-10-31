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
 *   4. 上面盖着模态的面什么都不接（层级优先）。键盘事件永远打到焦点元素再冒泡到 window，原生 inert 也拦不住，所以只能在这里判；
 *      开关的事实归 design/modalInputLayer.ts（宿主登记，不查 DOM），判断只有 workspaceInputSurfaceIsActive 这一处。
 *
 * 面的标记：根元素上写 `data-shortcut-surface="<名字>"`。
 */
import { modalInputLayerCovers, onModalInputLayerOpened } from '../design/modalInputLayer'
import { cancelCanvasDraggingWithin } from './generationCanvas/components/canvasDraggingFlag'

export const SHORTCUT_SURFACE_ATTRIBUTE = 'data-shortcut-surface'

let lastPointerSurface: Element | null = null
let installedOn: Window | null = null

function recordPointer(event: Event): void {
  const target = event.target as Partial<Element> | null
  if (typeof target?.closest !== 'function') return
  const surface = target.closest(`[${SHORTCUT_SURFACE_ATTRIBUTE}]`)
  if (workspaceInputSurfaceIsActive(surface)) lastPointerSurface = surface
}

const EDITING_DEFAULT_KEYS = new Set(['a', 'z', 'y'])

/**
 * 面不接 Cmd+A / Cmd+Z 之后，默认动作就落到了浏览器头上：全选把框后面的字都选中（关掉弹层选区还在，下一个 Cmd+C 复制的就成了
 * 这些字）；撤销、重做的栈整页一个，焦点在按钮上也会撤掉框后面输入框里刚打的字（Electron 43 实测）。
 * 所以目标被层盖着、焦点不在输入框里、这一下又没有哪个露着的面要接时，这几个默认动作不发生。
 */
function cancelEditingDefaultUnderLayer(raw: Event): void {
  const event = raw as KeyboardEvent
  if (!(event.metaKey || event.ctrlKey) || event.altKey || !EDITING_DEFAULT_KEYS.has(event.key.toLowerCase())) return
  const target = event.target as Partial<Element> | null
  if (typeof target?.closest !== 'function') return
  if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return
  if (!modalInputLayerCovers(target as Element)) return
  if ([...document.querySelectorAll(`[${SHORTCUT_SURFACE_ATTRIBUTE}]`)].some(shortcutSurfaceMayHandle)) return
  event.preventDefault()
}

/** 幂等：同一个 window 只装一次，捕获期记录，任何浮层 stopPropagation 都挡不住。 */
export function installShortcutSurfaceTracker(target: Window = window): void {
  if (installedOn === target) return
  installedOn?.removeEventListener('pointerdown', recordPointer, true)
  installedOn?.removeEventListener('keydown', cancelEditingDefaultUnderLayer)
  target.addEventListener('pointerdown', recordPointer, true)
  target.addEventListener('keydown', cancelEditingDefaultUnderLayer)
  installedOn = target
}

/** Host state is authoritative; CSS layout/visibility is never used to infer input ownership. */
export function workspaceInputAttributes(active: boolean): { 'data-workspace-input-active': 'true' | 'false' } {
  return { 'data-workspace-input-active': active ? 'true' : 'false' }
}

function hostDeclaresActive(element: Element | null): boolean {
  return Boolean(element && element.isConnected !== false
    && element.closest('[data-workspace-input-active="true"]')
    && !element.closest('[data-workspace-input-active="false"]'))
}

/** 有输入权 = 宿主让它在前台，且上面没盖着模态。层级优先只有这一条规则，所有面都从这里继承。 */
export function workspaceInputSurfaceIsActive(element: Element | null): boolean {
  return Boolean(element && hostDeclaresActive(element) && !modalInputLayerCovers(element))
}

/** A missing surface or a hidden host never claims input; selection is left intact. */
export function shortcutSurfaceMayHandle(surface: Element | null): boolean {
  if (!workspaceInputSurfaceIsActive(surface)) return false
  const last = lastPointerSurface
  // 归属只看宿主，不看盖没盖：最近按在被灯箱盖住的画布上时，这一下不转给旁边没被盖的时间轴。
  return !(last && last !== surface && hostDeclaresActive(last))
}

const canvasSurface = (): Element | null => document.querySelector('[data-shortcut-surface="canvas"]')

export function canvasSurfaceMayHandleInput(): boolean {
  return typeof document !== 'undefined' && workspaceInputSurfaceIsActive(canvasSurface())
}

/**
 * 盖在画布格上的模态层（灯箱）自己接键盘：画布宿主在前台（切页、切列表时不接，不吞别的页的 Esc），且它就是最上面那层。
 * 不能走 canvasWindowInput：那扇门问的是「画布能不能接」，灯箱开着时答案永远是否。
 */
export function canvasLayerMayHandleInput(isTopLayer: () => boolean): boolean {
  return typeof document !== 'undefined' && hostDeclaresActive(canvasSurface()) && isTopLayer()
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

// 弹层开在手势中途：和「宿主把面藏起来」走同一条打断，不写第二套收尾。盖住哪块才打断哪块，灯箱开着时时间轴上的手势继续。
onModalInputLayerOpened((covers) => {
  cancelCanvasDraggingWithin(covers ?? document.documentElement)
  if (!canvasSurfaceMayHandleInput()) cancelCanvasInputGestures()
})

/** 仅供单测：回到「还没按过指针」。 */
export function resetShortcutSurfaceForTest(): void {
  lastPointerSurface = null
}
