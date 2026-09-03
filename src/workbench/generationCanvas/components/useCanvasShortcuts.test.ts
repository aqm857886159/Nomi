import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGenerationNode } from '../model/graphOps'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from '../store/generationCanvasStore'
import { canvasZoomShortcutDirection, createCanvasKeydownHandler, isCanvasTextEditingContext, shouldPreferCanvasClipboard } from './useCanvasShortcuts'

function targetWithEditableAncestor(editable: boolean): EventTarget {
  const ancestor = editable ? {} : null
  return {
    closest: () => ancestor,
  } as unknown as EventTarget
}

function keyboardEvent(target: EventTarget, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const event = new Event('keydown', { cancelable: true })
  Object.defineProperties(event, {
    key: { value: 'z' },
    code: { value: 'KeyZ' },
    ctrlKey: { value: false },
    metaKey: { value: true },
    altKey: { value: false },
    shiftKey: { value: false },
    target: { value: target },
    ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, { value }])),
  })
  return event as KeyboardEvent
}

const originalWindow = globalThis.window
const originalDocument = globalThis.document

afterEach(() => {
  __resetGenerationCanvasHistoryForTests()
  if (originalWindow === undefined) delete (globalThis as { window?: Window }).window
  else globalThis.window = originalWindow
  if (originalDocument === undefined) delete (globalThis as { document?: Document }).document
  else globalThis.document = originalDocument
})

function shortcut(overrides: Partial<Parameters<typeof canvasZoomShortcutDirection>[0]> = {}) {
  return canvasZoomShortcutDirection({
    key: '',
    code: '',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    ...overrides,
  })
}

function clipboardData(input: {
  files?: File[]
  html?: string
  plain?: string
  uriList?: string
}): DataTransfer {
  return {
    files: input.files || [],
    items: [],
    getData: (type: string) => {
      if (type === 'text/html') return input.html || ''
      if (type === 'text/plain') return input.plain || ''
      if (type === 'text/uri-list') return input.uriList || ''
      return ''
    },
  } as unknown as DataTransfer
}

describe('canvasZoomShortcutDirection', () => {
  it('兼容主键盘与小键盘加减号', () => {
    expect(shortcut({ key: '+', code: 'Equal' })).toBe(1)
    expect(shortcut({ key: '=', code: 'Equal' })).toBe(1)
    expect(shortcut({ key: '+', code: 'NumpadAdd' })).toBe(1)
    expect(shortcut({ key: '-', code: 'Minus' })).toBe(-1)
    expect(shortcut({ key: '-', code: 'NumpadSubtract' })).toBe(-1)
  })

  it('兼容 Cmd，并忽略无修饰键与 Alt 组合', () => {
    expect(shortcut({ key: '+', code: 'Equal', ctrlKey: false, metaKey: true })).toBe(1)
    expect(shortcut({ key: '+', code: 'Equal', ctrlKey: false })).toBe(0)
    expect(shortcut({ key: '+', code: 'Equal', altKey: true })).toBe(0)
  })
})

describe('画布快捷键的文本编辑边界', () => {
  it('事件目标处于编辑器时放行，只有残留焦点处于编辑器时仍由画布处理', () => {
    const editable = targetWithEditableAncestor(true)
    const outside = targetWithEditableAncestor(false)

    expect(isCanvasTextEditingContext(editable, outside)).toBe(true)
    expect(isCanvasTextEditingContext(outside, editable)).toBe(false)
    expect(isCanvasTextEditingContext(outside, outside)).toBe(false)
  })

  it('事件目标是富文本内部的文本节点时沿父元素识别编辑态', () => {
    const textNodeTarget = {
      parentElement: targetWithEditableAncestor(true),
    } as unknown as EventTarget

    expect(isCanvasTextEditingContext(textNodeTarget, null)).toBe(true)
  })

  it('真实 paste 必须在编辑态早退前取消节点粘贴兜底', () => {
    const source = readFileSync(fileURLToPath(new URL('./useCanvasShortcuts.ts', import.meta.url)), 'utf8')
    const handler = source.match(/const handlePaste = \(event: ClipboardEvent\) => \{([\s\S]*?)\n {4}\}/)?.[1]

    expect(handler).toBeDefined()
    expect(handler?.indexOf('clearPasteFallback()')).toBeLessThan(handler?.indexOf('shouldIgnoreCanvasShortcut') ?? -1)
  })

  it('已被节点或时间轴消费的按键不再进入画布命令', () => {
    const source = readFileSync(fileURLToPath(new URL('./useCanvasShortcuts.ts', import.meta.url)), 'utf8')
    const handler = source.match(/const handleKeyDown = \(event: KeyboardEvent\) => \{([\s\S]*?)\n {4}\}/)?.[1]

    expect(handler).toBeDefined()
    expect(handler?.indexOf('event.defaultPrevented')).toBeLessThan(handler?.indexOf('shouldIgnoreCanvasShortcut') ?? -1)
  })

  it('模型选择后焦点仍在提示词 textarea，真实 Cmd+Z 仍能到达 store 撤销模型变更', () => {
    const eventWindow = new EventTarget() as EventTarget & { getSelection: () => { isCollapsed: boolean } }
    eventWindow.getSelection = () => ({ isCollapsed: true })
    const promptTextarea = targetWithEditableAncestor(true)
    const modelPicker = targetWithEditableAncestor(false)
    globalThis.window = eventWindow as Window & typeof globalThis
    globalThis.document = {
      activeElement: promptTextarea,
      querySelector: () => null,
    } as unknown as Document

    const node = { ...createGenerationNode({ id: 'model-node', kind: 'image' }), meta: { modelKey: 'old-model' } }
    const store = useGenerationCanvasStore.getState()
    store.restoreSnapshot({ nodes: [node], edges: [], groups: [] })
    store.updateNode(node.id, { meta: { modelKey: 'new-model' } })
    const undo = vi.fn(store.undo)

    const handler = createCanvasKeydownHandler({
      stageRef: { current: { offsetParent: {} } } as RefObject<HTMLDivElement>,
      selectedNodeCount: 0,
      selectedGroupCount: 0,
      activeCategoryId: 'shots',
      setActiveEdge: () => {},
      cancelConnection: () => {},
      deleteSelectedNodes: () => {},
      groupSelectedNodes: () => {},
      ungroupSelectedNodes: () => {},
      copySelectedNodes: () => {},
      cutSelectedNodes: () => {},
      pasteNodes: () => {},
      zoomByStep: () => {},
      undo,
      redo: store.redo,
    })
    eventWindow.addEventListener('keydown', (event) => handler(event as KeyboardEvent))
    eventWindow.dispatchEvent(keyboardEvent(modelPicker))

    expect(undo).toHaveBeenCalledTimes(1)
    expect(useGenerationCanvasStore.getState().nodes[0]?.meta?.modelKey).toBe('old-model')
  })

  it('真实 Cmd+Z 从 textarea 发出时仍留给文本编辑器，不撤销画布', () => {
    const eventWindow = new EventTarget() as EventTarget & { getSelection: () => { isCollapsed: boolean } }
    eventWindow.getSelection = () => ({ isCollapsed: true })
    const promptTextarea = targetWithEditableAncestor(true)
    globalThis.window = eventWindow as Window & typeof globalThis
    globalThis.document = {
      activeElement: promptTextarea,
      querySelector: () => null,
    } as unknown as Document

    const node = { ...createGenerationNode({ id: 'text-node', kind: 'image' }), meta: { modelKey: 'old-model' } }
    const store = useGenerationCanvasStore.getState()
    store.restoreSnapshot({ nodes: [node], edges: [], groups: [] })
    store.updateNode(node.id, { meta: { modelKey: 'new-model' } })
    const undo = vi.fn(store.undo)
    const handler = createCanvasKeydownHandler({
      stageRef: { current: { offsetParent: {} } } as RefObject<HTMLDivElement>,
      selectedNodeCount: 0,
      selectedGroupCount: 0,
      activeCategoryId: 'shots',
      setActiveEdge: () => {},
      cancelConnection: () => {},
      deleteSelectedNodes: () => {},
      groupSelectedNodes: () => {},
      ungroupSelectedNodes: () => {},
      copySelectedNodes: () => {},
      cutSelectedNodes: () => {},
      pasteNodes: () => {},
      zoomByStep: () => {},
      undo,
      redo: store.redo,
    })
    eventWindow.addEventListener('keydown', (event) => handler(event as KeyboardEvent))
    const event = keyboardEvent(promptTextarea)
    eventWindow.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(useGenerationCanvasStore.getState().nodes[0]?.meta?.modelKey).toBe('new-model')
  })
})

describe('画布粘贴来源路由', () => {
  it('内部节点剪贴板存在时，不把普通网页 URL 误当成外部媒体', () => {
    expect(shouldPreferCanvasClipboard(clipboardData({ plain: 'https://example.com/page' }), true)).toBe(true)
  })

  it('明确的 HTML 媒体仍优先导入外部媒体', () => {
    expect(shouldPreferCanvasClipboard(clipboardData({ html: '<img src="https://cdn.example.com/image.png">' }), true)).toBe(false)
  })

  it('明确的 HTML 视频仍优先导入外部媒体', () => {
    expect(shouldPreferCanvasClipboard(clipboardData({ html: '<video src="https://cdn.example.com/video.mp4"></video>' }), true)).toBe(false)
  })

  it('系统剪贴板带真实媒体文件时仍优先导入外部媒体', () => {
    const file = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' })
    expect(shouldPreferCanvasClipboard(clipboardData({ files: [file] }), true)).toBe(false)
  })

  it('没有内部节点剪贴板时不抢占外部粘贴路由', () => {
    expect(shouldPreferCanvasClipboard(clipboardData({ plain: 'https://example.com/page' }), false)).toBe(false)
  })

  it('键盘粘贴先完成内部/外部来源判定，再调用网页媒体导入', () => {
    const source = readFileSync(fileURLToPath(new URL('./useCanvasShortcuts.ts', import.meta.url)), 'utf8')
    const handler = source.match(/const handlePaste = \(event: ClipboardEvent\) => \{([\s\S]*?)\n {4}\}/)?.[1]

    expect(handler).toBeDefined()
    expect(handler?.indexOf('shouldPreferCanvasClipboard')).toBeLessThan(handler?.indexOf('pasteClipboardMediaToGenerationCanvas') ?? -1)
  })
})
