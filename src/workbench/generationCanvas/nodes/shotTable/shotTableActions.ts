import { readShotTable, type DeconstructionShotTableDocument } from '../../../../../electron/shared/canvas/shotTable'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbenchStore'
import { deriveStoryboardBatch, deriveStoryboardRowRuntimes } from '../../../creation/storyboard/exec/storyboardRowStatus'
import { runStoryboardBatch } from '../../../creation/storyboard/exec/storyboardRowActions'
import type { ModelOption } from '../../../../config/models'
import type { StoryboardPlan } from '../../agent/storyboardPlan'

/** Edits operate on the latest document, preserving unrelated edits and immutable measured fields. */
export function editShotTableFacts(nodeId: string, edit: (table: DeconstructionShotTableDocument) => DeconstructionShotTableDocument): void {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find(candidate => candidate.id === nodeId)
  const table = readShotTable(node?.meta)
  if (!node || !table) return
  store.updateNode(nodeId, { meta: { ...node.meta, shotTable: { ...edit(table), revision: table.revision + 1, updatedAt: new Date().toISOString() } } })
}

/** Facts compile to a new production plan once; neither view becomes a second facts owner. */
export async function generateSelectedTableRows(nodeId: string, imageModelOptions: readonly ModelOption[], videoModelOptions: readonly ModelOption[]): Promise<void> {
  const canvas = useGenerationCanvasStore.getState()
  const table = readShotTable(canvas.nodes.find(node => node.id === nodeId)?.meta)
  if (!table || !table.view.selectedRowIds.length) return
  const workbench = useWorkbenchStore.getState()
  const source = table.source
  const prefix = `fact:${encodeURIComponent(source.sourceNodeId)}:`
  const selected = table.rows.filter(row => table.view.selectedRowIds.includes(row.rowId))
  const existing = Object.values(workbench.storyboardDesignsByDocumentId).flat()
    .find(design => design.plan.shots.some(shot => shot.shotId?.startsWith(prefix)))
  const priorShots = existing?.plan.shots ?? []
  const newRows = selected.filter(row => !priorShots.some(shot => shot.shotId === `${prefix}${row.rowId}`))
  const plan: StoryboardPlan = { ...(existing?.plan ?? { title: source.title, anchors: [] }), shots: [
    ...priorShots,
    ...newRows.map((row, i) => ({
      index: priorShots.length + i + 1, shotId: `${prefix}${row.rowId}`, shotKind: 'image' as const,
      durationSec: row.durationSeconds, anchorIds: [], prompt: row.imagePrompt || row.cells.visual || '',
    })),
  ] }
  // Copy each fact into a production owner once. Later user edits remain owned by that plan.
  const design = existing && !newRows.length ? existing
    : workbench.setStoryboardPlan(plan, existing?.documentId, existing?.id, false, existing ? false : 'user')
  if (!design) return
  const rows = deriveStoryboardRowRuntimes({ plan: design.plan, designId: design.id, nodes: canvas.nodes, imageModelOptions, videoModelOptions })
  const selectedIds = new Set(table.view.selectedRowIds.map(id => `${prefix}${id}`))
  const selectedRows = rows.filter(row => selectedIds.has(row.shot.shotId ?? `shot-${row.shot.index}`))
  const batch = deriveStoryboardBatch(selectedRows)
  await runStoryboardBatch({ documentId: design.documentId, designId: design.id, plan: design.plan, initiator: 'user' }, batch.runnable, { groupTitle: design.title })
}
