import type { ModelOption } from '../../../../config/models'
import type { StoryboardDesign } from '../../../workbenchTypes'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import type { ShotTableDocument } from '../../../../../electron/shared/canvas/shotTable'
import { deriveStoryboardRowRuntimes } from '../../../creation/storyboard/exec/storyboardRowStatus'
import type { ShotRowExec } from '../../../creation/storyboard/exec/storyboardRowStatus'
import { effectiveShotValue } from '../../../creation/storyboard/shotRow/shotRowModel'
import { referenceColumnOf, type ShotReferenceColumn } from '../../../creation/storyboard/shotRow/shotReferenceCells'
import { stableShotId, effectiveShotDurationSec } from '../../agent/storyboardPlan'

export type ShotTableRowView = {
  id: string
  index: number
  duration: number
  start?: number
  end?: number
  prompt: string
  thumbnail?: string
  exec?: ShotRowExec
  references?: ShotReferenceColumn
  cells?: Record<string, string>
  visionFailed?: boolean
}

/** Read-through only: effective values honor original canvas overrides; nothing is cached in meta. */
export function selectShotTableRows(input: {
  table: ShotTableDocument
  designs: Record<string, StoryboardDesign[]>
  nodes: readonly GenerationCanvasNode[]
  imageModelOptions: readonly ModelOption[]
  videoModelOptions: readonly ModelOption[]
}): ShotTableRowView[] {
  const { table, designs, nodes, imageModelOptions, videoModelOptions } = input
  if (table.source.kind === 'deconstruction') {
    return (table.rows ?? []).map(row => ({
      id: row.rowId, index: row.order, duration: row.durationSeconds, start: row.startSeconds, end: row.endSeconds,
      prompt: row.cells.visual ?? '', thumbnail: row.keyframeRef,
      cells: row.cells, visionFailed: row.visionFailed,
    }))
  }
  const source = table.source
  const design = designs[source.documentId]?.find(candidate => candidate.id === source.designId)
  if (!design) return []
  return deriveStoryboardRowRuntimes({ plan: design.plan, designId: design.id, nodes, imageModelOptions, videoModelOptions }).map(({ shot, mode, exec }) => ({
    id: stableShotId(shot), index: shot.index, duration: effectiveShotDurationSec(shot),
    prompt: String(effectiveShotValue(shot, exec.node, 'prompt') ?? ''),
    thumbnail: exec.resultUrl ?? undefined, exec,
    references: referenceColumnOf(mode, shot.referenceBindings),
  }))
}
