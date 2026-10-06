import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import type { GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import { CENTER_PLACEMENT_ANCHOR } from '../model/canvasPlacement'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { createNodeFromDraggedResult, parseCanvasResultDrag, encodeCanvasResultDrag } from '../components/canvasResultDrag'

function imageNode(id: string, position: { x: number; y: number }, extra: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return { id, kind: 'image', title: id, prompt: '', position, categoryId: 'shots', size: { width: 240, height: 160 }, ...extra }
}

function center(node: GenerationCanvasNode): { x: number; y: number } {
  const size = resolveNodeVisualSize(node)
  return { x: node.position.x + size.width / 2, y: node.position.y + size.height / 2 }
}

describe('Cmd/Ctrl+V pastes the cluster centred on the pointer placement', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [imageNode('a', { x: 100, y: 200 }), imageNode('b', { x: 400, y: 260 })],
      edges: [{ id: 'edge-a-b', source: 'a', target: 'b' }],
      groups: [],
      selectedNodeIds: [],
    })
  })

  it('puts the centre of the pasted bounding box exactly on the point (not its top-left corner)', () => {
    const store = useGenerationCanvasStore.getState()
    store.selectNodes(['a', 'b'])
    store.copySelectedNodes()
    store.pasteNodes({ x: -900, y: 50 }, CENTER_PLACEMENT_ANCHOR)
    const pasted = useGenerationCanvasStore.getState().nodes.filter((node) => node.id.includes('-copy-'))
    const left = Math.min(...pasted.map((node) => node.position.x))
    const right = Math.max(...pasted.map((node) => node.position.x + resolveNodeVisualSize(node).width))
    const top = Math.min(...pasted.map((node) => node.position.y))
    const bottom = Math.max(...pasted.map((node) => node.position.y + resolveNodeVisualSize(node).height))
    // 阳性对照：不传 anchor（旧左上角约定）时 left 会等于 -900，这两条都会红。
    expect(Math.abs((left + right) / 2 - -900)).toBeLessThanOrEqual(1)
    expect(Math.abs((top + bottom) / 2 - 50)).toBeLessThanOrEqual(1)
    // 簇内相对排布不变。
    expect(pasted[1].position.x - pasted[0].position.x).toBe(300)
    expect(pasted[1].position.y - pasted[0].position.y).toBe(60)
  })
})

describe('Alt/⌥ drag of a frame duplicates the frame with its members in one undo step', () => {
  const frame: NodeGroup = {
    id: 'frame-1', name: '雨夜', categoryId: 'shots', nodeIds: ['m1', 'm2'],
    frameBounds: { x: 60, y: 140, w: 700, h: 420 }, createdAt: 1, updatedAt: 1,
  }
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        imageNode('m1', { x: 100, y: 200 }, { groupId: 'frame-1' }),
        imageNode('m2', { x: 400, y: 260 }, { groupId: 'frame-1' }),
        imageNode('outside', { x: 1400, y: 200 }),
      ],
      edges: [
        { id: 'edge-m1-m2', source: 'm1', target: 'm2' },
        { id: 'edge-outside-m1', source: 'outside', target: 'm1' },
      ],
      groups: [frame],
      selectedNodeIds: [],
    })
  })

  it('copies members (in place), their internal edge and the frame rectangle; originals untouched', () => {
    const before = useGenerationCanvasStore.getState()
    const copyId = before.duplicateGroupForDrag('frame-1')
    const state = useGenerationCanvasStore.getState()
    const copy = state.groups.find((group) => group.id === copyId)
    expect(copy).toBeTruthy()
    expect(copy?.frameBounds).toEqual(frame.frameBounds)
    expect(copy?.nodeIds).toHaveLength(2)
    const copies = state.nodes.filter((node) => copy?.nodeIds.includes(node.id))
    expect(copies.map((node) => node.position)).toEqual([{ x: 100, y: 200 }, { x: 400, y: 260 }])
    expect(copies.every((node) => node.groupId === copyId)).toBe(true)
    // 成员之间那条边跟着复制；从框外连进来的边不复制（与 ⌘C/⌘V 同一边界）。
    expect(state.edges.filter((edge) => copy?.nodeIds.includes(edge.source) && copy?.nodeIds.includes(edge.target))).toHaveLength(1)
    expect(state.edges.filter((edge) => edge.source === 'outside')).toHaveLength(1)
    expect(state.groups.find((group) => group.id === 'frame-1')?.nodeIds).toEqual(['m1', 'm2'])
    expect(state.selectedNodeIds).toEqual(copy?.nodeIds)
  })

  it('then moving the copy leaves the original in place, and one undo removes the whole copy', () => {
    const store = useGenerationCanvasStore.getState()
    const copyId = store.duplicateGroupForDrag('frame-1')!
    store.moveGroupNodes(copyId, { x: 900, y: 40 }, { persist: false, emit: false })
    let state = useGenerationCanvasStore.getState()
    expect(state.groups.find((group) => group.id === copyId)?.frameBounds).toEqual({ x: 960, y: 180, w: 700, h: 420 })
    expect(state.nodes.find((node) => node.id === 'm1')?.position).toEqual({ x: 100, y: 200 })
    expect(state.groups.find((group) => group.id === 'frame-1')?.frameBounds).toEqual(frame.frameBounds)
    state.undo()
    state = useGenerationCanvasStore.getState()
    expect(state.groups.map((group) => group.id)).toEqual(['frame-1'])
    expect(state.nodes.map((node) => node.id).sort()).toEqual(['m1', 'm2', 'outside'])
    expect(state.edges).toHaveLength(2)
  })

  it('duplicates an empty frame too (the first step of "draw a frame, then fill it")', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [], edges: [], selectedNodeIds: [],
      groups: [{ ...frame, nodeIds: [] }],
    })
    const copyId = useGenerationCanvasStore.getState().duplicateGroupForDrag('frame-1')
    const copy = useGenerationCanvasStore.getState().groups.find((group) => group.id === copyId)
    expect(copy?.frameBounds).toEqual(frame.frameBounds)
    expect(copy?.nodeIds).toEqual([])
  })
})

describe('Alt/⌥ dragging one version out of the result stack', () => {
  const v1 = { id: 'r1', type: 'image' as const, url: 'nomi-local://p/v1.png', createdAt: 1 }
  const v2 = { id: 'r2', type: 'image' as const, url: 'nomi-local://p/v2.png', createdAt: 2 }
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [imageNode('gen', { x: 0, y: 0 }, { result: v1, history: [v1, v2], status: 'success' })],
      edges: [], groups: [], selectedNodeIds: [],
    })
  })

  it('round-trips the drag payload and rejects foreign data', () => {
    const raw = encodeCanvasResultDrag({ sourceNodeId: 'gen', resultIdentity: 'r2', width: 1600, height: 900 })
    expect(parseCanvasResultDrag(raw)).toEqual({ sourceNodeId: 'gen', resultIdentity: 'r2', width: 1600, height: 900 })
    expect(parseCanvasResultDrag('not json')).toBeNull()
    expect(parseCanvasResultDrag(JSON.stringify({ sourceNodeId: 'gen' }))).toBeNull()
  })

  it('creates an independent asset card centred on the release point; the source stack is unchanged', () => {
    const id = createNodeFromDraggedResult({ sourceNodeId: 'gen', resultIdentity: 'r2', width: 1600, height: 900 }, { x: -520, y: 330 })
    const state = useGenerationCanvasStore.getState()
    const created = state.nodes.find((node) => node.id === id)!
    expect(created.kind).toBe('asset')
    expect(created.result?.url).toBe(v2.url)
    expect(created.meta?.imageAspectRatio).toBeCloseTo(16 / 9)
    const c = center(created)
    expect(Math.abs(c.x - -520)).toBeLessThanOrEqual(1)
    expect(Math.abs(c.y - 330)).toBeLessThanOrEqual(1)
    const source = state.nodes.find((node) => node.id === 'gen')!
    expect(source.result).toEqual(v1)
    expect(source.history).toEqual([v1, v2])
  })

  it('is one undo step (card + its result)', () => {
    createNodeFromDraggedResult({ sourceNodeId: 'gen', resultIdentity: 'r2' }, { x: 0, y: 0 })
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual(['gen'])
  })
})
