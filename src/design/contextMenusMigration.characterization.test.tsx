import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const dialogMocks = vi.hoisted(() => {
  // 让 @radix-ui/react-use-layout-effect 在模块加载期识别到浏览器宿主并绑定真实 React.useLayoutEffect。
  if (typeof globalThis.document === 'undefined') {
    ;(globalThis as unknown as Record<string, unknown>).document = { documentElement: { lang: '' } }
  }
  return {
    confirmDialog: vi.fn(async () => true),
    promptDialog: vi.fn(async () => 'Renamed Node'),
    showUndoToast: vi.fn(),
  }
})

vi.mock('../design', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../design')>()
  return {
    ...actual,
    confirmDialog: dialogMocks.confirmDialog,
    promptDialog: dialogMocks.promptDialog,
  }
})

vi.mock('../utils/showUndoToast', () => ({
  showUndoToast: dialogMocks.showUndoToast,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => String(i18n.t(key, opts)),
    i18n,
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

import DocumentListSidebar from '../workbench/creation/DocumentListSidebar'
import CategoryTree from '../workbench/sidebar/CategoryTree'
import { WorkbenchContextMenu, type WorkbenchMenuNode } from './menu'
import { useWorkbenchStore } from '../workbench/workbenchStore'
import { useGenerationCanvasStore } from '../workbench/generationCanvas/store/generationCanvasStore'
import { BUILTIN_CATEGORIES, type ProjectCategory } from '../workbench/project/projectCategories'

type ListenerEntry = { listener: (event: unknown) => void; capture: boolean }

class FakeEvent {
  defaultPrevented = false
  propagationStopped = false
  bubbles = true
  cancelable = true
  target: unknown = null
  currentTarget: unknown = null
  key?: string
  button = 0
  pointerType = 'mouse'
  clientX = 0
  clientY = 0
  constructor(public type: string, init: Record<string, unknown> = {}) {
    Object.assign(this, init)
  }
  preventDefault() { this.defaultPrevented = true }
  stopPropagation() { this.propagationStopped = true }
  stopImmediatePropagation() { this.propagationStopped = true }
}

class FakeElement {
  nodeType = 1
  children: FakeElement[] = []
  childNodes: (FakeElement | FakeText)[] = []
  parentNode: FakeElement | null = null
  style: Record<string, unknown> & {
    setProperty: (k: string, v: string) => void
    removeProperty: (k: string) => void
    getPropertyValue: (k: string) => string
  } = {
    setProperty(k: string, v: string) { this[k] = v },
    removeProperty(k: string) { delete this[k] },
    getPropertyValue(k: string) { return typeof this[k] === 'string' ? (this[k] as string) : '' },
  }
  listeners = new Map<string, ListenerEntry[]>()
  props: Record<string, unknown> = {}
  namespaceURI = 'http://www.w3.org/1999/xhtml'
  tabIndex = -1
  isConnected = true
  offsetWidth = 180
  offsetHeight = 120
  clientWidth = 180
  clientHeight = 120
  constructor(public nodeName: string, public ownerDocument: FakeDocument, props: Record<string, unknown> = {}) {
    this.props = props
  }
  get tagName() { return this.nodeName.toUpperCase() }
  get firstChild() { return this.childNodes[0] ?? null }
  get parentElement() { return this.parentNode }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('')
  }
  appendChild<T extends FakeElement | FakeText>(child: T): T {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    if (child instanceof FakeElement) this.children.push(child)
    return child
  }
  insertBefore<T extends FakeElement | FakeText>(child: T, before: (FakeElement | FakeText) | null): T {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    const idx = before ? this.childNodes.indexOf(before) : -1
    if (idx < 0) this.childNodes.push(child)
    else this.childNodes.splice(idx, 0, child)
    this.children = this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement)
    return child
  }
  removeChild<T extends FakeElement | FakeText>(child: T): T {
    this.childNodes = this.childNodes.filter((n) => n !== child)
    this.children = this.children.filter((n) => n !== child)
    child.parentNode = null
    return child
  }
  remove() {
    this.parentNode?.removeChild(this)
  }
  insertAdjacentElement(position: string, el: FakeElement): FakeElement {
    if (position === 'afterbegin') return this.insertBefore(el, this.firstChild)
    if (position === 'beforeend') return this.appendChild(el)
    if (position === 'beforebegin' && this.parentNode) return this.parentNode.insertBefore(el, this)
    if (position === 'afterend' && this.parentNode) {
      const idx = this.parentNode.childNodes.indexOf(this)
      return this.parentNode.insertBefore(el, this.parentNode.childNodes[idx + 1] ?? null)
    }
    return el
  }
  compareDocumentPosition(other: FakeElement): number {
    if (this === other) return 0
    const allNodes: FakeElement[] = []
    const walk = (n: FakeElement) => {
      allNodes.push(n)
      for (const c of n.children) walk(c)
    }
    walk(this.ownerDocument.documentElement)
    const a = allNodes.indexOf(this)
    const b = allNodes.indexOf(other)
    if (a < 0 || b < 0) return 1
    return a < b ? 4 : 2
  }
  contains(node: unknown): boolean {
    if (node === this) return true
    for (const child of this.childNodes) {
      if (child === node) return true
      if (child instanceof FakeElement && child.contains(node)) return true
    }
    return false
  }
  getAttribute(name: string): string | null {
    const val = this.props[name]
    if (val === undefined || val === null || val === false) return null
    if (val === true) return ''
    return String(val)
  }
  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null
  }
  getAttributeNames(): string[] {
    return Object.keys(this.props).filter((k) => this.getAttribute(k) !== null)
  }
  setAttribute(name: string, value: string) {
    this.props = { ...this.props, [name]: value }
  }
  removeAttribute(name: string) {
    const next = { ...this.props }
    delete next[name]
    this.props = next
  }
  matches(selector: string): boolean {
    if (selector === ':focus-visible') return false
    if (selector === '[role="menuitem"]') return this.getAttribute('role') === 'menuitem'
    return false
  }
  closest(selector: string): FakeElement | null {
    const parts = selector.split(',').map((s) => s.trim())
    const matchesSelf = (node: FakeElement) =>
      parts.some((part) => {
        const attrMatch = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part)
        if (attrMatch) {
          const val = node.getAttribute(attrMatch[1])
          return attrMatch[2] === undefined ? val !== null : val === attrMatch[2]
        }
        return node.nodeName.toLowerCase() === part.toLowerCase()
      })
    if (matchesSelf(this)) return this
    let cur = this.parentNode
    while (cur) {
      if (matchesSelf(cur)) return cur
      cur = cur.parentNode
    }
    return null
  }
  focus() {
    this.ownerDocument.activeElement = this
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body
  }
  select() {}
  getBoundingClientRect() {
    return { left: 100, top: 100, right: 280, bottom: 220, width: 180, height: 120, x: 100, y: 100, toJSON: () => ({}) }
  }
  getClientRects() {
    return [this.getBoundingClientRect()]
  }
  addEventListener(type: string, listener: (event: unknown) => void, opts?: boolean | AddEventListenerOptions) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture)
    const list = this.listeners.get(type) ?? []
    list.push({ listener, capture })
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, listener: (event: unknown) => void, opts?: boolean | EventListenerOptions) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture)
    const list = this.listeners.get(type) ?? []
    this.listeners.set(type, list.filter((e) => e.listener !== listener || e.capture !== capture))
  }
  dispatchEvent(event: FakeEvent): boolean {
    if (event.target == null) {
      try { event.target = this } catch { /* native Event getter-only */ }
    }
    try { event.currentTarget = this } catch { /* native Event getter-only */ }
    for (const entry of [...(this.listeners.get(event.type) ?? [])]) {
      entry.listener(event)
      if (event.propagationStopped) break
    }
    return !event.defaultPrevented
  }
  querySelectorAll(selectorOrPredicate: string | ((el: FakeElement) => boolean), out: FakeElement[] = []): FakeElement[] {
    const predicate =
      typeof selectorOrPredicate === 'function'
        ? selectorOrPredicate
        : (el: FakeElement) => {
            const attrMatch = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selectorOrPredicate.trim())
            if (attrMatch) {
              const val = el.getAttribute(attrMatch[1])
              return attrMatch[2] === undefined ? val !== null : val === attrMatch[2]
            }
            return el.nodeName.toLowerCase() === selectorOrPredicate.trim().toLowerCase()
          }
    for (const child of this.children) {
      if (predicate(child)) out.push(child)
      child.querySelectorAll(predicate, out)
    }
    return out
  }
}

class FakeText {
  nodeType = 3
  parentNode: FakeElement | null = null
  constructor(public textContent: string) {}
}

class FakeDocument {
  nodeType = 9
  body: FakeElement
  documentElement: FakeElement
  activeElement: FakeElement
  defaultView: FakeWindow
  listeners = new Map<string, ListenerEntry[]>()
  constructor(win: FakeWindow) {
    this.defaultView = win
    this.documentElement = new FakeElement('html', this)
    this.body = new FakeElement('body', this)
    this.documentElement.appendChild(this.body)
    this.activeElement = this.body
  }
  addEventListener(type: string, listener: (event: unknown) => void, opts?: boolean | AddEventListenerOptions) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture)
    const list = this.listeners.get(type) ?? []
    list.push({ listener, capture })
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, listener: (event: unknown) => void, opts?: boolean | EventListenerOptions) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture)
    const list = this.listeners.get(type) ?? []
    this.listeners.set(type, list.filter((e) => e.listener !== listener || e.capture !== capture))
  }
  dispatchEvent(event: FakeEvent): boolean {
    event.target ??= this.body
    for (const capture of [true, false]) {
      for (const entry of [...(this.listeners.get(event.type) ?? [])]) {
        if (entry.capture !== capture) continue
        event.currentTarget = this
        entry.listener(event)
        if (event.propagationStopped) return !event.defaultPrevented
      }
    }
    return !event.defaultPrevented
  }
  createElement(tag: string) {
    return new FakeElement(tag, this)
  }
  querySelector(selector: string) {
    if (selector.includes('data-shortcut-surface="canvas"')) {
      return new FakeElement('div', this, { 'data-shortcut-surface': 'canvas', 'data-workspace-input-active': 'true' })
    }
    return null
  }
  querySelectorAll() {
    return []
  }
  createTreeWalker() {
    return { nextNode: () => null }
  }
}

class FakeWindow {
  document: FakeDocument
  innerWidth = 1280
  innerHeight = 800
  listeners = new Map<string, ListenerEntry[]>()
  Node = FakeElement
  Element = FakeElement
  HTMLElement = FakeElement
  Event = FakeEvent
  MouseEvent = FakeEvent
  PointerEvent = FakeEvent
  KeyboardEvent = FakeEvent
  CustomEvent = FakeEvent
  ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  // Radix ContextMenu.Trigger 用 DOMRect.fromRect 造右键点位的虚拟锚点。
  DOMRect = class { static fromRect(rect: { x?: number; y?: number; width?: number; height?: number } = {}) { const { x = 0, y = 0, width = 0, height = 0 } = rect; return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) } } }
  MutationObserver = class { observe() {} disconnect() {} takeRecords() { return [] } }
  getComputedStyle = () => ({ getPropertyValue: () => '', direction: 'ltr', overflowX: 'visible', overflowY: 'visible', position: 'fixed' })
  private activeTimers = new Set<ReturnType<typeof setTimeout>>()
  requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = setTimeout(() => {
      this.activeTimers.delete(id)
      cb(Date.now())
    }, 0)
    this.activeTimers.add(id)
    return id
  }
  cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => {
    this.activeTimers.delete(id)
    clearTimeout(id)
  }
  setTimeout = ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const id = setTimeout(() => {
      this.activeTimers.delete(id)
      fn(...args)
    }, ms)
    this.activeTimers.add(id)
    return id
  }) as typeof setTimeout
  clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    this.activeTimers.delete(id)
    clearTimeout(id)
  }) as typeof clearTimeout
  clearAllTimers() {
    for (const id of this.activeTimers) clearTimeout(id)
    this.activeTimers.clear()
  }
  localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  constructor() {
    this.document = new FakeDocument(this)
  }
  addEventListener(type: string, listener: (event: unknown) => void, opts?: boolean | AddEventListenerOptions) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture)
    const list = this.listeners.get(type) ?? []
    list.push({ listener, capture })
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, listener: (event: unknown) => void, opts?: boolean | EventListenerOptions) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture)
    const list = this.listeners.get(type) ?? []
    this.listeners.set(type, list.filter((e) => e.listener !== listener || e.capture !== capture))
  }
  dispatchEvent(event: FakeEvent): boolean {
    event.target ??= this.document.body
    for (const capture of [true, false]) {
      for (const entry of [...(this.listeners.get(event.type) ?? [])]) {
        if (entry.capture !== capture) continue
        event.currentTarget = this
        entry.listener(event)
        if (event.propagationStopped) return !event.defaultPrevented
      }
    }
    return !event.defaultPrevented
  }
}

/** 用 react-reconciler 挂一棵可遍历、可触发真实事件与 document/window 监听的树（零 mock Radix）。 */
function mountTree(element: React.ReactElement) {
  const win = new FakeWindow()
  const rootEl = new FakeElement('div', win.document)
  win.document.body.appendChild(rootEl)

  vi.stubGlobal('window', win)
  vi.stubGlobal('document', win.document)
  vi.stubGlobal('Node', FakeElement)
  vi.stubGlobal('Element', FakeElement)
  vi.stubGlobal('HTMLElement', FakeElement)
  vi.stubGlobal('Event', FakeEvent)
  vi.stubGlobal('MouseEvent', FakeEvent)
  vi.stubGlobal('PointerEvent', FakeEvent)
  vi.stubGlobal('KeyboardEvent', FakeEvent)
  vi.stubGlobal('CustomEvent', FakeEvent)
  vi.stubGlobal('ResizeObserver', win.ResizeObserver)
  vi.stubGlobal('DOMRect', win.DOMRect)
  vi.stubGlobal('MutationObserver', win.MutationObserver)
  vi.stubGlobal('getComputedStyle', win.getComputedStyle)
  vi.stubGlobal('requestAnimationFrame', win.requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', win.cancelAnimationFrame)

  // 用自定义 reconciler 构建 FakeElement 父子链，兼容原版和 Radix 两种菜单树。
  const Reconciler = createRequire(import.meta.url)('react-reconciler') as (config: Record<string, unknown>) => {
    createContainer: (...args: unknown[]) => unknown
    flushSyncFromReconciler: (fn: () => void) => void
    updateContainerSync: (...args: unknown[]) => void
    flushSyncWork: () => void
    flushPassiveEffects: () => void
  }
  const hostErrors: unknown[] = []
  const renderer = Reconciler({
    now: Date.now,
    supportsMutation: true,
    isPrimaryRenderer: true,
    getRootHostContext: () => ({}),
    getChildHostContext: () => ({}),
    getPublicInstance: (instance: FakeElement) => instance,
    preparePortalMount: () => undefined,
    prepareForCommit: () => null,
    resetAfterCommit: () => undefined,
    shouldSetTextContent: () => false,
    createInstance: (type: string, props: Record<string, unknown>) => new FakeElement(type, win.document, props),
    createTextInstance: (text: string) => new FakeText(text),
    appendInitialChild: (parent: FakeElement, child: FakeElement | FakeText) => parent.appendChild(child),
    appendChild: (parent: FakeElement, child: FakeElement | FakeText) => parent.appendChild(child),
    appendChildToContainer: (container: FakeElement, child: FakeElement | FakeText) => container.appendChild(child),
    insertBefore: (parent: FakeElement, child: FakeElement | FakeText, before: FakeElement | FakeText) => parent.insertBefore(child, before),
    insertInContainerBefore: (container: FakeElement, child: FakeElement | FakeText, before: FakeElement | FakeText) => container.insertBefore(child, before),
    removeChild: (parent: FakeElement, child: FakeElement | FakeText) => parent.removeChild(child),
    removeChildFromContainer: (container: FakeElement, child: FakeElement | FakeText) => container.removeChild(child),
    clearContainer: (container: FakeElement) => { container.childNodes = []; container.children = [] },
    detachDeletedInstance: () => undefined,
    finalizeInitialChildren: () => false,
    prepareUpdate: () => true,
    commitUpdate: (instance: FakeElement, _type: string, _oldProps: Record<string, unknown>, newProps: Record<string, unknown>) => {
      instance.props = newProps
    },
    commitTextUpdate: (textInstance: FakeText, _oldText: string, newText: string) => {
      textInstance.textContent = newText
    },
    scheduleTimeout: setTimeout,
    cancelTimeout: clearTimeout,
    noTimeout: -1,
    getCurrentEventPriority: () => 2,
    setCurrentUpdatePriority: () => undefined,
    getCurrentUpdatePriority: () => 2,
    resolveUpdatePriority: () => 2,
    resolveEventType: () => null,
    resolveEventTimeStamp: () => -1,
    trackSchedulerEvent: () => undefined,
    shouldAttemptEagerTransition: () => false,
    supportsMicrotasks: false,
  })
  const container = renderer.createContainer(rootEl, 0, null, false, null, '', (err: unknown) => hostErrors.push(err), null)
  const flush = () => {
    renderer.flushSyncWork()
    renderer.flushPassiveEffects()
    renderer.flushSyncWork()
    if (hostErrors.length) throw hostErrors.shift()
  }
  const render = (next: React.ReactElement | null) => {
    renderer.flushSyncFromReconciler(() => renderer.updateContainerSync(next, container, null, () => undefined))
    flush()
  }
  render(element)

  const all = (predicate: (el: FakeElement) => boolean) => win.document.body.querySelectorAll(predicate)
  const first = (predicate: (el: FakeElement) => boolean) => all(predicate)[0] ?? null
  const isDisabled = (el: FakeElement) =>
    el.props.disabled === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.hasAttribute('data-disabled')

  const triggerContextMenu = (el: FakeElement, x = 220, y = 160) => {
    const handler = el.props.onContextMenu as ((e: FakeEvent) => void) | undefined
    expect(handler, '目标元素没有 onContextMenu 处理函数').toBeTypeOf('function')
    handler!(new FakeEvent('contextmenu', { clientX: x, clientY: y, target: el, currentTarget: el }))
    flush()
  }

  const activateMenuItem = (el: FakeElement) => {
    const ev = new FakeEvent('click', { target: el, currentTarget: el, button: 0 })
    const onPointerDown = el.props.onPointerDown as ((e: FakeEvent) => void) | undefined
    const onPointerUp = el.props.onPointerUp as ((e: FakeEvent) => void) | undefined
    const onClick = el.props.onClick as ((e: FakeEvent) => void) | undefined
    onPointerDown?.(new FakeEvent('pointerdown', { target: el, currentTarget: el, button: 0 }))
    onPointerUp?.(new FakeEvent('pointerup', { target: el, currentTarget: el, button: 0 }))
    onClick?.(ev)
    flush()
  }

  const pressEscape = () => {
    const menu = first((el) => el.getAttribute('role') === 'menu')
    const ev = new FakeEvent('keydown', { key: 'Escape', target: menu ?? win.document.body })
    if (menu) {
      ;(menu.props.onKeyDownCapture as ((e: FakeEvent) => void) | undefined)?.(ev)
      if (!ev.propagationStopped) (menu.props.onKeyDown as ((e: FakeEvent) => void) | undefined)?.(ev)
    }
    if (!ev.propagationStopped) win.document.dispatchEvent(ev)
    if (!ev.propagationStopped) win.dispatchEvent(ev)
    flush()
  }

  const pointerDownOutside = () => {
    const outside = new FakeElement('div', win.document)
    win.document.body.appendChild(outside)
    const pd = new FakeEvent('pointerdown', { target: outside })
    win.document.dispatchEvent(pd)
    win.dispatchEvent(pd)
    const click = new FakeEvent('click', { target: outside })
    win.document.dispatchEvent(click)
    win.dispatchEvent(click)
    flush()
  }

  const pressKey = (key: string) => {
    const menu = first((el) => el.getAttribute('role') === 'menu')
    const target = menu && menu.contains(win.document.activeElement) ? win.document.activeElement : (menu ?? win.document.body)
    const ev = new FakeEvent('keydown', { key, target })
    // 沿 DOM 树向上模拟 React 合成事件（捕获再冒泡）
    const chain: FakeElement[] = []
    let cur: FakeElement | null = target
    while (cur) {
      chain.push(cur)
      cur = cur.parentNode
    }
    for (const node of [...chain].reverse()) {
      ev.currentTarget = node
      ;(node.props.onKeyDownCapture as ((e: FakeEvent) => void) | undefined)?.(ev)
      if (ev.propagationStopped) break
    }
    if (!ev.propagationStopped) {
      for (const node of chain) {
        ev.currentTarget = node
        ;(node.props.onKeyDown as ((e: FakeEvent) => void) | undefined)?.(ev)
        if (ev.propagationStopped) break
      }
    }
    if (!ev.propagationStopped) win.document.dispatchEvent(ev)
    if (!ev.propagationStopped) win.dispatchEvent(ev)
    flush()
  }

  const pointerDownOutsideOnly = () => {
    // 只派发 document 上的 pointerdown（不派发 click，验证即使 d3-zoom 吞掉 click，Radix DismissableLayer 仍关闭菜单）
    const outside = new FakeElement('div', win.document)
    win.document.body.appendChild(outside)
    const pd = new FakeEvent('pointerdown', { target: outside, pointerType: 'mouse', button: 0 })
    win.document.dispatchEvent(pd)
    flush()
  }

  return {
    win,
    rootEl,
    render,
    flush,
    all,
    first,
    isDisabled,
    triggerContextMenu,
    activateMenuItem,
    pressEscape,
    pressKey,
    pointerDownOutside,
    pointerDownOutsideOnly,
    unmount: () => {
      render(null)
      win.clearAllTimers()
    },
  }
}

// 仅做 type 引用，避免未使用告警
type _UnusedCheck = TestHostNode

/**
 * 导演台时间轴的菜单形状：真触发器入口 `WorkbenchContextMenu` 包住一行，皮肤与 escapeLayer 照 DirectorTimeline 的 TIMELINE_MENU_SKIN。
 * （原 director/timeline/TimelineContextMenu.tsx 点位适配层已删；真行 / 真「+」按钮的打开态在 menuTriggerAndCascade.browser.test.ts 里走。）
 */
type TimelineItemSpec =
  | { id: string; label: string; disabled?: boolean; title?: string; danger?: boolean; onSelect: () => void }
  | { id: string; separator: true }
function TimelineRowMenu({ items, onOpenChange }: { items: TimelineItemSpec[]; onOpenChange?: (open: boolean) => void }) {
  const nodes: WorkbenchMenuNode[] = items.map((item) =>
    'separator' in item
      ? { kind: 'separator', id: item.id }
      : { id: item.id, label: item.label, disabled: item.disabled, disabledReason: item.title, danger: item.danger, onSelect: item.onSelect },
  )
  return (
    <WorkbenchContextMenu
      escapeLayer="director-timeline-menu"
      className="min-w-[200px] rounded-nomi-lg p-1 text-body-sm text-nomi-ink shadow-nomi-lg"
      itemClassName="min-h-0 rounded-nomi-sm px-2 py-1"
      separatorClassName="my-1 mx-0 bg-nomi-line-soft"
      items={nodes}
      onOpenChange={onOpenChange}
    >
      <div data-testid="director-timeline-track">角色 1</div>
    </WorkbenchContextMenu>
  )
}
const timelineRow = (tree: ReturnType<typeof mountTree>) => tree.first((el) => el.getAttribute('data-testid') === 'director-timeline-track')!

describe('右键菜单迁入 WorkbenchMenu 特征测试（换前原版与换后 Radix 版共用同一套字面量断言）', () => {
  const cleanups: Array<() => void> = []

  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    dialogMocks.confirmDialog.mockReset().mockResolvedValue(true)
    dialogMocks.promptDialog.mockReset().mockResolvedValue('改名后节点')
    dialogMocks.showUndoToast.mockReset()
    useWorkbenchStore.setState({
      workbenchDocuments: [
        { id: 'doc-1', title: '第一场剧本', content: '', updatedAt: 100 },
        { id: 'doc-2', title: '第二场剧本', content: '', updatedAt: 200 },
      ],
      activeDocumentId: 'doc-1',
      activeStoryboardId: null,
      storyboardDesignsByDocumentId: {
        'doc-1': [
          {
            id: 'design-1',
            documentId: 'doc-1',
            title: '分镜方案 A',
            shots: [],
            committed: false,
            sourceDocumentUpdatedAt: 100,
            updatedAt: 100,
          },
        ],
      },
      categories: [
        ...BUILTIN_CATEGORIES,
        { id: 'custom-cat-1', name: '自定义镜头组', order: 10, isBuiltin: false },
      ],
      activeCategoryId: 'shots',
    })
    useGenerationCanvasStore.setState({
      nodes: [
        { id: 'node-1', kind: 'image', categoryId: 'shots', title: '开场远景', position: { x: 0, y: 0 }, meta: {} } as never,
      ],
      groups: [
        { id: 'group-1', categoryId: 'shots', name: '序幕分组', nodeIds: ['node-1'] } as never,
      ],
      selectedNodeIds: [],
    })
  })

  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.()
  })

  describe('DocumentListSidebar 右键菜单', () => {
    it('单文稿：右键文稿行出 2 项且删除禁用并带保底 title；点击重命名进入行内输入框；Esc 关闭', () => {
      useWorkbenchStore.setState({
        workbenchDocuments: [{ id: 'doc-1', title: '唯一文稿', content: '', updatedAt: 100 }],
        activeDocumentId: 'doc-1',
      })
      const tree = mountTree(<DocumentListSidebar />)
      cleanups.push(tree.unmount)

      const docBtn = tree.first((el) => el.getAttribute('data-document-row') === 'doc-1')!
      expect(docBtn).not.toBeNull()
      tree.triggerContextMenu(docBtn)

      const menu = tree.first((el) => el.getAttribute('role') === 'menu' && el.getAttribute('data-creation-resource-menu') === 'document')
      expect(menu).not.toBeNull()
      const items = menu!.querySelectorAll((el) => el.getAttribute('role') === 'menuitem')
      expect(items.map((el) => el.textContent.trim())).toEqual([
        i18n.t('creationAi.documentList.rename'),
        i18n.t('creationAi.documentList.delete'),
      ])
      expect(items.map((el) => el.getAttribute('data-resource-action'))).toEqual(['rename', 'delete'])

      const deleteItem = items[1]
      expect(tree.isDisabled(deleteItem)).toBe(true)
      expect(deleteItem.getAttribute('title')).toBe(i18n.t('creationAi.documentList.keepOneDocument'))

      // Esc 关闭菜单
      tree.pressEscape()
      expect(tree.first((el) => el.getAttribute('role') === 'menu')).toBeNull()

      // 重开并点重命名进入行内 input
      tree.triggerContextMenu(docBtn)
      const renameItem = tree.first((el) => el.getAttribute('role') === 'menuitem' && el.getAttribute('data-resource-action') === 'rename')!
      tree.activateMenuItem(renameItem)
      expect(tree.first((el) => el.getAttribute('role') === 'menu')).toBeNull()
      const input = tree.first((el) => el.nodeName === 'input' && el.getAttribute('aria-label') === i18n.t('creationAi.documentList.renameAria'))
      expect(input).not.toBeNull()
      expect(input!.props.value).toBe('唯一文稿')
    })

    it('多文稿与分镜方案：≥2 份文稿可删除；右键分镜方案出 3 项（重命名 / 复制方案 / 删除方案）且动作生效', async () => {
      const tree = mountTree(<DocumentListSidebar />)
      cleanups.push(tree.unmount)

      // 2 份文稿 → 删除项可点
      const docBtn = tree.first((el) => el.getAttribute('data-document-row') === 'doc-2')!
      tree.triggerContextMenu(docBtn)
      const deleteDoc = tree.first((el) => el.getAttribute('role') === 'menuitem' && el.getAttribute('data-resource-action') === 'delete')!
      expect(tree.isDisabled(deleteDoc)).toBe(false)
      tree.activateMenuItem(deleteDoc)
      await Promise.resolve()
      expect(dialogMocks.confirmDialog).toHaveBeenCalledTimes(1)
      expect(useWorkbenchStore.getState().workbenchDocuments.map((d) => d.id)).toEqual(['doc-1'])

      // 右键分镜方案 → 3 项顺序与动作
      const planBtn = tree.first((el) => el.getAttribute('data-storyboard-row') === 'design-1')!
      tree.triggerContextMenu(planBtn)
      const planMenu = tree.first((el) => el.getAttribute('role') === 'menu' && el.getAttribute('data-creation-resource-menu') === 'storyboard')
      expect(planMenu).not.toBeNull()
      const planItems = planMenu!.querySelectorAll((el) => el.getAttribute('role') === 'menuitem')
      expect(planItems.map((el) => el.textContent.trim())).toEqual([
        i18n.t('creationAi.documentList.rename'),
        i18n.t('creationAi.documentList.duplicateStoryboard'),
        i18n.t('creationAi.documentList.deleteStoryboard'),
      ])
      expect(planItems.map((el) => el.getAttribute('data-resource-action'))).toEqual(['rename', 'duplicate', 'delete'])

      // 复制方案
      tree.activateMenuItem(planItems[1])
      expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId['doc-1'].length).toBe(2)

      // 删除原方案（不弹 confirm，走撤销 toast）
      const planBtnAgain = tree.first((el) => el.getAttribute('data-storyboard-row') === 'design-1')!
      tree.triggerContextMenu(planBtnAgain)
      const delPlan = tree.first((el) => el.getAttribute('role') === 'menuitem' && el.getAttribute('data-resource-action') === 'delete')!
      tree.activateMenuItem(delPlan)
      expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId['doc-1'].some((d) => d.id === 'design-1')).toBe(false)
      expect(dialogMocks.showUndoToast).toHaveBeenCalledTimes(1)
    })
  })

  describe('CategoryTree 右键菜单', () => {
    const categoriesProp = (): ProjectCategory[] => useWorkbenchStore.getState().categories

    it('内置分类仅出「新建分组」1 项；自定义分类出「新建分组 / 重命名 / 删除分类」3 项；Esc 关闭', () => {
      const tree = mountTree(<CategoryTree categories={categoriesProp()} />)
      cleanups.push(tree.unmount)

      // 内置分类 shots
      const builtinRow = tree.first((el) => el.props.onContextMenu !== undefined && el.textContent.includes(i18n.t('libraries.sidebar.builtinCategory.shots')))!
      tree.triggerContextMenu(builtinRow)
      const builtinItems = tree.first((el) => el.getAttribute('role') === 'menu')!.querySelectorAll((el) => el.getAttribute('role') === 'menuitem')
      expect(builtinItems.map((el) => el.textContent.trim())).toEqual([
        i18n.t('libraries.sidebar.createGroup'),
      ])

      tree.pressEscape()
      expect(tree.first((el) => el.getAttribute('role') === 'menu')).toBeNull()

      // 自定义分类
      const customRow = tree.first((el) => el.props.onContextMenu !== undefined && el.textContent.includes('自定义镜头组'))!
      tree.triggerContextMenu(customRow)
      const customItems = tree.first((el) => el.getAttribute('role') === 'menu')!.querySelectorAll((el) => el.getAttribute('role') === 'menuitem')
      expect(customItems.map((el) => el.textContent.trim())).toEqual([
        i18n.t('libraries.sidebar.createGroup'),
        i18n.t('libraries.sidebar.rename'),
        i18n.t('libraries.sidebar.deleteCategory'),
      ])
    })

    it('节点行出「复制 / 重命名 / 重新生成衍生 / 删除」4 项；分组行出「重命名 / 解散分组 / 连同节点删除」3 项', () => {
      const copySpy = vi.fn(() => null)
      const regenSpy = vi.fn()
      const ungroupSpy = vi.fn()
      useGenerationCanvasStore.setState({
        copyNodeToCategory: copySpy as never,
        duplicateNodeForRegeneration: regenSpy as never,
        ungroup: ungroupSpy as never,
      })
      const tree = mountTree(<CategoryTree categories={categoriesProp()} />)
      cleanups.push(tree.unmount)

      // 右键分组行（序幕分组）
      const groupRow = tree.first((el) => el.props.onContextMenu !== undefined && el.textContent.includes('序幕分组') && !el.textContent.includes('开场远景'))!
      expect(groupRow).not.toBeNull()
      tree.triggerContextMenu(groupRow)
      const groupItems = tree.first((el) => el.getAttribute('role') === 'menu')!.querySelectorAll((el) => el.getAttribute('role') === 'menuitem')
      expect(groupItems.map((el) => el.textContent.trim())).toEqual([
        i18n.t('libraries.sidebar.rename'),
        i18n.t('libraries.sidebar.ungroup'),
        i18n.t('libraries.sidebar.deleteWithNodes'),
      ])
      tree.activateMenuItem(groupItems[1])
      expect(ungroupSpy).toHaveBeenCalledWith('group-1')

      // 右键节点行（开场远景）
      const nodeRow = tree.first((el) => el.props.onContextMenu !== undefined && el.textContent.includes('开场远景') && !el.textContent.includes('序幕分组'))!
      expect(nodeRow).not.toBeNull()
      tree.triggerContextMenu(nodeRow)
      const nodeItems = tree.first((el) => el.getAttribute('role') === 'menu')!.querySelectorAll((el) => el.getAttribute('role') === 'menuitem')
      expect(nodeItems.map((el) => el.textContent.trim())).toEqual([
        i18n.t('libraries.sidebar.copy'),
        i18n.t('libraries.sidebar.rename'),
        i18n.t('libraries.sidebar.regenerateDerived'),
        i18n.t('common.delete'),
      ])
      tree.activateMenuItem(nodeItems[0])
      expect(copySpy).toHaveBeenCalledWith('node-1', 'shots')

      tree.triggerContextMenu(nodeRow)
      const regenItem = tree.first((el) => el.getAttribute('role') === 'menu')!.querySelectorAll((el) => el.getAttribute('role') === 'menuitem')[2]
      tree.activateMenuItem(regenItem)
      expect(regenSpy).toHaveBeenCalledWith('node-1')
    })
  })

  describe('导演台时间轴行右键菜单（WorkbenchContextMenu）', () => {
    it('挂 data-nomi-escape-layer="director-timeline-menu"，渲染分隔线与 disabled+title，点可用项触发 onSelect 并关闭，Esc 关闭', () => {
      const onSplit = vi.fn()
      const onLocked = vi.fn()
      const onDelete = vi.fn()
      const onClose = vi.fn()
      const splitLabel = i18n.t('generationCommon.clipNode.split')
      const pasteLabel = 'Paste Clip Item'
      const emptyReason = i18n.t('director.timeline.toast.clipboardEmpty')
      const deleteLabel = i18n.t('director.timeline.menu.deleteClip')
      const items: TimelineItemSpec[] = [
        { id: 'split', label: splitLabel, onSelect: onSplit },
        { id: 'locked', label: pasteLabel, disabled: true, title: emptyReason, onSelect: onLocked },
        { id: 'sep-1', separator: true },
        { id: 'delete', label: deleteLabel, danger: true, onSelect: onDelete },
      ]
      const onOpenChange = vi.fn((open: boolean) => { if (!open) onClose() })
      const tree = mountTree(<TimelineRowMenu items={items} onOpenChange={onOpenChange} />)
      cleanups.push(tree.unmount)
      tree.triggerContextMenu(timelineRow(tree), 120, 240)

      const menu = tree.first((el) => el.getAttribute('role') === 'menu')
      expect(menu).not.toBeNull()
      expect(menu!.getAttribute('data-nomi-escape-layer')).toBe('director-timeline-menu')
      expect(menu!.querySelectorAll((el) => el.getAttribute('role') === 'separator').length).toBe(1)

      const menuItems = menu!.querySelectorAll((el) => el.getAttribute('role') === 'menuitem')
      expect(menuItems.map((el) => el.textContent.trim())).toEqual([splitLabel, pasteLabel, deleteLabel])
      expect(tree.isDisabled(menuItems[1])).toBe(true)
      expect(menuItems[1].getAttribute('title')).toBe(emptyReason)

      // 点禁用项不触发 onSelect / onClose
      tree.activateMenuItem(menuItems[1])
      expect(onLocked).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()

      // 点可用项触发 onSelect 并关闭
      tree.activateMenuItem(menuItems[0])
      expect(onSplit).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)

      // Esc 关闭
      onClose.mockClear()
      tree.triggerContextMenu(timelineRow(tree), 120, 240)
      expect(tree.first((el) => el.getAttribute('role') === 'menu')).not.toBeNull()
      tree.pressEscape()
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(tree.first((el) => el.getAttribute('role') === 'menu')).toBeNull()
    })
  })

  describe('老用户升级（★1c）：真实 v0.24.1 项目夹具加载与右键菜单操作', () => {
    it('加载 tests/fixtures/old-user-data/projects/v0.24.1-storyboard 与 v0.24.1-pending-asset：文稿/方案/分类/节点右键菜单可用且零落盘污染', () => {
      const storyboardFixture = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/old-user-data/projects/v0.24.1-storyboard/project/.nomi/project.json'), 'utf8'),
      )
      const pendingFixture = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/old-user-data/projects/v0.24.1-pending-asset/project/.nomi/project.json'), 'utf8'),
      )
      const sbPayload = storyboardFixture.payload
      const paPayload = pendingFixture.payload

      useWorkbenchStore.setState({
        workbenchDocuments: structuredClone(sbPayload.workbenchDocuments),
        activeDocumentId: sbPayload.activeDocumentId,
        activeStoryboardId: null,
        storyboardDesignsByDocumentId: structuredClone(sbPayload.storyboardDesignsByDocumentId),
        categories: structuredClone(sbPayload.categories),
        activeCategoryId: 'shots',
      })
      useGenerationCanvasStore.setState({
        nodes: structuredClone(paPayload.generationCanvas.nodes),
        groups: structuredClone(paPayload.generationCanvas.groups),
        selectedNodeIds: [],
      })

      // 1) 真实 v0.24.1 文稿与分镜方案右键菜单：打开、复制方案、进入改名均正常
      const docTree = mountTree(<DocumentListSidebar />)
      cleanups.push(docTree.unmount)
      const oldDocId = sbPayload.workbenchDocuments[1].id as string
      const oldDesignId = sbPayload.storyboardDesignsByDocumentId[oldDocId][0].id as string
      const oldDocBtn = docTree.first((el) => el.getAttribute('data-document-row') === oldDocId)!
      expect(oldDocBtn.textContent).toContain('Old bookshop script')
      docTree.triggerContextMenu(oldDocBtn)
      expect(docTree.first((el) => el.getAttribute('data-creation-resource-menu') === 'document')).not.toBeNull()
      docTree.pressEscape()

      const oldPlanBtn = docTree.first((el) => el.getAttribute('data-storyboard-row') === oldDesignId)!
      docTree.triggerContextMenu(oldPlanBtn)
      const dupPlan = docTree.first((el) => el.getAttribute('role') === 'menuitem' && el.getAttribute('data-resource-action') === 'duplicate')!
      docTree.activateMenuItem(dupPlan)
      expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId[oldDocId].length).toBe(2)

      // 2) 真实 v0.24.1 分类与节点右键菜单：打开并操作正常，不往持久化字段写入菜单瞬态
      const catTree = mountTree(<CategoryTree categories={useWorkbenchStore.getState().categories} />)
      cleanups.push(catTree.unmount)
      const oldNode = paPayload.generationCanvas.nodes[0]
      const nodeRow = catTree.first((el) => el.props.onContextMenu !== undefined && el.textContent.includes(oldNode.title || oldNode.id))
      expect(nodeRow).not.toBeNull()
      catTree.triggerContextMenu(nodeRow!)
      const menuItems = catTree.first((el) => el.getAttribute('role') === 'menu')!.querySelectorAll((el) => el.getAttribute('role') === 'menuitem')
      expect(menuItems.length).toBe(4)
      catTree.pressEscape()

      // 校验 store 中没有残留任何菜单坐标字段
      const persistedDocKeys = Object.keys(useWorkbenchStore.getState().workbenchDocuments[0])
      expect(persistedDocKeys).not.toContain('menu')
      expect(persistedDocKeys).not.toContain('contextMenu')
    })
  })

  describe('Radix WorkbenchMenu 迁移后新增能力正例（方向键导航 + pointerdown 点外关闭）', () => {
    it('方向键（ArrowDown / ArrowUp）可在菜单项间移动焦点，并跳过禁用项', async () => {
      const onSplit = vi.fn()
      const onDelete = vi.fn()
      const onClose = vi.fn()
      const items: TimelineItemSpec[] = [
        { id: 'split', label: i18n.t('generationCommon.clipNode.split'), onSelect: onSplit },
        { id: 'locked', label: 'Paste Clip Item', disabled: true, title: i18n.t('director.timeline.toast.clipboardEmpty'), onSelect: () => undefined },
        { id: 'delete', label: i18n.t('director.timeline.menu.deleteClip'), danger: true, onSelect: onDelete },
      ]
      const tree = mountTree(<TimelineRowMenu items={items} onOpenChange={(open) => { if (!open) onClose() }} />)
      cleanups.push(tree.unmount)
      tree.triggerContextMenu(timelineRow(tree), 120, 240)

      const menuItems = tree.first((el) => el.getAttribute('role') === 'menu')!.querySelectorAll((el) => el.getAttribute('role') === 'menuitem')
      // 初始焦点移至首项，ArrowDown 跳过 disabled 的第 2 项直达第 3 项，ArrowUp 返回第 1 项
      menuItems[0].focus()
      tree.pressKey('ArrowDown')
      await new Promise((r) => setTimeout(r, 10))
      expect(tree.win.document.activeElement).toBe(menuItems[2])
      tree.pressKey('ArrowUp')
      await new Promise((r) => setTimeout(r, 10))
      expect(tree.win.document.activeElement).toBe(menuItems[0])
    })

    it('仅派发外部 pointerdown（无 click）即关闭三处菜单（修复原 CategoryTree 仅听 bubble click 被 zoom 吞掉的问题）', async () => {
      // 1) DocumentListSidebar
      const docTree = mountTree(<DocumentListSidebar />)
      cleanups.push(docTree.unmount)
      const docBtn = docTree.first((el) => el.getAttribute('data-document-row') === 'doc-1')!
      docTree.triggerContextMenu(docBtn)
      expect(docTree.first((el) => el.getAttribute('role') === 'menu')).not.toBeNull()
      await new Promise((r) => setTimeout(r, 10))
      docTree.pointerDownOutsideOnly()
      expect(docTree.first((el) => el.getAttribute('role') === 'menu')).toBeNull()

      // 2) CategoryTree（原手写版只听 window bubble click，被 d3-zoom 吞掉不关闭；迁 Radix 后仅 pointerdown 必关）
      const catTree = mountTree(<CategoryTree categories={[...BUILTIN_CATEGORIES]} />)
      cleanups.push(catTree.unmount)
      const catRow = catTree.first((el) => el.props.onContextMenu !== undefined)!
      catTree.triggerContextMenu(catRow)
      expect(catTree.first((el) => el.getAttribute('role') === 'menu')).not.toBeNull()
      await new Promise((r) => setTimeout(r, 10))
      catTree.pointerDownOutsideOnly()
      expect(catTree.first((el) => el.getAttribute('role') === 'menu')).toBeNull()

      // 3) 导演台时间轴行右键
      const onClose = vi.fn()
      const tlTree = mountTree(
        <TimelineRowMenu
          items={[{ id: 'split', label: i18n.t('generationCommon.clipNode.split'), onSelect: () => undefined }]}
          onOpenChange={(open) => { if (!open) onClose() }}
        />,
      )
      cleanups.push(tlTree.unmount)
      tlTree.triggerContextMenu(timelineRow(tlTree), 120, 240)
      expect(tlTree.first((el) => el.getAttribute('role') === 'menu')).not.toBeNull()
      await new Promise((r) => setTimeout(r, 10))
      tlTree.pointerDownOutsideOnly()
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('按 Esc 关闭菜单时阻断事件继续冒到 window，不连带关掉外层抽屉（如 ShellRail）', () => {
      const docTree = mountTree(<DocumentListSidebar />)
      cleanups.push(docTree.unmount)
      const outerWindowEsc = vi.fn()
      docTree.win.addEventListener('keydown', (ev) => {
        if ((ev as { key?: string }).key === 'Escape') outerWindowEsc()
      })
      const docBtn = docTree.first((el) => el.getAttribute('data-document-row') === 'doc-1')!
      docTree.triggerContextMenu(docBtn)
      expect(docTree.first((el) => el.getAttribute('role') === 'menu')).not.toBeNull()

      docTree.pressEscape()
      expect(docTree.first((el) => el.getAttribute('role') === 'menu')).toBeNull()
      expect(outerWindowEsc).not.toHaveBeenCalled()
    })

    it('危险项（未禁用）挂 data-danger 与高权重红色类，禁用态不挂 data-danger（不被 itemClassName 文字色覆盖）', () => {
      // 1) 单文稿：删除原稿被禁用 → 不挂 data-danger
      useWorkbenchStore.setState({
        workbenchDocuments: [useWorkbenchStore.getState().workbenchDocuments[0]],
      })
      const singleDocTree = mountTree(<DocumentListSidebar />)
      cleanups.push(singleDocTree.unmount)
      const docBtn = singleDocTree.first((el) => el.getAttribute('data-document-row') === 'doc-1')!
      singleDocTree.triggerContextMenu(docBtn)
      const disabledDelete = singleDocTree.first((el) => el.getAttribute('role') === 'menuitem' && el.getAttribute('data-resource-action') === 'delete')!
      expect(disabledDelete.hasAttribute('data-danger')).toBe(false)
      singleDocTree.pressEscape()

      // 2) 分镜方案（design-1）：删除方案未禁用 → 必挂 data-danger 且类名含 data-[danger]:text-workbench-danger
      const planBtn = singleDocTree.first((el) => el.getAttribute('data-storyboard-row') === 'design-1')!
      singleDocTree.triggerContextMenu(planBtn)
      const enabledDelete = singleDocTree.first((el) => el.getAttribute('role') === 'menuitem' && el.getAttribute('data-resource-action') === 'delete')!
      expect(enabledDelete.hasAttribute('data-danger')).toBe(true)
      expect(String(enabledDelete.props.className)).toContain('data-[danger]:text-workbench-danger')

      // 3) CategoryTree：节点删除未禁用 → 必挂 data-danger
      const catTree = mountTree(<CategoryTree categories={[...BUILTIN_CATEGORIES]} />)
      cleanups.push(catTree.unmount)
      const nodeRow = catTree.first((el) => el.props.onContextMenu !== undefined && el.textContent.includes('开场远景'))!
      catTree.triggerContextMenu(nodeRow)
      const catItems = catTree.first((el) => el.getAttribute('role') === 'menu')!.querySelectorAll((el) => el.getAttribute('role') === 'menuitem')
      expect(catItems[0].hasAttribute('data-danger')).toBe(false)
      expect(catItems[3].hasAttribute('data-danger')).toBe(true)
    })
  })
})
