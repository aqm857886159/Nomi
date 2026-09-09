import { beforeEach, expect, it, vi } from 'vitest'
import { generateSelectedTableRows } from './shotTableActions'
import { useWorkbenchStore } from '../../../workbenchStore'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { createDeconstructionShotTable } from './shotTableFacts'

vi.mock('../../../creation/storyboard/exec/storyboardRowActions', () => ({ runStoryboardBatch: vi.fn() }))
vi.mock('../../../creation/storyboard/exec/storyboardRowStatus', () => ({
  deriveStoryboardRowRuntimes: ({ plan }: { plan: { shots: unknown[] } }) => plan.shots.map(shot => ({ shot })),
  deriveStoryboardBatch: (rows: unknown[]) => ({ runnable: rows }),
}))

beforeEach(() => {
  useWorkbenchStore.setState({ workbenchDocuments: [{ id: 'doc', version: 1, title: '', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }], activeDocumentId: 'doc', activeStoryboardId: null, storyboardDesignsByDocumentId: {} })
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
})

it('adopts stable fact rows once and preserves production edits across subsequent selections', async () => {
  const table = createDeconstructionShotTable('source-video', 'Reference')
  table.rows = ['one', 'two'].map((rowId, index) => ({ rowId, order: index + 1, startSeconds: index, endSeconds: index + 1, durationSeconds: 1, carriedOver: false, cells: { visual: rowId } }))
  table.view.selectedRowIds = ['one']
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'shot_table', meta: { shotTable: table } })
  await generateSelectedTableRows(node.id, [], [])
  const first = useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc[0]
  useWorkbenchStore.getState().setStoryboardPlan({ ...first.plan, shots: [{ ...first.plan.shots[0], prompt: 'User edited' }] }, 'doc', first.id)
  const selectedTable = { ...table, view: { ...table.view, selectedRowIds: ['one', 'two'] } }
  useGenerationCanvasStore.getState().updateNode(node.id, { meta: { shotTable: selectedTable } })
  await generateSelectedTableRows(node.id, [], [])
  await generateSelectedTableRows(node.id, [], [])
  const designs = useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc
  expect(designs).toHaveLength(1)
  expect(designs[0].id).toBe(first.id)
  expect(designs[0].plan.shots).toHaveLength(2)
  expect(designs[0].plan.shots.map(shot => shot.shotId)).toEqual(['fact:source-video:one', 'fact:source-video:two'])
  expect(designs[0].plan.shots[0].prompt).toBe('User edited')
  expect(useGenerationCanvasStore.getState().nodes.find(item => item.id === node.id)?.meta?.shotTable).toEqual(selectedTable)
})
