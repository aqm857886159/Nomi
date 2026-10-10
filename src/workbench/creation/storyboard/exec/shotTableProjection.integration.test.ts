import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../../../workbenchStore'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import type { StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { applyProposalBatch } from '../../../generationCanvas/agent/proposalTxn'
import { abandonPendingCanvasWrite, ownPendingCanvasWrite, whenCanvasWriteBoundarySettled } from '../../../generationCanvas/events/canvasWriteBoundary'

const plan: StoryboardPlan = { title: '稿件分镜', anchors: [], shots: [{ shotId: 'third', index: 3, durationSec: 5, anchorIds: [], prompt: '日出' }] }
const canvas = () => useGenerationCanvasStore.getState()
const tables = () => canvas().nodes.filter(node => node.kind === 'shot_table')
beforeEach(() => {
  abandonPendingCanvasWrite()
  useWorkbenchStore.setState({ workbenchDocuments: [{ id: 'doc', version: 1, title: '', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }], activeDocumentId: 'doc', activeStoryboardId: null, storyboardDesignsByDocumentId: {}, storyboardRowFocus: null, workspaceMode: 'generation' })
  canvas().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
})
afterEach(abandonPendingCanvasWrite)
describe('storyboard writes never put a shot table on the canvas', () => {
  // 2026-10-08 用户：「我们经常莫名其妙生成分镜表，这个可以删掉吧」。分镜表是方案的派生视图，不是数据，写方案不许顺手造节点。
  it('explicit plan writes, edits and duplicates add no shot_table, even after the write boundary settles', async () => {
    const release = await ownPendingCanvasWrite('foreign-receipt', () => false)
    const store = useWorkbenchStore.getState()
    const design = store.setStoryboardPlan(plan)!
    store.duplicateStoryboardDesign(design.id)
    store.setStoryboardPlan({ ...plan, title: '最新稿' })
    release()
    await whenCanvasWriteBoundarySettled()
    expect(tables()).toHaveLength(0)
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc.length).toBe(2)
  })
  it.each(['propose_storyboard_plan', 'patch_shots'])('the Agent path %s writes the plan and adds no shot_table', async operation => {
    if (operation === 'patch_shots') useWorkbenchStore.getState().hydrateStoryboardDesigns({ doc: [{ id: 'design', documentId: 'doc', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] })
    const outcome = await applyProposalBatch([{ toolCallId: 'table-write', toolName: operation === 'patch_shots' ? 'nomi_canvas_plan' : operation, effectiveArgs: operation === 'patch_shots' ? { operation, select: { kind: 'all' }, patch: { promptAppend: '月光' } } : { ...plan } }])
    expect(outcome.status).toBe('committed')
    expect(tables()).toHaveLength(0)
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc[0].plan.shots).toHaveLength(1)
  })
  it('does not project a source deleted before its receipt owner releases', async () => {
    const release = await ownPendingCanvasWrite('foreign-receipt', () => false)
    useWorkbenchStore.getState().setStoryboardPlan(plan)
    useWorkbenchStore.getState().hydrateStoryboardDesigns({})
    release()
    await whenCanvasWriteBoundarySettled()
    expect(canvas().nodes).toHaveLength(0)
  })
  it('does not project queued designs into a replacement canvas', async () => {
    const release = await ownPendingCanvasWrite('foreign-receipt', () => false)
    useWorkbenchStore.getState().setStoryboardPlan(plan)
    abandonPendingCanvasWrite()
    canvas().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    release()
    await whenCanvasWriteBoundarySettled()
    expect(canvas().nodes).toHaveLength(0)
  })
  it('plan edits continue through the existing projection to an original shot node', () => {
    const store = useWorkbenchStore.getState()
    const design = store.setStoryboardPlan(plan)!
    const node = canvas().addNode({ kind: 'video', prompt: '日出', meta: { shotId: 'third', storyboardDesignId: design.id } })
    store.setStoryboardPlan({ ...plan, shots: [{ ...plan.shots[0], prompt: '月光' }] })
    expect(canvas().nodes.find(candidate => candidate.id === node.id)?.prompt).toContain('月光')
    expect(tables()).toHaveLength(0)
  })
})
