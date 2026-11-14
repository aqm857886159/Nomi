import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { FOCUS_GENERATION_NODE_EVENT } from '../../generationCanvas/nodes/nodeSizing'
import { useGenerationViewStore } from '../../generation/list/generationViewStore'
import { AGENT_FLOAT_SELECTOR } from '../../generation/workspaceBottomDocks'
import { useWorkbenchStore } from '../../workbenchStore'
import { chooseAgentPlacement, collapseAgent, shownForm, useAgentFormStore } from '../../../ui/app-shell/shell/agentFormStore'
import { useAgentFormViewStore } from '../../../ui/app-shell/shell/agentFormViewStore'
import { useNodePointerStore } from './nodePointerStore'
import { agentCoversCanvas, returnToChat, revealNodeFromChat } from './revealNodeFromChat'

const stage = { left: 0, top: 0, width: 400, height: 700 }

describe('agentCoversCanvas', () => {
  it('collapses the chat when a narrow window is mostly covered by the floating chat (A4)', () => {
    expect(agentCoversCanvas(stage, { left: 8, top: 280, width: 384, height: 412 })).toBe(true)
  })

  it('keeps the chat open in a wide window where the float only takes a corner (A3)', () => {
    expect(agentCoversCanvas({ left: 0, top: 0, width: 1400, height: 860 }, { left: 1000, top: 344, width: 384, height: 500 })).toBe(false)
  })

  it('collapses when the float leaves only a sliver even if it covers less than half', () => {
    expect(agentCoversCanvas({ left: 0, top: 0, width: 500, height: 700 }, { left: 120, top: 100, width: 260, height: 500 })).toBe(true)
  })

  it('does nothing when there is no floating chat', () => {
    expect(agentCoversCanvas(stage, null)).toBe(false)
  })
})

// ── 接线：点击 → 画布（独立验收 V-d2-pointer 条件 2）─────────────────────────────────────────
// 这里不 mock 对焦：真 store、真 `viewNodeInCanvas`，只替一个没有 DOM 的测试宿主补上 `window` / `document` 的几个口，
// 然后在「画布那一头的监听者收到的事件」处看——删掉 `viewNodeInCanvas(...)` 这一行，或者把收起和对焦对调，下面都会红。

type Rect = { left: number; top: number; width: number; height: number }
type Step = string

const node = (id: string): GenerationCanvasNode => ({
  id, kind: 'video', title: `shot-${id}`, prompt: '', categoryId: 'shots', position: { x: 0, y: 0 }, status: 'idle', meta: {},
} as GenerationCanvasNode)

/** 没有 DOM 的测试宿主里补上点击定位要读 / 要派的几个口；返回按先后记下来的步骤。 */
function stubHost(rects: { stage?: Rect; float?: Rect } = {}): { steps: Step[]; focused: Step[] } {
  const steps: Step[] = []
  const focused: Step[] = []
  const element = (rect: Rect) => ({ getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) })
  vi.stubGlobal('window', {
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    dispatchEvent: (event: Event) => {
      if (event.type === FOCUS_GENERATION_NODE_EVENT) {
        const detail = (event as CustomEvent<{ nodeId: string }>).detail
        steps.push(`focus:${detail.nodeId}@${useWorkbenchStore.getState().workspaceMode}/${useGenerationViewStore.getState().view}`)
      }
      return true
    },
  })
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.stubGlobal('document', {
    querySelector: (selector: string) => {
      if (selector === '.generation-canvas-v2__stage') return rects.stage ? element(rects.stage) : null
      if (selector === AGENT_FLOAT_SELECTOR) return rects.float ? element(rects.float) : null
      if (selector.startsWith('[data-node-pointer-id=')) return { focus: () => focused.push(selector) }
      return null
    },
  })
  return { steps, focused }
}

let stopWatchingForm: () => void = () => undefined

/** 记下此刻显示的形态每一次变化（人存的、此刻的覆盖，哪一份变了都会改到它）。 */
function watchChat(steps: Step[]): void {
  let last = shownForm('generation')
  const check = (): void => {
    const now = shownForm('generation')
    if (now !== last) steps.push(`chat:${now}`)
    last = now
  }
  const stops = [useAgentFormStore.subscribe(check), useAgentFormViewStore.subscribe(check)]
  stopWatchingForm = () => stops.forEach((stop) => stop())
}

function resetForms(): void {
  useAgentFormViewStore.setState(useAgentFormViewStore.getInitialState(), true)
  useAgentFormStore.setState(useAgentFormStore.getInitialState(), true)
}

beforeEach(() => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node('n1'), node('n2')], edges: [], groups: [] }, 'project-reveal')
  useWorkbenchStore.setState({ workspaceMode: 'generation' })
  useGenerationViewStore.setState({ view: 'canvas' })
  resetForms()
  chooseAgentPlacement('generation', 'float')
  useNodePointerStore.setState({ locatedNodeId: null, returnTo: null })
})

afterEach(() => {
  stopWatchingForm()
  stopWatchingForm = () => undefined
  vi.unstubAllGlobals()
  resetForms()
  useNodePointerStore.setState({ locatedNodeId: null, returnTo: null })
})

describe('revealNodeFromChat · from a click to the live canvas focus (S4)', () => {
  it('goes through the one existing focus event, for exactly that node, and marks it located', async () => {
    const host = stubHost()
    await revealNodeFromChat({ nodeId: 'n2', label: '镜 02' })
    expect(host.steps).toEqual(['focus:n2@generation/canvas'])
    expect(useNodePointerStore.getState().locatedNodeId).toBe('n2')
  })

  it('from the list view or another workspace: switches to the generation canvas first, the focus event comes last', async () => {
    const host = stubHost()
    useWorkbenchStore.setState({ workspaceMode: 'creation' })
    useGenerationViewStore.setState({ view: 'list' })
    await revealNodeFromChat({ nodeId: 'n1', label: '镜 01' })
    // 事件派出的那一刻，页面和视图已经切到画布（否则画布那头的监听者根本还没挂上）。
    expect(host.steps).toEqual(['focus:n1@generation/canvas'])
  })
})

describe('revealNodeFromChat · narrow window: show the target first, then go (S7)', () => {
  it('a floating chat that covers the canvas collapses to the ball BEFORE the focus event, and remembers how to come back', async () => {
    const host = stubHost({ stage, float: { left: 8, top: 280, width: 384, height: 412 } })
    watchChat(host.steps)
    await revealNodeFromChat({ nodeId: 'n1', label: '镜 01' })
    expect(host.steps).toEqual(['chat:ball', 'focus:n1@generation/canvas'])
    expect(useNodePointerStore.getState().returnTo).toEqual({ surface: 'generation', nodeId: 'n1', label: '镜 01' })
    // 让开是机器的临时动作：人存的摆法和开没开一个字也不动。
    expect(useAgentFormStore.getState().bySurface.generation).toMatchObject({ placement: 'float', collapsed: false })
  })

  it('a docked chat in a window too narrow for the canvas collapses first too', async () => {
    const host = stubHost({ stage: { left: 0, top: 0, width: 240, height: 700 } })
    chooseAgentPlacement('generation', 'dock')
    watchChat(host.steps)
    await revealNodeFromChat({ nodeId: 'n1', label: '镜 01' })
    expect(host.steps).toEqual(['chat:ball', 'focus:n1@generation/canvas'])
    expect(useNodePointerStore.getState().returnTo).toEqual({ surface: 'generation', nodeId: 'n1', label: '镜 01' })
    expect(useAgentFormStore.getState().bySurface.generation).toMatchObject({ placement: 'dock', collapsed: false })
  })

  it('a wide window where the float only takes a corner: the chat stays open, the focus still goes', async () => {
    const host = stubHost({ stage: { left: 0, top: 0, width: 1400, height: 860 }, float: { left: 1000, top: 344, width: 384, height: 500 } })
    watchChat(host.steps)
    await revealNodeFromChat({ nodeId: 'n1', label: '镜 01' })
    expect(host.steps).toEqual(['focus:n1@generation/canvas'])
    expect(useNodePointerStore.getState().returnTo).toBeNull()
  })

  it('a chat that is already the ball is left alone', async () => {
    const host = stubHost({ stage, float: { left: 8, top: 280, width: 384, height: 412 } })
    collapseAgent('generation')
    watchChat(host.steps)
    await revealNodeFromChat({ nodeId: 'n1', label: '镜 01' })
    expect(host.steps).toEqual(['focus:n1@generation/canvas'])
    expect(useNodePointerStore.getState().returnTo).toBeNull()
  })

  it('coming back puts the chat in the form it was in and hands the focus to the pointer that was clicked', async () => {
    const host = stubHost({ stage, float: { left: 8, top: 280, width: 384, height: 412 } })
    await revealNodeFromChat({ nodeId: 'n1', label: '镜 01' })
    returnToChat()
    expect(shownForm('generation')).toBe('float')
    expect(useNodePointerStore.getState().returnTo).toBeNull()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(host.focused).toEqual(['[data-node-pointer-id="n1"]'])
  })
})
