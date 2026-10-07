// 撤销 / 重做只管用户自己的编辑；生成结果落地是系统事实，Ctrl+Z 不许把它撤掉（钱已经花了）。
// 矩阵 = 每一扇「结果落地」的门 × 每一种「用户编辑」：编辑 → 落地 → 撤销 → 编辑回退、落地还在；
// 再重做 → 编辑回来、落地仍在。另有删节点、撤销后才落地、生成中撤销三条边界。
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../project/projectCanvasReadSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../project/projectCanvasReadSurface')>()),
  // 运行所属项目 = 正打开的项目：结局走 store（真实前台路径），不读写盘。
  isProjectBindingOpen: () => true,
}))

import { useGenerationCanvasStore } from './generationCanvasStore'
import { deliverRunOutcome, type RunProjectTarget } from '../runner/runProjectDelivery'
import { attachShotResult } from '../../capability/multiShotCanvasLanding'
import type { GenerationCanvasNode, GenerationNodeResult, TiptapDocJson } from '../model/generationCanvasTypes'

const TARGET = { projectId: 'p-undo', immutableProjectUuid: 'u-undo', projectGeneration: 1 } as RunProjectTarget
const NODE_ID = 'shot-1'
const OTHER_ID = 'shot-2'

function baseNode(id: string, x: number): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    position: { x, y: 40 },
    prompt: `${id} prompt`,
    categoryId: 'shots',
    meta: { aspectRatio: '16:9' },
  }
}

const OLD_RESULT: GenerationNodeResult = { id: 'r-old', type: 'image', url: 'nomi-local://old.png', createdAt: 1, versionNo: 1 }
const LANDED_RESULT: GenerationNodeResult = { id: 'r-landed', type: 'image', url: 'nomi-local://landed.png', createdAt: 2 }
const LANDED_DOC: TiptapDocJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'paid text' }] }] }

function seed(): void {
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [
      { ...baseNode(NODE_ID, 100), result: OLD_RESULT, history: [OLD_RESULT], resultVersionMax: 1, status: 'success' },
      baseNode(OTHER_ID, 600),
    ],
    edges: [],
    groups: [],
    selectedNodeIds: [],
  })
}

const node = (id = NODE_ID) => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)

type LandingDoor = Readonly<{
  name: string
  land: () => Promise<void>
  /** 落地之后节点上必须还在的事实。 */
  assertLanded: (landed: GenerationCanvasNode | undefined) => void
}>

const startRun = (runId: string) => deliverRunOutcome(TARGET, NODE_ID, { kind: 'run-started', run: { id: runId, status: 'running', startedAt: 10, updatedAt: 10 } })

const expectLandedResult = (landed: GenerationCanvasNode | undefined) => {
  expect(landed?.result?.id).toBe('r-landed')
  expect(landed?.history?.map((entry) => entry.id)).toEqual(['r-landed', 'r-old'])
  expect(landed?.resultVersionMax).toBe(2)
  expect(landed?.status).toBe('success')
}

// 每一扇在渲染层 store 里写「生成结局」的门（door-map：deliverRunOutcome 的四种结局 + 制作流程回填）。
const LANDING_DOORS: readonly LandingDoor[] = [
  {
    name: 'runner result (deliverRunOutcome result → addNodeResult)',
    land: async () => {
      await startRun('run-a')
      await deliverRunOutcome(TARGET, NODE_ID, { kind: 'result', result: LANDED_RESULT })
    },
    assertLanded: expectLandedResult,
  },
  {
    name: 'production materialization backfill (attachShotResult → addNodeResult)',
    land: async () => {
      expect(attachShotResult({ nodeId: NODE_ID, result: LANDED_RESULT })).toEqual({ attached: true, nodeId: NODE_ID })
    },
    assertLanded: expectLandedResult,
  },
  {
    name: 'text generation content (deliverRunOutcome content)',
    land: async () => {
      await startRun('run-text')
      await deliverRunOutcome(TARGET, NODE_ID, { kind: 'content', contentJson: LANDED_DOC, runId: 'run-text' })
    },
    assertLanded: (landed) => expect(landed?.contentJson).toEqual(LANDED_DOC),
  },
  {
    name: 'generation in flight (deliverRunOutcome run-started)',
    land: async () => {
      await startRun('run-flight')
    },
    assertLanded: (landed) => {
      expect(landed?.status).toBe('running')
      expect(landed?.runs?.[0]?.id).toBe('run-flight')
    },
  },
  {
    name: 'generation failed (deliverRunOutcome status error)',
    land: async () => {
      await startRun('run-fail')
      await deliverRunOutcome(TARGET, NODE_ID, { kind: 'status', status: 'error', error: 'upstream refused' })
    },
    assertLanded: (landed) => {
      expect(landed?.status).toBe('error')
      expect(landed?.runs?.[0]).toMatchObject({ id: 'run-fail', status: 'error' })
    },
  },
]

type UserEdit = Readonly<{
  name: string
  edit: () => void
  /** true = 编辑已生效；false = 已被撤销。 */
  isApplied: () => boolean
}>

const USER_EDITS: readonly UserEdit[] = [
  {
    name: 'change a parameter',
    edit: () => useGenerationCanvasStore.getState().updateNode(NODE_ID, { meta: { ...node()?.meta, aspectRatio: '9:16' } }),
    isApplied: () => node()?.meta?.aspectRatio === '9:16',
  },
  {
    name: 'change the prompt',
    edit: () => useGenerationCanvasStore.getState().updateNodePrompt(NODE_ID, 'a new prompt'),
    isApplied: () => node()?.prompt === 'a new prompt',
  },
  {
    name: 'move the node',
    // 真实拖动：按下时打撤销点（useCanvasSelectionDrag），拖动中 moveNode。
    edit: () => {
      useGenerationCanvasStore.getState().captureHistory()
      useGenerationCanvasStore.getState().moveNode(NODE_ID, { x: 333, y: 444 })
    },
    isApplied: () => node()?.position.x === 333,
  },
  {
    name: 'connect another node',
    // 真实连线手势：从源节点拉线，落到目标节点。
    edit: () => {
      useGenerationCanvasStore.getState().startConnection(OTHER_ID)
      useGenerationCanvasStore.getState().connectToNode(NODE_ID)
    },
    isApplied: () => useGenerationCanvasStore.getState().edges.some((edge) => edge.source === OTHER_ID && edge.target === NODE_ID),
  },
  {
    name: 'delete another node',
    edit: () => useGenerationCanvasStore.getState().deleteNode(OTHER_ID),
    isApplied: () => !node(OTHER_ID),
  },
]

describe('undo never takes back a landed generation outcome', () => {
  beforeEach(seed)

  const matrix = LANDING_DOORS.flatMap((door) => USER_EDITS.map((edit) => [door.name, edit.name, door, edit] as const))

  it.each(matrix)('%s survives undo/redo of "%s"', async (_door, _edit, door, edit) => {
    edit.edit()
    expect(edit.isApplied()).toBe(true)
    await door.land()
    door.assertLanded(node())

    useGenerationCanvasStore.getState().undo()
    expect(edit.isApplied()).toBe(false)
    door.assertLanded(node())

    useGenerationCanvasStore.getState().redo()
    expect(edit.isApplied()).toBe(true)
    door.assertLanded(node())
  })

  it.each(LANDING_DOORS.map((door) => [door.name, door] as const))('%s that lands after an undo survives the redo', async (_name, door) => {
    USER_EDITS[0].edit()
    useGenerationCanvasStore.getState().undo()
    await door.land()
    useGenerationCanvasStore.getState().redo()
    expect(USER_EDITS[0].isApplied()).toBe(true)
    door.assertLanded(node())
  })

  it('undoing a node deletion brings the node back with every result that landed before the delete', async () => {
    USER_EDITS[0].edit()
    await LANDING_DOORS[0].land()
    useGenerationCanvasStore.getState().deleteNode(NODE_ID)
    expect(node()).toBeUndefined()
    useGenerationCanvasStore.getState().undo()
    expectLandedResult(node())
    // 再往前撤一步（撤参数）：结果仍在。
    useGenerationCanvasStore.getState().undo()
    expect(USER_EDITS[0].isApplied()).toBe(false)
    expectLandedResult(node())
  })

  it('undoing the user\'s own version deletion still restores that version next to a later landing', async () => {
    const store = useGenerationCanvasStore.getState()
    await LANDING_DOORS[0].land()
    // 用户删掉旧版（用户编辑，进撤销），之后又落了一版。
    store.updateNode(NODE_ID, { history: node()!.history!.filter((entry) => entry.id !== 'r-old'), meta: { ...node()?.meta } })
    expect(node()?.history?.map((entry) => entry.id)).toEqual(['r-landed'])
    await deliverRunOutcome(TARGET, NODE_ID, { kind: 'result', result: { id: 'r-third', type: 'image', url: 'nomi-local://third.png', createdAt: 3 } })
    store.undo()
    expect(node()?.history?.map((entry) => entry.id)).toEqual(['r-third', 'r-landed', 'r-old'])
    expect(node()?.result?.id).toBe('r-third')
  })
})
