import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationCanvasSnapshot } from '../../src/workbench/generationCanvasV2/model/generationCanvasTypes'
import {
  __resetGenerationCanvasHistoryForTests,
  useGenerationCanvasStore,
} from '../../src/workbench/generationCanvasV2/store/generationCanvasStore'

function resetStore(snapshot: GenerationCanvasSnapshot = { nodes: [], edges: [], selectedNodeIds: [] }): void {
  __resetGenerationCanvasHistoryForTests()
  useGenerationCanvasStore.getState().restoreSnapshot(snapshot)
}

function imageNode(id: string, x = 0, y = 0): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    position: { x, y },
    prompt: `${id} prompt`,
    references: [],
    history: [],
    status: 'idle',
    meta: {},
  }
}

describe('generation canvas store CRUD/history/clipboard contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    vi.spyOn(Math, 'random').mockReturnValue(0.123456)
    resetStore()
  })

  it('creates, updates, connects, disconnects, and deletes nodes through the public store API', () => {
    const store = useGenerationCanvasStore.getState()
    const text = store.addNode({ kind: 'text', title: 'Script', prompt: 'Beat one', position: { x: 10, y: 20 } })
    const image = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Frame', prompt: 'Frame prompt', position: { x: 80, y: 20 } })

    useGenerationCanvasStore.getState().updateNodePrompt(text.id, 'Updated beat')
    useGenerationCanvasStore.getState().connectNodes(text.id, image.id, 'reference')
    useGenerationCanvasStore.getState().updateEdgeMode(`edge-${text.id}-${image.id}`, 'style_ref')

    expect(useGenerationCanvasStore.getState().nodes.find((node) => node.id === text.id)?.prompt).toBe('Updated beat')
    expect(useGenerationCanvasStore.getState().edges).toEqual([
      { id: `edge-${text.id}-${image.id}`, source: text.id, target: image.id, mode: 'style_ref' },
    ])

    useGenerationCanvasStore.getState().disconnectEdge(`edge-${text.id}-${image.id}`)
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(0)

    useGenerationCanvasStore.getState().selectNode(text.id)
    useGenerationCanvasStore.getState().deleteSelectedNodes()

    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual([image.id])
    expect(useGenerationCanvasStore.getState().selectedNodeIds).toEqual([])
  })

  it('undoes and redoes structural mutations without preserving stale redo after a new edit', () => {
    const first = useGenerationCanvasStore.getState().addNode({ kind: 'text', title: 'First' })
    const second = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Second' })

    expect(useGenerationCanvasStore.getState().canUndo).toBe(true)
    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual([first.id, second.id])

    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual([first.id])
    expect(useGenerationCanvasStore.getState().canRedo).toBe(true)

    useGenerationCanvasStore.getState().redo()
    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id)).toEqual([first.id, second.id])

    useGenerationCanvasStore.getState().undo()
    useGenerationCanvasStore.getState().addNode({ kind: 'video', title: 'Third' })
    expect(useGenerationCanvasStore.getState().canRedo).toBe(false)
  })

  it('copies, cuts, and pastes selected subgraphs while remapping node and edge ids', () => {
    resetStore({
      nodes: [imageNode('source', 10, 20), imageNode('target', 90, 20), imageNode('outside', 180, 20)],
      edges: [
        { id: 'edge-source-target', source: 'source', target: 'target', mode: 'reference' },
        { id: 'edge-target-outside', source: 'target', target: 'outside', mode: 'reference' },
      ],
      selectedNodeIds: ['source', 'target'],
    })

    useGenerationCanvasStore.getState().copySelectedNodes()
    expect(useGenerationCanvasStore.getState().hasClipboard).toBe(true)

    useGenerationCanvasStore.getState().pasteNodes()
    const pastedIds = useGenerationCanvasStore.getState().selectedNodeIds
    expect(pastedIds).toHaveLength(2)
    expect(pastedIds.every((id) => id.includes('-copy-'))).toBe(true)
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(5)
    expect(useGenerationCanvasStore.getState().edges.some((edge) => edge.source === pastedIds[0] && edge.target === pastedIds[1])).toBe(true)
    expect(useGenerationCanvasStore.getState().edges.some((edge) => edge.source === pastedIds[1] && edge.target === 'outside')).toBe(false)

    useGenerationCanvasStore.getState().cutSelectedNodes()
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(3)
    expect(useGenerationCanvasStore.getState().hasClipboard).toBe(true)
  })

  it('normalizes restored snapshots and drops invalid node, edge, and selection references', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        { id: ' valid ', kind: 'image', title: 42, position: { x: Number.NaN, y: 12 }, prompt: 'ok' },
        { id: 'bad-kind', kind: 'legacy', position: { x: 1, y: 2 } },
        { id: '', kind: 'image', position: { x: 1, y: 2 } },
      ],
      edges: [
        { id: ' kept ', source: ' valid ', target: ' valid ', mode: 'reference' },
        { id: 'dropped', source: 'valid', target: 'missing' },
      ],
      selectedNodeIds: ['valid', 'missing'],
    })

    expect(useGenerationCanvasStore.getState().readSnapshot()).toEqual({
      nodes: [expect.objectContaining({ id: 'valid', kind: 'image', title: 'valid', position: { x: 0, y: 12 } })],
      edges: [{ id: 'kept', source: 'valid', target: 'valid', mode: 'reference' }],
      selectedNodeIds: ['valid'],
    })
  })

  it('tracks run progress, result history, regeneration duplicates, and history rollback', () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Frame' })
    const run = useGenerationCanvasStore.getState().appendNodeRun(node.id, {
      id: 'run-1',
      status: 'queued',
      taskId: 'task-1',
      startedAt: 1_000,
      updatedAt: 1_000,
    })

    useGenerationCanvasStore.getState().setNodeProgress(node.id, {
      taskId: 'task-1',
      taskKind: 'image',
      phase: 'rendering',
      percent: 142,
      updatedAt: 2_000,
    })

    expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === node.id)?.progress).toEqual(expect.objectContaining({
      runId: run.id,
      percent: 100,
      phase: 'rendering',
    }))

    useGenerationCanvasStore.getState().addNodeResult(node.id, {
      id: 'result-1',
      type: 'image',
      url: 'https://cdn.test/frame.png',
      taskId: 'task-1',
      createdAt: 5_000,
    })
    useGenerationCanvasStore.getState().addNodeResult(node.id, {
      id: 'result-2',
      type: 'image',
      url: 'https://cdn.test/frame-2.png',
      createdAt: 6_000,
    })

    const updatedNode = useGenerationCanvasStore.getState().nodes.find((item) => item.id === node.id)
    expect(updatedNode?.status).toBe('success')
    expect(updatedNode?.runs?.[0]?.status).toBe('success')
    expect(updatedNode?.history?.map((result) => result.id)).toEqual(['result-2', 'result-1'])

    useGenerationCanvasStore.getState().rollbackHistory(node.id, 'result-1')
    expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === node.id)?.result?.id).toBe('result-1')

    const duplicate = useGenerationCanvasStore.getState().duplicateNodeForRegeneration(node.id)
    expect(duplicate?.result).toBeUndefined()
    expect(duplicate?.history?.map((result) => result.id)).toEqual(['result-2', 'result-1'])
    expect(duplicate?.position).toEqual({ x: node.position.x + 40, y: node.position.y + 40 })
  })
})
