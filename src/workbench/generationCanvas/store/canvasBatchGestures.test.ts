import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from './generationCanvasStore'
import { projectParameterReferenceSlots } from '../model/parameterReferenceSlots'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getClipboard } from './canvasClipboard'

const image = (id: string): GenerationCanvasNode => ({ id, title: id, kind: 'image', categoryId: 'shots', position: { x: 120, y: 100 }, meta: {} })
const video = (id: string): GenerationCanvasNode => ({ ...image(id), kind: 'video', meta: projectParameterReferenceSlots({ modelKey: 'multi', modelVendor: 'custom' }, { parameters: ['a', 'b'].map((key) => ({ key, label: key, type: 'image-url' })) }) })
const state = () => useGenerationCanvasStore.getState()
beforeEach(() => { __resetGenerationCanvasHistoryForTests(); state().restoreSnapshot({ nodes: [image('one'), image('two'), image('three'), video('target')], edges: [], groups: [] }) })

describe('multi-selection connection gesture', () => {
  it.each(['right', 'left'] as const)('fills capacity once and undoes all edges in one step, dragging from %s', (side) => {
    state().selectNodes(['one', 'two', 'three'])
    const before = state().readDocumentSnapshot()
    state().startConnection(side === 'right' ? 'one' : 'target', side)
    expect(state().connectToNode(side === 'right' ? 'target' : 'one')).toMatchObject({ ok: true, connected: 2, skipped: 1 })
    expect(state().edges.map((edge) => edge.targetParamKey)).toEqual(['a', 'b'])
    expect(state().edges.every((edge) => !edge.viaGroupId)).toBe(true)
    state().undo()
    expect(state().readDocumentSnapshot()).toEqual(before)
    state().redo()
    expect(state().edges).toHaveLength(2)
  })
  it('expands the destination selection, and skips existing edges without a new undo step', () => {
    state().restoreSnapshot({ nodes: [image('one'), video('a'), video('b')], edges: [], groups: [] })
    state().selectNodes(['a', 'b'])
    state().startConnection('one')
    expect(state().connectToNode('a')).toMatchObject({ connected: 2, skipped: 0 })
    state().startConnection('one')
    expect(state().connectToNode('b')).toMatchObject({ connected: 0, alreadyConnected: 2 })
    state().undo()
    expect(state().edges).toHaveLength(0)
  })
})

it('Alt drag copies selected graph, preserves original positions and clipboard, and undoes copy plus move together', () => {
  state().selectNodes(['one', 'two'])
  state().copySelectedNodes()
  const clipboard = getClipboard()
  const before = state().readDocumentSnapshot()
  const mapping = state().duplicateNodesForDrag(['one', 'two'])
  expect(mapping.size).toBe(2)
  expect(state().nodes).toHaveLength(6)
  for (const [original, copy] of mapping) {
    state().moveNode(copy, { x: 400, y: 300 })
    expect(state().nodes.find((node) => node.id === original)?.position).toEqual({ x: 120, y: 100 })
  }
  expect(getClipboard()).toBe(clipboard)
  state().undo()
  expect(state().readDocumentSnapshot()).toEqual(before)
  state().redo()
  expect(state().nodes.filter((node) => [...mapping.values()].includes(node.id)).every((node) => node.position.x === 400)).toBe(true)
})

it('shares the archetype total reference budget across uploaded audio, pending image edges and video edges', () => {
  const target: GenerationCanvasNode = { ...video('target'), meta: {
    archetype: { id: 'minimax-h3-apimart', modeId: 'ref' },
    referenceAudioUrls: ['https://example.com/a.mp3', 'https://example.com/b.mp3', 'https://example.com/c.mp3'],
  } }
  const images = Array.from({ length: 9 }, (_, i) => image(`image-${i}`))
  const clips = Array.from({ length: 3 }, (_, i) => ({ ...image(`clip-${i}`), kind: 'video' as const }))
  state().restoreSnapshot({ nodes: [target, ...images, ...clips], edges: [], groups: [] })
  state().selectNodes([...images, ...clips].map((node) => node.id))
  state().startConnection(images[0].id)
  expect(state().connectToNode('target')).toMatchObject({ connected: 9, skipped: 3 })
  expect(state().edges).toHaveLength(9)
})

it('Alt copies preserve the current paste grouping rule and internal edges without moving source membership', () => {
  state().connectNodes('one', 'two', 'reference')
  state().selectNodes(['two', 'one'])
  state().groupSelectedNodes('shots')
  const before = state().readDocumentSnapshot()
  const mapping = state().duplicateNodesForDrag(['two', 'one'])
  expect(state().groups).toEqual(before.groups)
  expect(state().edges.some((edge) => edge.source === mapping.get('one') && edge.target === mapping.get('two'))).toBe(true)
  expect(state().groups.every((group) => group.nodeIds.every((id) => ![...mapping.values()].includes(id)))).toBe(true)
  state().undo()
  expect(state().readDocumentSnapshot()).toEqual(before)
})
