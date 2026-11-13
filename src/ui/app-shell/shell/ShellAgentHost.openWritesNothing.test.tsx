// 打开项目什么都不点：挂上外壳不许让项目落盘（复盘 docs/engineering/direction-checks/2026-11-13-open-writes-project.md）。
//
// 旧的「打开不写」测试只跑服务层、从没挂过外壳，挂载期的 effect 看不见——这条就是挂真的 ShellAgentHost，
// 让它按本机形态（生成页默认小球）把显示态同步过去，再断言 persistRevision 没动、落盘那份的 Nomi 栏开合还是项目里的原值。
// 外壳只挂它自己：面板门户、浮窗 / 小球的拖动库换成空壳（这条测的是那条同步 effect，不是摆放）。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-reverse-portal', () => ({
  createHtmlPortalNode: () => ({}),
  InPortal: () => null,
  OutPortal: () => null,
}))
vi.mock('react-rnd', () => ({ Rnd: () => null }))
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), createPortal: () => null }))

import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { cloneEditingPanelLayout, EDITING_PANEL_DEFAULTS } from '../../../workbench/preview/panelLayout'
import { useAgentFormStore, type AgentFormSurface } from './agentFormStore'
import { ShellAgentHost } from './ShellAgentHost'

/** 够 React DOM 挂几个 div 的最小 DOM（仓库单测是 node 环境、没有 jsdom）。 */
class FakeNode {
  nodeType = 1
  childNodes: FakeNode[] = []
  parentNode: FakeNode | null = null
  style: Record<string, string> = {}
  attributes = new Map<string, string>()
  namespaceURI = 'http://www.w3.org/1999/xhtml'
  constructor(public nodeName: string, public ownerDocument: unknown) {}
  get tagName() { return this.nodeName }
  get firstChild() { return this.childNodes[0] ?? null }
  appendChild(child: FakeNode) { child.parentNode = this; this.childNodes.push(child); return child }
  insertBefore(child: FakeNode, before: FakeNode | null) {
    child.parentNode = this
    const at = before ? this.childNodes.indexOf(before) : -1
    if (at < 0) this.childNodes.push(child)
    else this.childNodes.splice(at, 0, child)
    return child
  }
  removeChild(child: FakeNode) { this.childNodes = this.childNodes.filter((node) => node !== child); return child }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)) }
  removeAttribute(name: string) { this.attributes.delete(name) }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  addEventListener() {}
  removeEventListener() {}
  get clientWidth() { return 0 }
  get clientHeight() { return 0 }
}

function fakeDom(): FakeNode {
  const document = {
    nodeType: 9,
    documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' },
    body: null as unknown,
    activeElement: null as unknown,
    defaultView: null as unknown,
    createElement: (tag: string) => new FakeNode(tag.toUpperCase(), document),
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag.toUpperCase(), document),
    createTextNode: (text: string) => Object.assign(new FakeNode('#text', document), { nodeType: 3, nodeValue: text }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  class HTMLElement {}
  class HTMLIFrameElement extends HTMLElement {}
  const window = {
    document, HTMLElement, HTMLIFrameElement,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  }
  document.defaultView = window
  const container = new FakeNode('DIV', document)
  document.body = container
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)
  vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'node' })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  return container
}

const SURFACES: AgentFormSurface[] = ['creation', 'storyboard', 'generation', 'preview']

describe('挂上外壳不让项目落盘（打开项目什么都不点）', () => {
  let root: Root
  beforeEach(() => {
    root = createRoot(fakeDom() as unknown as HTMLElement)
    // 项目刚还原完：项目里存的是「Nomi 栏展开」（新版项目的常见值）。
    useWorkbenchStore.setState({ editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS), editingPanelUndoStack: [], projectAgentDockCollapsed: false })
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  for (const surface of SURFACES) {
    for (const form of ['ball', 'dock'] as const) {
      it(`${surface} · 本机形态=${form}：persistRevision 不变，显示态跟本机形态，落盘那份的开合还是项目原值`, async () => {
        useAgentFormStore.setState((state) => ({ bySurface: { ...state.bySurface, [surface]: { ...state.bySurface[surface], form } } }))
        const before = useWorkbenchStore.getState().persistRevision
        await act(async () => root.render(<ShellAgentHost surface={surface} dockTarget={null} agent={null} />))
        const after = useWorkbenchStore.getState()
        expect(after.projectAgentDockCollapsed).toBe(form === 'ball')
        expect(after.persistRevision).toBe(before)
        expect(after.editingPanelLayout.visibility.assistant).toBe(true)
      })
    }
  }

  it('挂着时用户按 ⌘\\ 收成小球：显示态跟着收，项目照样不落盘', async () => {
    useAgentFormStore.setState((state) => ({ bySurface: { ...state.bySurface, preview: { ...state.bySurface.preview, form: 'dock' } } }))
    await act(async () => root.render(<ShellAgentHost surface="preview" dockTarget={null} agent={null} />))
    const before = useWorkbenchStore.getState().persistRevision
    await act(async () => useAgentFormStore.getState().setForm('preview', 'ball'))
    expect(useWorkbenchStore.getState().projectAgentDockCollapsed).toBe(true)
    expect(useWorkbenchStore.getState().persistRevision).toBe(before)
    expect(useWorkbenchStore.getState().editingPanelLayout.visibility.assistant).toBe(true)
  })
})
