import { runWhenCanvasWriteBoundarySettled } from '../../../generationCanvas/events/canvasWriteBoundary'
import { getUndoJournalGeneration } from '../../../generationCanvas/events/canvasUndoJournal'
import { projectStoryboardDesign } from './storyboardProjection'
import type { StoryboardDesign } from '../../../workbenchTypes'
import type { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'

/** Explicit source edits own the design; their derived canvas view follows the
 * durable write boundary and is discarded if that canvas lifetime has ended. */
export function applyStoryboardPlanProjection(
  readDesign: () => StoryboardDesign | undefined,
  readCanvas: typeof useGenerationCanvasStore.getState,
): void {
  const generation = getUndoJournalGeneration()
  runWhenCanvasWriteBoundarySettled(() => {
    if (getUndoJournalGeneration() !== generation) return
    const design = readDesign()
    if (!design) return
    const canvas = readCanvas()
    projectStoryboardDesign(design, canvas)
  })
}
