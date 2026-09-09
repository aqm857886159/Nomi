import { projectStoryboardDesign } from './storyboardProjection'
import { createStoryboardShotTable, readShotTable } from '../../../../../electron/shared/canvas/shotTable'
import type { StoryboardDesign } from '../../../workbenchTypes'
import type { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'

/** Explicit design writes create one view; hydration never manufactures canvas nodes. */
export function ensureStoryboardShotTable(design: StoryboardDesign, canvas: ReturnType<typeof useGenerationCanvasStore.getState>): void {
  const existing = canvas.nodes.find((node) => {
    const table = node.kind === 'shot_table' ? readShotTable(node.meta) : undefined
    return table?.source.kind === 'storyboard' && table.source.documentId === design.documentId && table.source.designId === design.id
  })
  if (existing || design.plan.shots.length === 0) return
  canvas.addNode({ kind: 'shot_table', title: design.title, categoryId: 'shots', meta: {
    shotTable: createStoryboardShotTable(design.documentId, design.id, new Date(design.updatedAt).toISOString()),
  } })
}

/** Composition of the existing owner projection and its canvas table view. */
export function applyStoryboardPlanProjection(design: StoryboardDesign, canvas: ReturnType<typeof useGenerationCanvasStore.getState>): void {
  ensureStoryboardShotTable(design, canvas)
  projectStoryboardDesign(design, canvas)
}
