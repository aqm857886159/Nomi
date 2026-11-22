// 顶栏 Nomi 入口（#1603）三处入口侧接线断言：
//   1. 眨眼：挂真实 ShellTopBar → NomiEntrySlot → ShellNomiEntry → NomiAgentFace（不 mock 脸），
//      测空闲 / 未读 20 秒眨眼与 600ms 摘掉 data-blink、减弱动效 / 后台页签 / 非空闲态不眨；
//   2. 点开聚焦 / ⌘J：挂真实 ShellTopBar + ShellAgentHost + 真实 residentComposerFocus 接收端，
//      测收起态点入口、展开态再点入口、⌘J / Ctrl+J、整窗模态拦 ⌘J 后焦点是否真正落进输入框；
//   3. 窄窗临时收起：同一窗口宽度同时驱动 ShellAgentHost 的 matchMedia(NARROW_TIER_QUERY) 与
//      ShellTopBar 的 ResizeObserver（topbarRoomy），测宽→窄临时收起、入口同步回到未按下态、
//      窄窗下点入口临时开浮窗并聚焦、再点临时收起、窄于 900 胶囊退角标、拉宽自动停回，全程存档零写入。
// 判据：把这三处任一入口侧接线删掉，对应测试必须真实报红。
import { createRequire } from 'node:module'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type KeyListener = (event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  preventDefault: () => void
}) => void
type MediaListener = (event: { matches: boolean }) => void
type ResizeCallback = () => void

const env = vi.hoisted(() => {
  const storageMap = new Map<string, string>()
  const keyListeners = new Set<KeyListener>()
  const narrowListeners = new Set<MediaListener>()
  const resizeObservers = new Set<{ callback: ResizeCallback; targets: Set<unknown> }>()
  const rafQueue = new Map<number, FrameRequestCallback>()
  let rafSeq = 0
  let windowWidth = 1200
  let reducedMotion = false
  let documentHidden = false

  const storage = {
    getItem: (key: string) => (storageMap.has(key) ? storageMap.get(key)! : null),
    setItem: (key: string, value: string) => void storageMap.set(key, String(value)),
    removeItem: (key: string) => void storageMap.delete(key),
    clear: () => void storageMap.clear(),
  }

  const narrowQuery = {
    get matches() { return windowWidth < 1060 },
    addEventListener: (_type: string, listener: MediaListener) => void narrowListeners.add(listener),
    removeEventListener: (_type: string, listener: MediaListener) => void narrowListeners.delete(listener),
  }
  const reducedMotionQuery = {
    get matches() { return reducedMotion },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const otherQuery = {
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }

  const body = { nodeType: 1, contains: () => false }
  const fakeDocument = {
    body,
    get hidden() { return documentHidden },
    documentElement: {
      lang: 'zh-CN',
      dataset: {},
      classList: { add: () => undefined, remove: () => undefined, toggle: () => undefined, contains: () => false },
      style: {},
      setAttribute: () => undefined,
    },
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }

  const requestAnimationFrame = (callback: FrameRequestCallback): number => {
    rafSeq += 1
    rafQueue.set(rafSeq, callback)
    return rafSeq
  }
  const cancelAnimationFrame = (id: number): void => {
    rafQueue.delete(id)
  }

  const fakeWindow = {
    document: fakeDocument,
    localStorage: storage,
    matchMedia: (query: string) => {
      if (/prefers-reduced-motion/.test(query)) return reducedMotionQuery
      if (/width/.test(query)) return narrowQuery
      return otherQuery
    },
    addEventListener: (type: string, listener: KeyListener) => {
      if (type === 'keydown') keyListeners.add(listener)
    },
    removeEventListener: (type: string, listener: KeyListener) => {
      if (type === 'keydown') keyListeners.delete(listener)
    },
    dispatchEvent: () => true,
    requestAnimationFrame,
    cancelAnimationFrame,
    setTimeout: (callback: () => void, ms?: number) => globalThis.setTimeout(callback, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
    event: undefined,
  }

  class TestResizeObserver {
    private readonly entry: { callback: ResizeCallback; targets: Set<unknown> }
    constructor(callback: ResizeCallback) {
      this.entry = { callback, targets: new Set() }
      resizeObservers.add(this.entry)
    }
    observe(target: unknown): void { this.entry.targets.add(target) }
    unobserve(target: unknown): void { this.entry.targets.delete(target) }
    disconnect(): void { this.entry.targets.clear(); resizeObservers.delete(this.entry) }
  }

  Object.assign(globalThis, {
    window: fakeWindow,
    document: fakeDocument,
    localStorage: storage,
    ResizeObserver: TestResizeObserver,
    requestAnimationFrame,
    cancelAnimationFrame,
    IS_REACT_ACT_ENVIRONMENT: false,
  })
  Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel', userAgent: 'node' }, configurable: true })

  return {
    storageMap,
    keyListeners,
    narrowListeners,
    resizeObservers,
    rafQueue,
    get windowWidth() { return windowWidth },
    setWindowWidth(next: number, options: { silent?: boolean } = {}) {
      const wasNarrow = windowWidth < 1060
      windowWidth = next
      const isNarrow = windowWidth < 1060
      if (!options.silent) {
        if (wasNarrow !== isNarrow) {
          for (const listener of [...narrowListeners]) listener({ matches: isNarrow })
        }
        for (const observer of [...resizeObservers]) {
          if (observer.targets.size > 0) observer.callback()
        }
      }
    },
    setReducedMotion(next: boolean) { reducedMotion = next },
    setDocumentHidden(next: boolean) { documentHidden = next },
    flushRaf(rounds = 1) {
      for (let i = 0; i < rounds; i += 1) {
        const due = [...rafQueue.entries()]
        rafQueue.clear()
        for (const [, callback] of due) callback(0)
      }
    },
    resetGlobals() {
      storageMap.clear()
      rafQueue.clear()
      windowWidth = 1200
      reducedMotion = false
      documentHidden = false
    },
  }
})

// 仅替换第三方 DOM 门户 / 拖拽库与顶栏里与 Nomi 入口无关的兄弟按钮；
// ShellTopBar、NomiEntrySlot、useNomiEntry、ShellNomiEntry、NomiAgentFace、ShellAgentHost、
// agentFormStore、agentFormViewStore、residentActivity、residentComposerFocus 全部跑真实现。
vi.mock('react-rnd', () => ({ Rnd: ({ children }: { children?: unknown }) => children ?? null }))
vi.mock('react-reverse-portal', () => ({
  createHtmlPortalNode: () => ({}),
  InPortal: ({ children }: { children?: unknown }) => children ?? null,
  OutPortal: () => null,
}))
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (children: unknown) => children,
}))
vi.mock('../../../design', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const Pass = ({ children }: { children?: unknown }) => children ?? null
  return {
    ...actual,
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent: () => null,
    TooltipProvider: Pass,
    WorkbenchMenu: () => null,
  }
})
vi.mock('../../../workbench/taskCenter/TaskCenterButton', () => ({ TaskCenterButton: () => null }))
vi.mock('../../../workbench/preview/EditingLayoutMenu', () => ({ default: () => null }))
vi.mock('../UpdatePill', () => ({ UpdatePill: () => null }))
vi.mock('../../../workbench/library/localProjectStore', () => ({ useLocalProjects: () => ({ projects: [] }) }))
vi.mock('../../../workbench/onboarding/onboardingProgress', () => ({
  useOnboardingProgress: () => ({ active: false, total: 0, doneCount: 0 }),
}))

import '../../../i18n'
import { openModalInputLayer } from '../../../design/modalInputLayer'
import { useResidentActivityStore } from '../../../workbench/ai/residentActivity'
import {
  focusEditorAtEnd,
  useResidentComposerFocusRequest,
  useResidentComposerFocusStore,
} from '../../../workbench/ai/residentComposerFocus'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import {
  AGENT_FORM_STORAGE_KEY,
  chooseAgentPlacement,
  collapseAgent,
  setAgentWindowNarrow,
  shownForm,
  useAgentFormStore,
  type AgentFormSurface,
} from './agentFormStore'
import { useAgentFormViewStore } from './agentFormViewStore'
import { ShellAgentHost } from './ShellAgentHost'
import { ShellTopBar } from './ShellTopBar'

// ── 树形 React reconciler：维护真实挂载树、DOM 属性（供 useAgentBlink 读写 data-blink）与几何测量 ──

type TextChild = { kind: 'text'; text: string; parent: HostElement | null }
type ChildNode = HostElement | TextChild

class HostElement {
  readonly kind = 'element' as const
  readonly nodeType = 1
  parent: HostElement | null = null
  children: ChildNode[] = []
  readonly attributes = new Map<string, string>()

  constructor(public readonly type: string, public props: Record<string, unknown>) {}

  get clientWidth(): number { return env.windowWidth }
  get clientHeight(): number { return 800 }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value))
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
  hasAttribute(name: string): boolean {
    if (this.attributes.has(name)) return true
    const value = this.props[name]
    if (name.startsWith('aria-')) return value !== undefined && value !== null
    return value !== undefined && value !== false && value !== null
  }
  getAttribute(name: string): string | null {
    if (this.attributes.has(name)) return this.attributes.get(name)!
    const value = this.props[name]
    if (value === undefined || value === null) return null
    if (name.startsWith('aria-')) return String(value)
    if (value === false) return null
    return value === true ? '' : String(value)
  }
  getBoundingClientRect() {
    if (this.hasAttribute('data-shell-topbar')) {
      return { left: 0, top: 0, right: env.windowWidth, bottom: 40, width: env.windowWidth, height: 40 }
    }
    if (this.props.role === 'toolbar') {
      return { left: Math.max(0, env.windowWidth - 200), top: 0, right: Math.max(0, env.windowWidth - 8), bottom: 40, width: 192, height: 40 }
    }
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  }
  get textContent(): string {
    return this.children.map((child) => (child.kind === 'text' ? child.text : child.textContent)).join('')
  }
  querySelectorAll(selector: string): HostElement[] {
    const match = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(selector.trim())
    if (!match) return []
    const [, attr, expected] = match
    const hits: HostElement[] = []
    const visit = (node: HostElement): void => {
      for (const child of node.children) {
        if (child.kind !== 'element') continue
        if (child.hasAttribute(attr) && (expected === undefined || child.getAttribute(attr) === expected)) {
          hits.push(child)
        }
        visit(child)
      }
    }
    visit(this)
    return hits
  }
  querySelector(selector: string): HostElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }
  closest(): null { return null }
}

function appendNode(parent: HostElement, child: ChildNode): void {
  if (child.parent) removeNode(child.parent, child)
  child.parent = parent
  parent.children.push(child)
}

function insertNodeBefore(parent: HostElement, child: ChildNode, before: ChildNode): void {
  if (child.parent) removeNode(child.parent, child)
  child.parent = parent
  const index = parent.children.indexOf(before)
  if (index < 0) parent.children.push(child)
  else parent.children.splice(index, 0, child)
}

function removeNode(parent: HostElement, child: ChildNode): void {
  const index = parent.children.indexOf(child)
  if (index >= 0) parent.children.splice(index, 1)
  if (child.parent === parent) child.parent = null
}

const require = createRequire(import.meta.url)
const Reconciler = require('react-reconciler')

function createTreeRenderer() {
  const errors: unknown[] = []
  const assertNoHostErrors = () => { if (errors.length) throw errors.shift() }
  const container = new HostElement('root', {})
  const reconciler = Reconciler({
    now: () => Date.now(),
    supportsMutation: true,
    isPrimaryRenderer: true,
    getRootHostContext: () => ({}),
    getChildHostContext: () => ({}),
    getPublicInstance: (instance: HostElement) => instance,
    prepareForCommit: () => null,
    resetAfterCommit: () => undefined,
    shouldSetTextContent: () => false,
    createInstance: (type: string, props: Record<string, unknown>) => new HostElement(type, props),
    createTextInstance: (text: string): TextChild => ({ kind: 'text', text, parent: null }),
    appendInitialChild: appendNode,
    appendChild: appendNode,
    appendChildToContainer: appendNode,
    insertBefore: insertNodeBefore,
    insertInContainerBefore: insertNodeBefore,
    removeChild: removeNode,
    removeChildFromContainer: removeNode,
    clearContainer: (root: HostElement) => { root.children = [] },
    detachDeletedInstance: () => undefined,
    finalizeInitialChildren: () => false,
    prepareUpdate: () => true,
    commitUpdate: (instance: HostElement, _type: string, _oldProps: Record<string, unknown>, newProps: Record<string, unknown>) => {
      instance.props = newProps
    },
    commitTextUpdate: (textInstance: TextChild, _oldText: string, newText: string) => {
      textInstance.text = newText
    },
    scheduleTimeout: (fn: () => void, delay?: number) => globalThis.setTimeout(fn, delay),
    cancelTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
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
  const root = reconciler.createContainer(container, 0, null, false, null, '', (error: unknown) => errors.push(error), null)
  const flush = () => {
    reconciler.flushPassiveEffects()
    reconciler.flushSyncWork()
    reconciler.flushPassiveEffects()
    reconciler.flushSyncWork()
    assertNoHostErrors()
  }
  return {
    container,
    render(element: React.ReactElement | null) {
      reconciler.flushSyncFromReconciler(() => reconciler.updateContainerSync(element, root, null, () => undefined))
      reconciler.flushSyncWork()
      assertNoHostErrors()
      flush()
    },
    flush,
    close() {
      reconciler.flushSyncFromReconciler(() => reconciler.updateContainerSync(null, root, null, () => undefined))
      reconciler.flushSyncWork()
      flush()
    },
  }
}

// ── 测试夹具：挂真实 ShellTopBar + ShellAgentHost + 真实 residentComposerFocus 接收端 ──

type FakeComposerEditor = {
  isDestroyed: boolean
  view: { hasFocus(): boolean; focus(): void }
  commands: { focus(position: 'end'): boolean }
  blur(): void
  focusCalls: number
}

function createComposerEditor(canLandFocus: () => boolean): FakeComposerEditor {
  let focused = false
  const editor: FakeComposerEditor = {
    isDestroyed: false,
    focusCalls: 0,
    view: {
      hasFocus: () => focused,
      focus: () => {
        editor.focusCalls += 1
        if (canLandFocus()) focused = true
      },
    },
    commands: {
      focus: () => true,
    },
    blur: () => { focused = false },
  }
  return editor
}

/** 真实聚焦接收端：走 residentComposerFocus.ts 的 useResidentComposerFocusRequest + focusEditorAtEnd。 */
function ComposerFocusReceiver({ editor }: { editor: FakeComposerEditor }): React.JSX.Element {
  const focus = React.useCallback(() => focusEditorAtEnd(editor), [editor])
  useResidentComposerFocusRequest(focus)
  return <div data-test-composer />
}

type MountOptions = {
  surface?: AgentFormSurface
  workspaceMode?: 'creation' | 'generation' | 'preview' | null
  initialWidth?: number
  initialForm?: 'collapsed' | 'float' | 'dock'
}

function mountTopbarAndHost(options: MountOptions = {}) {
  const surface = options.surface ?? 'creation'
  const workspaceMode = options.workspaceMode === undefined ? (surface === 'storyboard' ? 'creation' : surface) : options.workspaceMode
  const width = options.initialWidth ?? 1200

  env.setWindowWidth(width, { silent: true })
  useAgentFormViewStore.setState(useAgentFormViewStore.getInitialState(), true)
  useAgentFormStore.setState(useAgentFormStore.getInitialState(), true)
  useResidentActivityStore.setState(useResidentActivityStore.getInitialState(), true)
  useResidentComposerFocusStore.setState({ request: null })
  useWorkbenchStore.setState({ workspaceMode: workspaceMode ?? 'creation', agentRecallNonce: 0, projectAgentDockCollapsed: false } as never)

  // 先在宽窗下把本页存成目标初始形态，再切回初始宽度，确保 localStorage 有基线存档可做逐字节比对。
  setAgentWindowNarrow(false, { animate: false })
  if (options.initialForm === 'collapsed') collapseAgent(surface)
  else if (options.initialForm === 'float') chooseAgentPlacement(surface, 'float')
  else if (options.initialForm === 'dock') chooseAgentPlacement(surface, 'dock')
  // 强制触发一次 persist 写盘，让磁盘基线非空。
  useAgentFormStore.setState((state) => ({ bySurface: { ...state.bySurface } }))
  setAgentWindowNarrow(width < 1060, { animate: false })

  // 真实面板在收起时挪进 hidden 容器，focus 必然落空；只有展开后（shownForm !== 'collapsed'）焦点才能真正落进编辑器。
  const editor = createComposerEditor(() => shownForm(surface) !== 'collapsed')
  const tree = createTreeRenderer()

  const renderApp = (mode = workspaceMode) => {
    tree.render(
      <>
        <ShellTopBar
          workspaceMode={mode}
          onWorkspaceModeChange={() => undefined}
          projectId="proj-1"
          projectName="测试项目"
          agentSurface={surface}
        />
        <ShellAgentHost
          surface={surface}
          dockTarget={null}
          agent={<ComposerFocusReceiver editor={editor} />}
        />
      </>,
    )
  }
  renderApp()
  // 浮窗 / 顶栏初测后的二次稳定提交。
  renderApp()

  const topbar = (): HostElement => {
    const node = tree.container.querySelector('[data-shell-topbar]')
    if (!node) throw new Error('找不到 [data-shell-topbar]')
    return node
  }
  const entry = (): HostElement | null => topbar().querySelector('[data-shell-nomi-entry]')
  const mustEntry = (): HostElement => {
    const node = entry()
    if (!node) throw new Error('顶栏里找不到 [data-shell-nomi-entry]')
    return node
  }
  const hostForm = (): string | null => tree.container.querySelector('[data-shell-agent-layer]')?.getAttribute('data-agent-form') ?? null

  return {
    tree,
    editor,
    topbar,
    entry,
    mustEntry,
    hostForm,
    disk: () => env.storageMap.get(AGENT_FORM_STORAGE_KEY) ?? null,
    clickEntry() {
      const button = mustEntry()
      const onClick = button.props.onClick as ((event: unknown) => void) | undefined
      if (!onClick) throw new Error('顶栏 Nomi 入口按钮缺少 onClick')
      onClick({ preventDefault: () => undefined, stopPropagation: () => undefined })
      tree.flush()
    },
    pressShortcut(key: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = { metaKey: true }) {
      let prevented = false
      const event = {
        key,
        metaKey: Boolean(mods.metaKey),
        ctrlKey: Boolean(mods.ctrlKey),
        altKey: false,
        shiftKey: false,
        preventDefault: () => { prevented = true },
      }
      for (const listener of [...env.keyListeners]) listener(event)
      tree.flush()
      return { prevented }
    },
    resizeWindow(nextWidth: number) {
      env.setWindowWidth(nextWidth)
      tree.flush()
    },
    flush() {
      tree.flush()
    },
    close() {
      tree.close()
    },
  }
}

let mounted: ReturnType<typeof mountTopbarAndHost> | null = null

beforeEach(() => {
  env.resetGlobals()
})

afterEach(() => {
  mounted?.close()
  mounted = null
  vi.useRealTimers()
})

// ── 1. 眨眼（顶栏入口侧：ShellTopBar → ShellNomiEntry → NomiAgentFace） ────────────────────────────

describe('顶栏入口侧接线 ①：眨眼（ShellTopBar → ShellNomiEntry → NomiAgentFace）', () => {
  it('空闲与未读态：顶栏入口内的真实 NomiAgentFace 20 秒眨一次、600ms 后摘掉 data-blink', () => {
    vi.useFakeTimers()
    mounted = mountTopbarAndHost({ surface: 'generation', initialForm: 'collapsed', initialWidth: 1200 })
    useResidentActivityStore.getState().setResidentDockBadge('idle', 'idle', 0, 0)
    mounted.flush()

    const faceIdle = mounted.mustEntry().querySelector('[data-nomi-agent-face]')
    expect(faceIdle, '顶栏入口里必须挂真实活形象 NomiAgentFace').not.toBeNull()
    expect(faceIdle!.getAttribute('data-nomi-agent-face')).toBe('idle')
    expect(faceIdle!.hasAttribute('data-blink')).toBe(false)

    vi.advanceTimersByTime(19_999)
    expect(faceIdle!.hasAttribute('data-blink')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(faceIdle!.hasAttribute('data-blink'), '空闲态满 20 秒必须给顶栏入口脸加上 data-blink').toBe(true)
    vi.advanceTimersByTime(599)
    expect(faceIdle!.hasAttribute('data-blink')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(faceIdle!.hasAttribute('data-blink'), '眨眼 600ms 后必须摘掉 data-blink').toBe(false)

    // 切到未读态（idle + unread > 0 → look.status = 'unread'）：姿态同步到入口脸，下一个 20s 整点照常眨眼（前一个 20s + 600ms 已经走到 20_600ms，距下一次 40_000ms 还差 19_400ms）。
    useResidentActivityStore.getState().setResidentDockBadge('idle', 'idle', 0, 3)
    mounted.flush()
    const faceUnread = mounted.mustEntry().querySelector('[data-nomi-agent-face]')
    expect(faceUnread!.getAttribute('data-nomi-agent-face')).toBe('unread')
    vi.advanceTimersByTime(19_400)
    expect(faceUnread!.hasAttribute('data-blink'), '未读态满下一个 20 秒周期也必须眨眼').toBe(true)
    vi.advanceTimersByTime(600)
    expect(faceUnread!.hasAttribute('data-blink')).toBe(false)
  })

  it('减弱动效或页面在后台时：顶栏入口脸不加 data-blink', () => {
    vi.useFakeTimers()
    env.setReducedMotion(true)
    mounted = mountTopbarAndHost({ surface: 'generation', initialForm: 'collapsed', initialWidth: 1200 })
    useResidentActivityStore.getState().setResidentDockBadge('idle', 'idle', 0, 0)
    mounted.flush()

    const face = mounted.mustEntry().querySelector('[data-nomi-agent-face]')!
    let sawReducedBlink = false
    for (let step = 0; step < 82; step += 1) {
      vi.advanceTimersByTime(500)
      if (face.hasAttribute('data-blink')) sawReducedBlink = true
    }
    expect(sawReducedBlink, 'prefers-reduced-motion: reduce 时入口脸不得眨眼').toBe(false)

    env.setReducedMotion(false)
    env.setDocumentHidden(true)
    let sawHiddenBlink = false
    for (let step = 0; step < 50; step += 1) {
      vi.advanceTimersByTime(500)
      if (face.hasAttribute('data-blink')) sawHiddenBlink = true
    }
    expect(sawHiddenBlink, '窗口后台隐藏时入口脸不得眨眼').toBe(false)
  })

  it('在跑 / 完成 / 失败态：入口脸同步姿态且不眨；窄于 900 待确认退回角标时按脸态决定眨不眨', () => {
    vi.useFakeTimers()
    mounted = mountTopbarAndHost({ surface: 'generation', initialForm: 'collapsed', initialWidth: 1200 })
    useResidentActivityStore.getState().setResidentDockBadge('running', 'running', 0, 0)
    mounted.flush()

    const runningFace = mounted.mustEntry().querySelector('[data-nomi-agent-face]')!
    expect(runningFace.getAttribute('data-nomi-agent-face')).toBe('running')
    expect(mounted.mustEntry().querySelector('[data-nomi-entry-progress]')).not.toBeNull()
    vi.advanceTimersByTime(20_000)
    expect(runningFace.hasAttribute('data-blink'), 'running 态不得眨眼').toBe(false)

    useResidentActivityStore.getState().setResidentDockBadge('done', 'done', 0, 0)
    mounted.flush()
    const doneFace = mounted.mustEntry().querySelector('[data-nomi-agent-face]')!
    expect(doneFace.getAttribute('data-nomi-agent-face')).toBe('done')
    vi.advanceTimersByTime(20_000)
    expect(doneFace.hasAttribute('data-blink'), 'done 态不得眨眼').toBe(false)

    useResidentActivityStore.getState().setResidentDockBadge('failed', 'failed', 0, 0)
    mounted.flush()
    const failedFace = mounted.mustEntry().querySelector('[data-nomi-agent-face]')!
    expect(failedFace.getAttribute('data-nomi-agent-face')).toBe('failed')
    expect(mounted.mustEntry().querySelector('[data-nomi-entry-dot="failed"]')).not.toBeNull()
    vi.advanceTimersByTime(20_000)
    expect(failedFace.hasAttribute('data-blink'), 'failed 态不得眨眼').toBe(false)

    // 窄于 900 且有待确认：空闲脸 + 角标 → 仍可眨眼；在做脸 + 角标 → 不眨眼。
    mounted.resizeWindow(800)
    useResidentActivityStore.getState().setResidentDockBadge('needs-confirm', 'idle', 2, 2)
    mounted.flush()
    const pendingIdleFace = mounted.mustEntry().querySelector('[data-nomi-agent-face]')!
    expect(pendingIdleFace.getAttribute('data-nomi-agent-face')).toBe('idle')
    expect(mounted.mustEntry().querySelector('[data-nomi-entry-badge]')?.textContent).toBe('2')
    vi.advanceTimersByTime(20_000)
    expect(pendingIdleFace.hasAttribute('data-blink')).toBe(true)
    vi.advanceTimersByTime(600)
    expect(pendingIdleFace.hasAttribute('data-blink')).toBe(false)

    useResidentActivityStore.getState().setResidentDockBadge('needs-confirm', 'running', 2, 2)
    mounted.flush()
    const pendingRunningFace = mounted.mustEntry().querySelector('[data-nomi-agent-face]')!
    expect(pendingRunningFace.getAttribute('data-nomi-agent-face')).toBe('running')
    vi.advanceTimersByTime(20_000)
    expect(pendingRunningFace.hasAttribute('data-blink')).toBe(false)
  })
})

// ── 2. 点开聚焦 / ⌘J（顶栏入口点击 + 快捷键 → 面板打开 + 真实 residentComposerFocus 接收端落焦） ──────

describe('顶栏入口侧接线 ②：点开聚焦 / ⌘J（入口点击与快捷键真正送到输入框接收端）', () => {
  it('收起态点击顶栏入口 → 打开面板并把焦点请求送到输入框；展开态再点 → 收起且不发聚焦请求', () => {
    mounted = mountTopbarAndHost({ surface: 'generation', initialForm: 'collapsed', initialWidth: 1200 })
    expect(mounted.hostForm()).toBe('collapsed')
    expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('false')
    expect(mounted.editor.view.hasFocus()).toBe(false)

    // 收起态点开：useNomiEntry.toggle → openAgent + requestResidentComposerFocus → 接收端落焦点。
    mounted.clickEntry()
    expect(mounted.hostForm()).toBe('float')
    expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('true')
    expect(useResidentComposerFocusStore.getState().request, '点开顶栏入口后必须发出聚焦请求').not.toBeNull()
    env.flushRaf()
    expect(mounted.editor.view.hasFocus(), '聚焦请求必须由接收端真正落到输入框').toBe(true)
    expect(useResidentComposerFocusStore.getState().request).toBeNull()

    // 展开态再点入口：收起面板，且不能额外发聚焦请求。
    mounted.editor.blur()
    const callsBeforeCollapse = mounted.editor.focusCalls
    mounted.clickEntry()
    expect(mounted.hostForm()).toBe('collapsed')
    expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('false')
    expect(useResidentComposerFocusStore.getState().request).toBeNull()
    env.flushRaf(3)
    expect(mounted.editor.focusCalls).toBe(callsBeforeCollapse)
    expect(mounted.editor.view.hasFocus()).toBe(false)
  })

  it('⌘J / Ctrl+J：收起态打开并落焦，展开态失焦时也能把焦点拉回输入框', () => {
    mounted = mountTopbarAndHost({ surface: 'generation', initialForm: 'collapsed', initialWidth: 1200 })
    expect(mounted.hostForm()).toBe('collapsed')

    const cmdJ = mounted.pressShortcut('j', { metaKey: true })
    expect(cmdJ.prevented).toBe(true)
    expect(mounted.hostForm()).toBe('float')
    expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('true')
    expect(useResidentComposerFocusStore.getState().request, '⌘J 必须发出聚焦请求').not.toBeNull()
    env.flushRaf()
    expect(mounted.editor.view.hasFocus(), '⌘J 打开后焦点必须落进输入框').toBe(true)
    expect(useResidentComposerFocusStore.getState().request).toBeNull()

    // 面板已经展开、但光标移走了：按 Ctrl+J 仍把光标拉回输入框、面板保持打开。
    mounted.editor.blur()
    expect(mounted.editor.view.hasFocus()).toBe(false)
    const ctrlJ = mounted.pressShortcut('J', { ctrlKey: true })
    expect(ctrlJ.prevented).toBe(true)
    expect(mounted.hostForm()).toBe('float')
    expect(useResidentComposerFocusStore.getState().request, '展开态按 Ctrl+J 仍必须发出聚焦请求').not.toBeNull()
    env.flushRaf()
    expect(mounted.editor.view.hasFocus()).toBe(true)
    expect(useResidentComposerFocusStore.getState().request).toBeNull()
  })

  it('整窗模态开着时按 ⌘J：不打开面板、不抢焦点', () => {
    mounted = mountTopbarAndHost({ surface: 'generation', initialForm: 'collapsed', initialWidth: 1200 })
    const modal = openModalInputLayer(null)
    try {
      const result = mounted.pressShortcut('j', { metaKey: true })
      expect(result.prevented).toBe(false)
      expect(mounted.hostForm()).toBe('collapsed')
      expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('false')
      expect(useResidentComposerFocusStore.getState().request).toBeNull()
      env.flushRaf(2)
      expect(mounted.editor.view.hasFocus()).toBe(false)
    } finally {
      modal.close()
    }
  })
})

// ── 3. 窄窗临时收起（顶栏入口侧：ShellTopBar + useNomiEntry + ShellNomiEntry + ShellAgentHost） ──────

describe('顶栏入口侧接线 ③：窄窗临时收起（跨阈值回顶栏、临时开关与胶囊退角标、零落盘、宽回停靠）', () => {
  it('宽窗停靠 → 拉窄跨 1060：停靠临时收起、顶栏入口回未按下态；窄窗从入口点开浮窗并聚焦、再点回临时收起；拉宽自动停回，全程存档逐字节不变', () => {
    mounted = mountTopbarAndHost({ surface: 'creation', initialForm: 'dock', initialWidth: 1200 })
    expect(mounted.hostForm()).toBe('dock')
    expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('true')
    const wideLabel = mounted.mustEntry().getAttribute('aria-label') ?? ''
    expect(wideLabel).toContain('收起面板')
    const diskBefore = mounted.disk()
    expect(diskBefore).toContain('"dock"')

    // 1) 拉窄跨 1060（1200 → 800）：ShellAgentHost 的 matchMedia 触发临时收起，顶栏入口同步回到未按下态。
    mounted.resizeWindow(800)
    expect(mounted.hostForm()).toBe('collapsed')
    expect(mounted.mustEntry().getAttribute('aria-pressed'), '拉窄临时收起后顶栏入口必须回到未按下态').toBe('false')
    expect(mounted.mustEntry().getAttribute('aria-label')).toContain('打开 Nomi')
    expect(mounted.disk(), '拉窄临时收起不许改存档').toBe(diskBefore)

    // 2) 窄窗下点顶栏入口：临时打开成浮窗、入口按下、输入框拿焦点，存档仍一个字节不动。
    mounted.clickEntry()
    expect(mounted.hostForm()).toBe('float')
    expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('true')
    env.flushRaf()
    expect(mounted.editor.view.hasFocus(), '窄窗从顶栏入口点开浮窗后也必须聚焦输入框').toBe(true)
    expect(mounted.disk(), '窄窗点开临时浮窗不许改存档').toBe(diskBefore)

    // 3) 窄窗下再点顶栏入口：临时收起回顶栏、入口回到未按下态，存档仍不动。
    mounted.editor.blur()
    mounted.clickEntry()
    expect(mounted.hostForm()).toBe('collapsed')
    expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('false')
    expect(mounted.disk(), '窄窗点入口临时收起不许改存档').toBe(diskBefore)

    // 4) 拉宽跨回 1060（800 → 1200）：自动停回右侧，顶栏入口同步回到按下态，存档仍逐字节相等。
    mounted.resizeWindow(1200)
    expect(mounted.hostForm()).toBe('dock')
    expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('true')
    expect(mounted.disk(), '拉宽自动停回后存档仍逐字节不变').toBe(diskBefore)
  })

  it('顶栏入口的 roomy 接线（topbarRoomy(barWidth)）：960 临时收起出胶囊，800 退回脸 + 角标，点开成浮窗不出胶囊', () => {
    mounted = mountTopbarAndHost({ surface: 'creation', initialForm: 'dock', initialWidth: 1200 })
    useResidentActivityStore.getState().setResidentDockBadge('needs-confirm', 'idle', 2, 2)
    mounted.flush()
    // 宽窗开着停靠：不出胶囊，显示按下态脸 + 角标。
    expect(mounted.mustEntry().getAttribute('data-shape')).toBe('face')
    expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('true')
    expect(mounted.mustEntry().querySelector('[data-nomi-entry-badge]')?.textContent).toBe('2')

    // 960px（< 1060 触发窄窗临时收起，但 ≥ 900 顶栏仍 roomy）：面板收起 → 入口长出浅橙胶囊。
    mounted.resizeWindow(960)
    expect(mounted.hostForm()).toBe('collapsed')
    expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('false')
    expect(mounted.mustEntry().getAttribute('data-shape'), '960px 窄窗收起且 roomy 时应出胶囊').toBe('capsule')
    expect(mounted.mustEntry().querySelector('[data-nomi-entry-capsule]')?.textContent).toContain('2')

    // 缩到 800px（< 900，topbarRoomy 为 false）：胶囊退回脸 + 角标。
    mounted.resizeWindow(800)
    expect(mounted.mustEntry().getAttribute('data-shape'), '800px 小于 900 时必须从胶囊退回脸 + 角标').toBe('face')
    expect(mounted.mustEntry().querySelector('[data-nomi-entry-capsule]')).toBeNull()
    expect(mounted.mustEntry().querySelector('[data-nomi-entry-badge]')?.textContent).toBe('2')

    // 回到 960px 再从入口点开成临时浮窗：面板开着不出胶囊（D5）。
    mounted.resizeWindow(960)
    expect(mounted.mustEntry().getAttribute('data-shape')).toBe('capsule')
    mounted.clickEntry()
    expect(mounted.hostForm()).toBe('float')
    expect(mounted.mustEntry().getAttribute('aria-pressed')).toBe('true')
    expect(mounted.mustEntry().getAttribute('data-shape')).toBe('face')
    expect(mounted.mustEntry().querySelector('[data-nomi-entry-badge]')?.textContent).toBe('2')
  })

  it('项目库页（workspaceMode=null）顶栏不挂 Nomi 入口', () => {
    mounted = mountTopbarAndHost({ workspaceMode: null, initialWidth: 1200 })
    expect(mounted.entry()).toBeNull()
  })
})
