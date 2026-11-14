import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer, type TestHostNode } from '../v4/testReactRenderer'
import { chooseAgentPlacement, machineHold, openAgent, useAgentFormStore } from '../../../ui/app-shell/shell/agentFormStore'
import { useAgentFormViewStore } from '../../../ui/app-shell/shell/agentFormViewStore'
import { BOTTOM_DOCK_SCOPE_SELECTOR, BOTTOM_DOCK_SELECTOR, type BottomDockRect } from '../../generation/workspaceBottomDocks'
import { useNodePointerStore, type NodePointerReturn } from './nodePointerStore'
import { NodePointerReturnDock } from './NodePointerReturnDock'
import { RETURN_DOCK_CLEARANCE, RETURN_DOCK_EDGE_GAP, returnDockBottom } from './returnDockPlacement'

// 按钮本身（字、读屏名、Esc）在 NodePointer.test.tsx 里钉；这里只看「它在真画布上什么时候在、摆在哪」。
vi.mock('./NodePointerGroup', async () => {
  const ReactModule = await import('react')
  return { NodePointerReturnToChat: () => ReactModule.createElement('button', { 'data-node-pointer-return': 'true' }) }
})

const HOST = { width: 800, height: 600 }
const BUTTON_WIDTH = 120
/** 加节点条：底部正中（bottom-4、h-10）。坐标 = 画布那一格自己。 */
const TOOLBAR: BottomDockRect = { left: 300, top: 544, right: 500, bottom: 584 }
/** 缩放簇：右下角，横向压不上正中那颗按钮。 */
const ZOOM: BottomDockRect = { left: 640, top: 540, right: 784, bottom: 584 }

describe('returnDockBottom · bottom centre, above whatever bottom dock sits under it', () => {
  it('no docks: sits on the bottom edge gap', () => {
    expect(returnDockBottom({ host: HOST, buttonWidth: BUTTON_WIDTH, docks: [] })).toBe(RETURN_DOCK_EDGE_GAP)
  })

  it('the centred add-node bar: lifts above it, one clearance higher', () => {
    expect(returnDockBottom({ host: HOST, buttonWidth: BUTTON_WIDTH, docks: [TOOLBAR] })).toBe(HOST.height - (TOOLBAR.top - RETURN_DOCK_CLEARANCE))
  })

  it('a dock off to the side (zoom cluster) does not push it up', () => {
    expect(returnDockBottom({ host: HOST, buttonWidth: BUTTON_WIDTH, docks: [ZOOM] })).toBe(RETURN_DOCK_EDGE_GAP)
  })

  it('two docks under it: the higher one wins', () => {
    const capsule: BottomDockRect = { left: 340, top: 480, right: 460, bottom: 520 }
    expect(returnDockBottom({ host: HOST, buttonWidth: BUTTON_WIDTH, docks: [TOOLBAR, capsule, ZOOM] })).toBe(HOST.height - (capsule.top - RETURN_DOCK_CLEARANCE))
  })
})

// ── 挂在真画布上：什么时候在 ─────────────────────────────────────────────────────────────────
// 没有 DOM 的测试宿主：reconciler 造的假元素补上 hook 要读的几个口（量自己、往上找外壳、找停靠区、找按钮）。

type FakeRect = { left: number; top: number; right: number; bottom: number; width: number; height: number }
type FakeElement = TestHostNode & {
  type: string
  getBoundingClientRect: () => FakeRect
  closest: (selector: string) => FakeElement | null
  querySelectorAll: (selector: string) => FakeElement[]
  querySelector: (selector: string) => FakeElement | null
  hasAttribute: (name: string) => boolean
  contains: (other: unknown) => boolean
}

const rectOf = (rect: BottomDockRect): FakeRect => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top })

function fakeElement(type: string, props: Record<string, unknown>, rect: FakeRect, docks: () => FakeElement[] = () => []): FakeElement {
  const element: FakeElement = {
    type,
    props,
    getBoundingClientRect: () => rect,
    closest: (selector) => (selector === BOTTOM_DOCK_SCOPE_SELECTOR ? scope : null),
    querySelectorAll: () => [],
    querySelector: (selector) => (selector === '[data-node-pointer-return]' ? button : null),
    hasAttribute: () => false,
    contains: () => false,
  }
  const scope = { querySelectorAll: (selector: string) => (selector === BOTTOM_DOCK_SELECTOR ? docks() : []) } as unknown as FakeElement
  const button = { getBoundingClientRect: () => rectOf({ left: 0, top: 0, right: BUTTON_WIDTH, bottom: 36 }) } as unknown as FakeElement
  return element
}

let renderer: ReturnType<typeof createReactTestRenderer<FakeElement>> | null = null
let created: FakeElement[] = []
let dockRects: BottomDockRect[] = []

function mount(): void {
  created = []
  renderer = createReactTestRenderer<FakeElement>({
    createInstance: (type, props) => {
      const host = rectOf({ left: 0, top: 0, right: HOST.width, bottom: HOST.height })
      const element = fakeElement(type, props, host, () => dockRects.map((dock) => fakeElement('div', {}, rectOf(dock))))
      created.push(element)
      return element
    },
  })
  renderer.render(<NodePointerReturnDock surface="generation" />)
  renderer.flushPassiveEffects()
}

const dockHost = (): FakeElement | undefined => created.filter((element) => element.props && (element.props as Record<string, unknown>)['data-node-pointer-return-dock'] === 'generation').at(-1)
const buttonShown = (): boolean => created.some((element) => element.type === 'button')
const placedBottom = (): unknown => {
  const placed = created.filter((element) => element.type === 'div' && String((element.props as Record<string, unknown>).className ?? '').includes('pointer-events-auto')).at(-1)
  return (placed?.props as { style?: { bottom?: unknown } } | undefined)?.style?.bottom
}

const target = (overrides: Partial<NodePointerReturn> = {}): NodePointerReturn => ({ surface: 'generation', nodeId: 'n2', label: '镜 02', ...overrides })

/** 'ball' = 指向节点时机器让开（对话收成小球）；'float' = 人点开（回到人选的浮窗）。 */
const yieldToBall = (): void => machineHold('generation', 'ball')
const showChat = (form: 'ball' | 'float'): void => {
  if (form === 'ball') yieldToBall()
  else openAgent('generation')
  renderer?.flushPassiveEffects()
}

const resetForms = (): void => {
  useAgentFormViewStore.setState(useAgentFormViewStore.getInitialState(), true)
  useAgentFormStore.setState(useAgentFormStore.getInitialState(), true)
}

beforeEach(() => {
  dockRects = []
  useNodePointerStore.setState({ locatedNodeId: null, returnTo: null })
  resetForms()
  chooseAgentPlacement('generation', 'float')
})

afterEach(() => {
  renderer?.close()
  renderer = null
  useNodePointerStore.setState({ locatedNodeId: null, returnTo: null })
  resetForms()
})

describe('NodePointerReturnDock · on the real canvas only while a pointer click collapsed the chat (NodePointer pointer.narrow.back)', () => {
  it('nothing to go back to: draws nothing, even when the chat is the ball', () => {
    yieldToBall()
    mount()
    expect(dockHost()).toBeUndefined()
    expect(buttonShown()).toBe(false)
  })

  it('a pointer click collapsed the chat to the ball: the button is there, bottom centre', () => {
    useNodePointerStore.getState().setReturnTo(target())
    yieldToBall()
    mount()
    expect(dockHost()).toBeDefined()
    expect(buttonShown()).toBe(true)
    expect(placedBottom()).toBe(RETURN_DOCK_EDGE_GAP)
  })

  it('mid-collapse (return remembered, chat not yet the ball): nothing yet, and the return is NOT thrown away', () => {
    mount()
    useNodePointerStore.getState().setReturnTo(target())
    renderer?.flushPassiveEffects()
    expect(dockHost()).toBeUndefined()
    expect(useNodePointerStore.getState().returnTo).not.toBeNull()
    showChat('ball')
    expect(buttonShown()).toBe(true)
    expect(useNodePointerStore.getState().returnTo).not.toBeNull()
  })

  it('the user brought the chat back some other way (the ball): the stale return is cleared and the button goes', () => {
    useNodePointerStore.getState().setReturnTo(target())
    yieldToBall()
    mount()
    expect(buttonShown()).toBe(true)
    created = []
    showChat('float')
    expect(useNodePointerStore.getState().returnTo).toBeNull()
    expect(dockHost()).toBeUndefined()
    // 之后又因为别的原因收成小球：不会再冒出一颗指着旧镜头的「回到对话」。
    showChat('ball')
    expect(dockHost()).toBeUndefined()
  })

  it('a return remembered for another page is not this canvas’s business', () => {
    useNodePointerStore.getState().setReturnTo(target({ surface: 'storyboard' }))
    yieldToBall()
    mount()
    expect(dockHost()).toBeUndefined()
    showChat('float')
    expect(useNodePointerStore.getState().returnTo?.surface).toBe('storyboard')
  })

  it('measures the live bottom docks: with the add-node bar under it, it sits above the bar', () => {
    dockRects = [TOOLBAR, ZOOM]
    useNodePointerStore.getState().setReturnTo(target())
    yieldToBall()
    mount()
    expect(placedBottom()).toBe(HOST.height - (TOOLBAR.top - RETURN_DOCK_CLEARANCE))
  })
})
