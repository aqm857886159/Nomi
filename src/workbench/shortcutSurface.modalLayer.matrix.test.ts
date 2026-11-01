// 层级优先矩阵：模态弹层开 / 关 × 各工作区面 × 六个键（设计卡 docs/plan/2026-10-31-modal-input-priority.md ★9）。
// 跑的是真实的按键处理函数，只有宿主元素是假的；挡住的格子配了「没挡时真的有效果」的正向格，按键没绑和按键被挡不会长得一样。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openModalInputLayer, type ModalInputLayerHandle } from '../design/modalInputLayer'
import { beginCanvasDragging, CANVAS_DRAGGING_OWNER } from './generationCanvas/components/canvasDraggingFlag'
import { createCanvasKeydownHandler } from './generationCanvas/components/useCanvasShortcuts'
import { useGenerationCanvasStore } from './generationCanvas/store/generationCanvasStore'
import { dispatchTimelineShortcut, isTimelineShortcutsHelpKey } from './timeline/timelineShortcuts'
import {
  canvasLayerMayHandleInput,
  canvasWindowInput,
  installShortcutSurfaceTracker,
  resetShortcutSurfaceForTest,
  shortcutSurfaceMayHandle,
  workspaceInputSurfaceIsActive,
} from './shortcutSurface'

type KeyCell = { name: string; input: { key: string; metaKey?: boolean; shiftKey?: boolean }; canvas: string; timeline: string | null }

/** timeline：时间轴上这个键对应的动作；null = 时间轴本来就没绑（Cmd+A / Cmd+V 只归画布）。 */
const KEYS: readonly KeyCell[] = [
  { name: 'Delete', input: { key: 'Delete' }, canvas: 'delete', timeline: 'remove-selection' },
  { name: 'Backspace', input: { key: 'Backspace' }, canvas: 'delete', timeline: 'remove-selection' },
  { name: 'Cmd+Z', input: { key: 'z', metaKey: true }, canvas: 'undo', timeline: 'undo' },
  { name: 'Cmd+Shift+Z', input: { key: 'z', metaKey: true, shiftKey: true }, canvas: 'redo', timeline: 'redo' },
  { name: 'Cmd+A', input: { key: 'a', metaKey: true }, canvas: 'selectAll', timeline: null },
  { name: 'Cmd+V', input: { key: 'v', metaKey: true }, canvas: 'paste', timeline: null },
]
const TIMELINES = ['generation-timeline', 'preview-timeline'] as const

function host(active = true): Element {
  const element = {
    isConnected: true,
    closest: (selector: string) => selector.includes('="false"') ? (active ? null : element) : element,
  }
  return element as unknown as Element
}

const body = { matches: () => false, closest: () => null }
let canvas: Element
let list: Element
let previewPanel: Element
let timelines: Record<(typeof TIMELINES)[number], Element>
/** 灯箱盖的那一格：画布和列表在格子里，时间轴在格子外（GenerationWorkspace 的真实结构）。 */
let cell: Element
const opened: ModalInputLayerHandle[] = []
const openLayer = (covers: Element | null = null): ModalInputLayerHandle => {
  const handle = openModalInputLayer(covers)
  opened.push(handle)
  return handle
}

beforeEach(() => {
  canvas = host()
  list = host()
  previewPanel = host()
  timelines = { 'generation-timeline': host(), 'preview-timeline': host() }
  cell = { contains: (element: Element) => element === canvas || element === list } as unknown as Element
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('document', {
    body,
    activeElement: body,
    documentElement: { contains: () => true },
    querySelector: (selector: string) => selector.includes('data-shortcut-surface="canvas"') ? canvas : null,
    querySelectorAll: () => [canvas, timelines['generation-timeline'], timelines['preview-timeline']],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })
  vi.stubGlobal('window', Object.assign(new EventTarget(), { getSelection: () => ({ isCollapsed: true }) }))
})

afterEach(() => {
  opened.splice(0).forEach((handle) => handle.close())
  resetShortcutSurfaceForTest()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function keyEvent(input: KeyCell['input'], target: unknown = body): KeyboardEvent {
  const event = new Event('keydown', { cancelable: true })
  Object.defineProperties(event, {
    key: { value: input.key }, code: { value: input.key.length === 1 ? `Key${input.key.toUpperCase()}` : input.key },
    metaKey: { value: Boolean(input.metaKey) }, ctrlKey: { value: false },
    shiftKey: { value: Boolean(input.shiftKey) }, altKey: { value: false },
    target: { value: target },
  })
  return event as KeyboardEvent
}

function pressCanvas(key: KeyCell): { effects: string[]; prevented: boolean } {
  const effects: string[] = []
  const record = (name: string) => () => { effects.push(name) }
  vi.spyOn(useGenerationCanvasStore.getState(), 'selectAllNodes').mockImplementation(record('selectAll'))
  const event = keyEvent(key.input)
  createCanvasKeydownHandler({
    stageRef: { current: canvas as HTMLDivElement }, selectedNodeCount: 1, selectedGroupCount: 1, activeCategoryId: 'shots',
    setActiveEdge: record('setActiveEdge'), cancelConnection: record('cancelConnection'), deleteSelectedNodes: record('delete'),
    groupSelectedNodes: record('group'), ungroupSelectedNodes: record('ungroup'), copySelectedNodes: record('copy'), cutSelectedNodes: record('cut'),
    pasteNodes: record('paste'), zoomByStep: record('zoom'), undo: record('undo'), redo: record('redo'), duplicateSelectedNodes: record('duplicate'),
    connectSelectedNodes: record('connect'), openAddNodeMenu: record('addMenu'), tidyCanvas: record('tidy'),
  })(event)
  return { effects, prevented: event.defaultPrevented }
}

function pressTimeline(key: KeyCell, surface: Element): { effects: string[]; prevented: boolean } {
  const effects: string[] = []
  const event = keyEvent(key.input)
  dispatchTimelineShortcut(event, { hasSelection: true, hasPrimaryClip: true, hasSelectedTextClip: false, splitMode: false }, (action) => { effects.push(action.type) }, surface)
  return { effects, prevented: event.defaultPrevented }
}

function pointerTracker(): (surface: Element) => void {
  const listeners = new Map<string, EventListener>()
  installShortcutSurfaceTracker({
    addEventListener: (type: string, listener: EventListener) => { listeners.set(type, listener) },
    removeEventListener: () => undefined,
  } as unknown as Window)
  return (surface) => listeners.get('pointerdown')?.({ target: surface } as unknown as Event)
}

const canvasKeys = KEYS.map((key) => ({ ...key }))
const timelineKeys = TIMELINES.flatMap((timeline) => KEYS.map((key) => ({ ...key, surface: timeline })))

describe('模态关着（正向格）：同样的键真的有效果', () => {
  it.each(canvasKeys)('画布 / $name', (key) => {
    expect(pressCanvas(key).effects).toEqual([key.canvas])
  })
  it.each(timelineKeys)('$surface / $name', (key) => {
    expect(pressTimeline(key, timelines[key.surface]).effects).toEqual(key.timeline ? [key.timeline] : [])
  })
  it('列表和预览的面是活的', () => {
    expect(workspaceInputSurfaceIsActive(list)).toBe(true)
    expect(workspaceInputSurfaceIsActive(previewPanel)).toBe(true)
  })
})

describe('整窗模态开着：工作区面什么都不接', () => {
  it.each(canvasKeys)('画布 / $name', (key) => {
    openLayer()
    expect(pressCanvas(key)).toEqual({ effects: [], prevented: false })
  })
  it.each(timelineKeys)('$surface / $name', (key) => {
    openLayer()
    expect(pressTimeline(key, timelines[key.surface])).toEqual({ effects: [], prevented: false })
  })
  it('列表和预览的面也不活', () => {
    openLayer()
    expect(workspaceInputSurfaceIsActive(list)).toBe(false)
    expect(workspaceInputSurfaceIsActive(previewPanel)).toBe(false)
  })
  it('模态关掉之后，下一个键立刻回到工作区', () => {
    const layer = openLayer()
    expect(pressCanvas(KEYS[0]).effects).toEqual([])
    layer.close()
    expect(pressCanvas(KEYS[0]).effects).toEqual(['delete'])
    expect(pressTimeline(KEYS[0], timelines['generation-timeline']).effects).toEqual(['remove-selection'])
  })
})

describe('嵌套（设置里再开确认框）', () => {
  it.each(KEYS)('$name：确认框关了、设置还开着，仍然不接；设置也关了才恢复', (key) => {
    const settings = openLayer()
    const confirm = openLayer()
    expect(pressCanvas(key).effects).toEqual([])
    confirm.close()
    expect(pressCanvas(key).effects).toEqual([])
    expect(pressTimeline(key, timelines['generation-timeline']).effects).toEqual([])
    settings.close()
    expect(pressCanvas(key).effects).toEqual([key.canvas])
  })
  it('确认框排队换下一条：层一直在，中间不漏键', () => {
    const first = openLayer()
    const next = openLayer()
    first.close()
    expect(pressCanvas(KEYS[0]).effects).toEqual([])
    next.close()
    expect(pressCanvas(KEYS[0]).effects).toEqual(['delete'])
  })
  it('重复关只摘自己：关两次确认框不会把设置那层也摘掉', () => {
    openLayer()
    const confirm = openLayer()
    confirm.close()
    confirm.close()
    expect(pressCanvas(KEYS[0]).effects).toEqual([])
  })
})

describe('只盖画布那一格的层（灯箱）', () => {
  it.each(KEYS)('$name：画布不接；格子外的时间轴还能接', (key) => {
    openLayer(cell)
    expect(pressCanvas(key).effects).toEqual([])
    expect(pressTimeline(key, timelines['generation-timeline']).effects).toEqual(key.timeline ? [key.timeline] : [])
  })
  it('列表在格子里被盖住，预览页不在格子里不受影响', () => {
    openLayer(cell)
    expect(workspaceInputSurfaceIsActive(list)).toBe(false)
    expect(workspaceInputSurfaceIsActive(previewPanel)).toBe(true)
  })
  it('最近指针在被盖的画布上：键不转给没被盖的时间轴（灯箱开着按 Delete 不许删片段）', () => {
    const pointerDown = pointerTracker()
    pointerDown(canvas)
    openLayer(cell)
    expect(shortcutSurfaceMayHandle(canvas)).toBe(false)
    expect(shortcutSurfaceMayHandle(timelines['generation-timeline'])).toBe(false)
    expect(pressTimeline(KEYS[0], timelines['generation-timeline']).effects).toEqual([])
  })
  it('灯箱开着点了时间轴：时间轴接管；灯箱关了再点回画布，画布接管', () => {
    const pointerDown = pointerTracker()
    pointerDown(canvas)
    const lightbox = openLayer(cell)
    pointerDown(timelines['generation-timeline'])
    expect(shortcutSurfaceMayHandle(timelines['generation-timeline'])).toBe(true)
    expect(shortcutSurfaceMayHandle(canvas)).toBe(false)
    lightbox.close()
    pointerDown(canvas)
    expect(shortcutSurfaceMayHandle(canvas)).toBe(true)
    expect(shortcutSurfaceMayHandle(timelines['generation-timeline'])).toBe(false)
  })
  it('指针落在被盖的面上不改归属', () => {
    const pointerDown = pointerTracker()
    pointerDown(timelines['generation-timeline'])
    openLayer(cell)
    pointerDown(canvas)
    expect(shortcutSurfaceMayHandle(timelines['generation-timeline'])).toBe(true)
  })
  it('藏起来的面不算最近指针的主人，不挡别的面（隐藏面规则没变）', () => {
    const hidden = host(false)
    const pointerDown = pointerTracker()
    pointerDown(hidden)
    expect(shortcutSurfaceMayHandle(timelines['generation-timeline'])).toBe(true)
  })
  it('灯箱之上再开整窗确认框：时间轴也不接了', () => {
    openLayer(cell)
    const confirm = openLayer()
    expect(pressTimeline(KEYS[0], timelines['generation-timeline']).effects).toEqual([])
    confirm.close()
    expect(pressTimeline(KEYS[0], timelines['generation-timeline']).effects).toEqual(['remove-selection'])
  })
})

describe('关掉弹层的那个键（Mantine 在捕获期关，同一个事件接着往下走）', () => {
  const dispatching = (event: Event | undefined) => { Object.assign(window, { event }) }

  it.each(KEYS)('$name：这一下还是不接，下一个键才恢复', (key) => {
    const confirm = openLayer()
    const event = keyEvent(key.input)
    dispatching(event)
    confirm.close()
    expect(pressCanvas(key).effects).toEqual([])
    expect(shortcutSurfaceMayHandle(timelines['generation-timeline'])).toBe(false)
    dispatching(undefined)
    expect(pressCanvas(key).effects).toEqual([key.canvas])
  })

  it('灯箱之上的确认框：Esc 只关确认框，灯箱这一下让路', () => {
    const lightbox = openLayer(cell)
    const confirm = openLayer()
    dispatching(keyEvent({ key: 'Escape' }))
    confirm.close()
    expect(canvasLayerMayHandleInput(lightbox.isTop)).toBe(false)
    dispatching(keyEvent({ key: 'Escape' }))
    expect(canvasLayerMayHandleInput(lightbox.isTop), '下一个 Esc 归灯箱').toBe(true)
  })
})

describe('灯箱自己的键盘：画布宿主活动且自己在最上面才接', () => {
  it('最上面那层：接；上面叠了确认框：让路；确认框关了：回来', () => {
    const lightbox = openLayer(cell)
    expect(canvasLayerMayHandleInput(lightbox.isTop)).toBe(true)
    const confirm = openLayer()
    expect(canvasLayerMayHandleInput(lightbox.isTop)).toBe(false)
    confirm.close()
    expect(canvasLayerMayHandleInput(lightbox.isTop)).toBe(true)
  })
  it('画布宿主藏起来（切页、切列表）：灯箱也不接，别的页的 Esc 不被吞', () => {
    canvas = host(false)
    const lightbox = openLayer(cell)
    expect(canvasLayerMayHandleInput(lightbox.isTop)).toBe(false)
  })
})

describe('全局注册（canvasWindowInput）走同一条规则', () => {
  it.each(['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'paste'])('%s：模态开着不收，关了就收', (type) => {
    const callback = vi.fn()
    canvasWindowInput.addEventListener(type, callback)
    const layer = openLayer()
    window.dispatchEvent(new Event(type))
    expect(callback).not.toHaveBeenCalled()
    layer.close()
    window.dispatchEvent(new Event(type))
    expect(callback).toHaveBeenCalledOnce()
    canvasWindowInput.removeEventListener(type, callback)
  })
})

describe('弹层开在手势中途：和宿主隐藏走同一条打断', () => {
  it('整窗层：画布手势的收尾被叫到一次，别的 window blur 监听不受牵连', () => {
    const cleanup = vi.fn()
    const unrelated = vi.fn()
    window.addEventListener('blur', unrelated)
    canvasWindowInput.addEventListener('blur', cleanup)
    openLayer()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(unrelated).not.toHaveBeenCalled()
    canvasWindowInput.removeEventListener('blur', cleanup)
  })
  it('盖住画布的小层：打断；没盖住画布的小层：不打断', () => {
    const cleanup = vi.fn()
    canvasWindowInput.addEventListener('blur', cleanup)
    openLayer({ contains: () => false } as unknown as Element)
    expect(cleanup).not.toHaveBeenCalled()
    openLayer(cell)
    expect(cleanup).toHaveBeenCalledOnce()
    canvasWindowInput.removeEventListener('blur', cleanup)
  })
  it('拖动租约：整窗层收掉所有租约', () => {
    const onCancel = vi.fn()
    const origin = { closest: () => null } as unknown as Element
    beginCanvasDragging(origin, CANVAS_DRAGGING_OWNER.reactFlowNode, { onCancel })
    openLayer()
    expect(onCancel).toHaveBeenCalledOnce()
  })
  it('拖动租约：只盖画布格的层，收格子里的，不碰格子外的（时间轴的手势继续）', () => {
    const inCell = vi.fn()
    const inTimeline = vi.fn()
    const cellOrigin = { closest: () => null } as unknown as Element
    const timelineOrigin = { closest: () => null } as unknown as Element
    const lightboxCell = { contains: (element: Element) => element === cellOrigin } as unknown as Element
    const inTimelineLease = beginCanvasDragging(timelineOrigin, CANVAS_DRAGGING_OWNER.timelineGesture, { onCancel: inTimeline, active: false })
    beginCanvasDragging(cellOrigin, CANVAS_DRAGGING_OWNER.reactFlowNode, { onCancel: inCell })
    openLayer(lightboxCell)
    expect(inCell).toHaveBeenCalledOnce()
    expect(inTimeline).not.toHaveBeenCalled()
    inTimelineLease.release()
  })
})

describe('浏览器的编辑默认动作（全选、撤销、重做）：没有面接时，也不能落到框后面', () => {
  const dialogButton = { closest: () => null } as unknown as Element
  const dialogInput = { closest: () => ({}) } as unknown as Element
  /** 灯箱里的按钮：格子里、不是输入框（灯箱打开时焦点在它的关闭钮上）。 */
  let inLightbox: Element
  beforeEach(() => {
    inLightbox = { closest: () => null } as unknown as Element
    cell = { contains: (element: Element) => element === canvas || element === list || element === inLightbox } as unknown as Element
    installShortcutSurfaceTracker(window)
  })
  const recordPointerOn = (surface: Element): void => {
    const event = new Event('pointerdown')
    Object.defineProperty(event, 'target', { value: surface })
    window.dispatchEvent(event)
  }
  const press = (input: KeyCell['input'], target: Element): boolean => {
    const event = keyEvent(input, target)
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  const EDITING: readonly KeyCell['input'][] = [{ key: 'a', metaKey: true }, { key: 'z', metaKey: true }, { key: 'z', metaKey: true, shiftKey: true }, { key: 'y', metaKey: true }]

  it.each(EDITING)('整窗层开着，焦点在框里的按钮上：$key 不发生', (input) => {
    openLayer()
    expect(press(input, dialogButton)).toBe(true)
  })

  it.each(EDITING)('框里的输入框：$key 照常', (input) => {
    openLayer()
    expect(press(input, dialogInput)).toBe(false)
  })

  it.each(EDITING)('没有层：$key 不管', (input) => {
    expect(press(input, dialogButton)).toBe(false)
  })

  it('别的键不管（Cmd+C 复制框里选中的字要照常）', () => {
    openLayer()
    expect(press({ key: 'c', metaKey: true }, dialogButton)).toBe(false)
    expect(press({ key: 'v', metaKey: true }, dialogButton)).toBe(false)
    expect(press({ key: 'a' }, dialogButton)).toBe(false)
  })

  it('灯箱开着、最近指针在被盖的画布上：没有面接，不发生', () => {
    recordPointerOn(canvas)
    openLayer(cell)
    expect(press({ key: 'a', metaKey: true }, inLightbox)).toBe(true)
    expect(press({ key: 'z', metaKey: true }, inLightbox)).toBe(true)
  })

  it('灯箱开着、点过时间轴：这一下归时间轴，不抢（它靠 defaultPrevented 去重，抢了 Cmd+Z 就废了）', () => {
    openLayer(cell)
    recordPointerOn(timelines['generation-timeline'])
    expect(press({ key: 'z', metaKey: true }, inLightbox)).toBe(false)
  })

  it('灯箱开着、还没按过指针：时间轴照旧接，不抢', () => {
    openLayer(cell)
    expect(press({ key: 'z', metaKey: true }, inLightbox)).toBe(false)
  })

  it('目标不在被盖的范围里（时间轴片段）：不管', () => {
    openLayer(cell)
    recordPointerOn(canvas)
    expect(press({ key: 'a', metaKey: true }, timelines['generation-timeline'])).toBe(false)
  })
})

describe('时间轴快捷键帮助框的开合键（面只负责开，关归帮助框自己）', () => {
  it.each([
    [{ key: '?' }, true],
    [{ key: '/', shiftKey: true }, true],
    [{ key: '/' }, false],
    [{ key: 'Escape' }, false],
    [{ key: 'a' }, false],
  ])('%j → %s', (input, expected) => {
    expect(isTimelineShortcutsHelpKey(input)).toBe(expected)
  })
})
