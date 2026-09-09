import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../../../workbenchStore'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import type { StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { readShotTable } from '../../../../../electron/shared/canvas/shotTable'
import { openShotTableRow } from '../openShotTableRow'
import { applyProposalBatch } from '../../../generationCanvas/agent/proposalTxn'
import { abandonPendingCanvasWrite } from '../../../generationCanvas/events/canvasWriteBoundary'

const plan: StoryboardPlan = { title: '稿件分镜', anchors: [], shots: [{ shotId: 'third', index: 3, durationSec: 5, anchorIds: [], prompt: '日出' }] }
const canvas = () => useGenerationCanvasStore.getState()
const tables = () => canvas().nodes.filter(node => node.kind === 'shot_table')
beforeEach(() => {
  abandonPendingCanvasWrite()
  useWorkbenchStore.setState({ workbenchDocuments: [{ id: 'doc', version: 1, title: '', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }], activeDocumentId: 'doc', activeStoryboardId: null, storyboardDesignsByDocumentId: {}, storyboardRowFocus: null, workspaceMode: 'generation' })
  canvas().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
})
afterEach(abandonPendingCanvasWrite)
describe('storyboard canvas table wiring', () => {
  it.each(['propose_storyboard_plan', 'patch_shots'])('keeps %s inside the owning proposal while creating its table', async operation => {
    if (operation === 'patch_shots') useWorkbenchStore.getState().hydrateStoryboardDesigns({ doc: [{ id: 'design', documentId: 'doc', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] })
    const outcome = await applyProposalBatch([{ toolCallId: 'table-write', toolName: operation === 'patch_shots' ? 'nomi_canvas_plan' : operation, effectiveArgs: operation === 'patch_shots' ? { operation, select: { kind: 'all' }, patch: { promptAppend: '月光' } } : { ...plan } }])
    expect(outcome.status).toBe('committed')
    expect(tables()).toHaveLength(1)
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc[0].plan.shots).toHaveLength(1)
  })
  it('creates exactly one view per source on explicit writes and duplicates, without cached rows', () => {
    const store = useWorkbenchStore.getState()
    const design = store.setStoryboardPlan(plan)!
    const tableId = tables()[0].id
    store.setStoryboardPlan({ ...plan, title: '新版' })
    expect(tables()).toHaveLength(1)
    expect(tables()[0].id).toBe(tableId)
    expect(readShotTable(tables()[0].meta)?.source).toEqual({ kind: 'storyboard', documentId: 'doc', designId: design.id })
    expect(tables()[0].meta?.shotTable).not.toHaveProperty('rows')
    store.duplicateStoryboardDesign(design.id)
    expect(tables()).toHaveLength(2)
  })
  it('does not create nodes during hydration or for an empty starter', () => {
    const store = useWorkbenchStore.getState()
    const design = store.setStoryboardPlan({ ...plan, shots: [] })!
    expect(tables()).toHaveLength(0)
    store.hydrateStoryboardDesigns({ doc: [{ ...design, plan }] })
    expect(tables()).toHaveLength(0)
    store.setStoryboardPlan(plan)
    expect(tables()).toHaveLength(1)
  })
  it('navigates by source and stable row id, rejecting deleted rows', () => {
    const design = useWorkbenchStore.getState().setStoryboardPlan(plan)!
    const source = { kind: 'storyboard' as const, documentId: 'doc', designId: design.id }
    expect(openShotTableRow(source, 'missing')).toBe(false)
    expect(useWorkbenchStore.getState().workspaceMode).toBe('generation')
    expect(openShotTableRow(source, 'third')).toBe(true)
    expect(useWorkbenchStore.getState()).toMatchObject({ activeStoryboardId: design.id, workspaceMode: 'storyboard', storyboardRowFocus: { designId: design.id, rowId: 'third' } })
  })
  it('plan edits continue through the existing projection to an original shot node', () => {
    const store = useWorkbenchStore.getState()
    const design = store.setStoryboardPlan(plan)!
    const node = canvas().addNode({ kind: 'video', prompt: '日出', meta: { shotId: 'third', storyboardDesignId: design.id } })
    store.setStoryboardPlan({ ...plan, shots: [{ ...plan.shots[0], prompt: '月光' }] })
    expect(canvas().nodes.find(candidate => candidate.id === node.id)?.prompt).toContain('月光')
    expect(tables()).toHaveLength(1)
    canvas().deleteNode(tables()[0].id)
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc[0].plan.shots[0].prompt).toBe('月光')
  })
})
