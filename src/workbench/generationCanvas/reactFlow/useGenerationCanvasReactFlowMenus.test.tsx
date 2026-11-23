import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../ai/v4/testReactRenderer'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationCanvasReactFlowMenus } from './useGenerationCanvasReactFlowMenus'

const { input } = vi.hoisted(() => ({ input: new EventTarget() }))
vi.mock('../../shortcutSurface', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../shortcutSurface')>(),
  canvasWindowInput: input,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  useGenerationCanvasStore.setState(useGenerationCanvasStore.getInitialState(), true)
})

it.each([
  { drop: 'foreground video', clientX: 60, targets: ['video'] },
  { drop: 'exposed group', clientX: 140, targets: ['member-a', 'member-b'] },
])('connects a touch drag released on the $drop to exactly its intended targets', ({ clientX, targets }) => {
  const nodes: GenerationCanvasNode[] = ['image', 'video', 'member-a', 'member-b'].map((id) => ({
    id, title: id, kind: id === 'image' ? 'image' : 'video', position: { x: 0, y: 0 }, categoryId: 'shots',
  }))
  const group = { id: 'group', name: 'Group', nodeIds: ['member-a', 'member-b'], categoryId: 'shots', createdAt: 1, updatedAt: 1 }
  const store = useGenerationCanvasStore.getState()
  store.restoreSnapshot({ nodes, groups: [group], edges: [] })

  // The card covers only the left half of the group. The Node renderer has no layout engine.
  const card = {
    getAttribute: () => 'video',
    getBoundingClientRect: () => ({ left: 40, right: 100, top: 20, bottom: 80 }),
    closest: () => null,
  }
  const frame = {
    getAttribute: () => group.id,
    getBoundingClientRect: () => ({ left: 20, right: 180, top: 0, bottom: 100 }),
    closest: () => ({ dataset: { groupId: group.id } }),
  }
  const host = {
    querySelectorAll: (selector: string) => ({
      '.generation-canvas-v2-node[data-node-id]': [card],
      '[data-group-id]': [frame],
    })[selector] ?? [],
  } as unknown as HTMLDivElement
  vi.stubGlobal('window', input)
  vi.stubGlobal('document', { elementsFromPoint: (x: number) => x <= 100 ? [card, frame] : [frame] })

  let menus!: ReturnType<typeof useGenerationCanvasReactFlowMenus>
  function Probe() {
    menus = useGenerationCanvasReactFlowMenus({
      ...store,
      readOnly: false, activeCategoryId: 'shots', hostRef: { current: host },
      offsetRef: { current: { x: 0, y: 0 } }, zoomRef: { current: 1 },
      pendingConnectionSourceId: useGenerationCanvasStore((state) => state.pendingConnectionSourceId),
      nodeById: new Map(nodes.map((node) => [node.id, node])), visibleGroups: [group],
      handleConnectToGroup: store.connectToGroup, groupSelectedNodes: () => store.groupSelectedNodes('shots'),
      getCanvasPointFromClientPoint: (x, y) => ({ x, y }),
      handleCanvasPointerDownCapture: vi.fn(), handleCanvasPointerDown: vi.fn(),
      handleCanvasPointerMove: vi.fn(), handleCanvasPointerEnd: vi.fn(), shouldSuppressContextMenu: () => false,
    })
    return null
  }

  const renderer = createReactTestRenderer()
  try {
    renderer.render(<Probe />)
    renderer.flushPassiveEffects()
    const point = { clientX, clientY: 55 }
    menus.handleConnectStart(new Event('touchstart') as TouchEvent, { nodeId: 'image', handleId: 'source-right', handleType: 'source' })
    renderer.render(<Probe />)
    renderer.flushPassiveEffects()
    // Chromium dispatches pointerup before React Flow finishes the drag on touchend.
    input.dispatchEvent(Object.assign(new Event('pointerup'), point, { pointerType: 'touch' }))
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(0)
    const ended = Object.assign(new Event('touchend'), { changedTouches: [point] }) as unknown as TouchEvent
    menus.handleConnectEnd(ended, {
      isValid: null, from: null, fromNode: null, fromHandle: null, fromPosition: null,
      to: null, toNode: null, toHandle: null, toPosition: null, pointer: null,
    })
    expect(useGenerationCanvasStore.getState().edges.map(({ source, target }) => [source, target]))
      .toEqual(targets.map((target) => ['image', target]))
  } finally {
    renderer.close()
  }
})
