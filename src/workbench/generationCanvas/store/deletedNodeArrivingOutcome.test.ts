// 生成中删了节点 → 结局在节点不在时到达 → 撤销删除：节点回来时这笔结局（钱已花）要落在它身上，
// 不能带着「生成中」永远转圈。删节点不取消上游任务，所以结局一定会到；先撤销再到达本来就能落。
// 矩阵 = 每一扇删节点的门 × 每一种之后到达的结局。
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../project/projectCanvasReadSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../project/projectCanvasReadSurface')>()),
  isProjectBindingOpen: () => true,
}))

import { useGenerationCanvasStore } from './generationCanvasStore'
import { deliverRunOutcome, type RunProjectTarget } from '../runner/runProjectDelivery'
import type { GenerationCanvasNode, GenerationNodeResult, TiptapDocJson } from '../model/generationCanvasTypes'

const TARGET = { projectId: 'p-del', immutableProjectUuid: 'u-del', projectGeneration: 1 } as RunProjectTarget
const IMAGE = 'shot-1'
const TEXT = 'text-1'
const KEEP = 'shot-2'
const LANDED: GenerationNodeResult = { id: 'r-landed', type: 'image', url: 'nomi-local://landed.png', createdAt: 2 }
const DOC: TiptapDocJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'paid text' }] }] }

const node = (id: string) => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)

function seed(): void {
  const base = (id: string, kind: GenerationCanvasNode['kind'], x: number): GenerationCanvasNode => ({
    id, kind, title: id, position: { x, y: 40 }, prompt: `${id} prompt`, categoryId: 'shots',
  })
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [base(IMAGE, 'image', 100), base(TEXT, 'text', 600), base(KEEP, 'image', 1100)],
    edges: [],
    groups: [],
    selectedNodeIds: [],
  })
}

type Deletion = Readonly<{ name: string; remove: (nodeId: string) => void }>

const DELETIONS: readonly Deletion[] = [
  { name: 'delete node', remove: (nodeId) => useGenerationCanvasStore.getState().deleteNode(nodeId) },
  {
    name: 'delete selected nodes',
    remove: (nodeId) => {
      useGenerationCanvasStore.getState().selectNodes([nodeId])
      useGenerationCanvasStore.getState().deleteSelectedNodes()
    },
  },
  {
    name: 'cut',
    remove: (nodeId) => {
      useGenerationCanvasStore.getState().selectNodes([nodeId])
      useGenerationCanvasStore.getState().cutSelectedNodes()
    },
  },
  {
    name: 'external write deletes it',
    remove: (nodeId) => {
      const { nodes, edges, groups } = useGenerationCanvasStore.getState().readDocumentSnapshot()
      useGenerationCanvasStore.getState().applyExternalGraph({ base: { nodes, edges, groups }, next: { nodes: nodes.filter((candidate) => candidate.id !== nodeId), edges, groups } })
    },
  },
]

type Arrival = Readonly<{
  name: string
  nodeId: string
  start: () => Promise<void>
  arrive: () => Promise<boolean>
  assertLanded: (landed: GenerationCanvasNode | undefined) => void
}>

const ARRIVALS: readonly Arrival[] = [
  {
    name: 'generation result',
    nodeId: IMAGE,
    start: async () => { await deliverRunOutcome(TARGET, IMAGE, { kind: 'run-started', run: { id: 'run-a', status: 'running', startedAt: 10, updatedAt: 10 } }) },
    arrive: () => deliverRunOutcome(TARGET, IMAGE, { kind: 'result', result: LANDED }),
    assertLanded: (landed) => {
      expect(landed?.result?.id).toBe('r-landed')
      expect(landed?.history?.map((entry) => entry.id)).toEqual(['r-landed'])
      expect(landed?.status).toBe('success')
      expect(landed?.runs?.[0]).toMatchObject({ id: 'run-a', status: 'success' })
    },
  },
  {
    name: 'text finalisation',
    nodeId: TEXT,
    start: async () => { await deliverRunOutcome(TARGET, TEXT, { kind: 'run-started', run: { id: 'run-t', status: 'running', startedAt: 10, updatedAt: 10 } }) },
    // 真实流程：generateText 先落定稿，runGenerationNode 再投递文本结果收尾（状态收成 success）。
    arrive: async () => {
      await deliverRunOutcome(TARGET, TEXT, { kind: 'content', contentJson: DOC, runId: 'run-t' })
      return deliverRunOutcome(TARGET, TEXT, { kind: 'result', result: { id: 'r-text', type: 'text', text: 'paid text', createdAt: 3 } })
    },
    assertLanded: (landed) => {
      expect(landed?.contentJson).toEqual(DOC)
      expect(landed?.status).toBe('success')
    },
  },
  {
    name: 'generation failure',
    nodeId: IMAGE,
    start: async () => { await deliverRunOutcome(TARGET, IMAGE, { kind: 'run-started', run: { id: 'run-e', status: 'running', startedAt: 10, updatedAt: 10 } }) },
    arrive: () => deliverRunOutcome(TARGET, IMAGE, { kind: 'status', status: 'error', error: 'upstream refused' }),
    assertLanded: (landed) => {
      expect(landed?.status).toBe('error')
      expect(landed?.runs?.[0]).toMatchObject({ id: 'run-e', status: 'error' })
    },
  },
]

describe('an outcome that arrives while its node is deleted lands when undo brings the node back', () => {
  beforeEach(seed)

  const matrix = DELETIONS.flatMap((deletion) => ARRIVALS.map((arrival) => [deletion.name, arrival.name, deletion, arrival] as const))

  it.each(matrix)('%s · %s', async (_d, _a, deletion, arrival) => {
    await arrival.start()
    deletion.remove(arrival.nodeId)
    expect(node(arrival.nodeId)).toBeUndefined()
    await arrival.arrive()

    useGenerationCanvasStore.getState().undo()

    const restored = node(arrival.nodeId)
    expect(restored).toBeDefined()
    expect(restored?.status).not.toBe('running')
    arrival.assertLanded(restored)
    expect(node(KEEP)).toBeDefined()
  })

  it.each(ARRIVALS.map((arrival) => [arrival.name, arrival] as const))('%s: redoing the deletion removes it again; undoing once more brings it back landed', async (_name, arrival) => {
    await arrival.start()
    DELETIONS[0].remove(arrival.nodeId)
    await arrival.arrive()
    useGenerationCanvasStore.getState().undo()
    useGenerationCanvasStore.getState().redo()
    expect(node(arrival.nodeId)).toBeUndefined()
    useGenerationCanvasStore.getState().undo()
    arrival.assertLanded(node(arrival.nodeId))
  })

  it.each(ARRIVALS.map((arrival) => [arrival.name, arrival] as const))('%s: undo before the arrival still lands normally (control)', async (_name, arrival) => {
    await arrival.start()
    DELETIONS[0].remove(arrival.nodeId)
    useGenerationCanvasStore.getState().undo()
    await arrival.arrive()
    arrival.assertLanded(node(arrival.nodeId))
  })
})
