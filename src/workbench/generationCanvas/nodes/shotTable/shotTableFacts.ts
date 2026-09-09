import {
  deconstructionShotTableSchema,
  type DeconstructionShotTableDocument,
  type ShotTableColumn,
} from '../../../../../electron/shared/canvas/shotTable'
import type { DeconstructionResult } from '../deconstructionTypes'

export function defaultFactColumns(): ShotTableColumn[] {
  return ['shotSize', 'motion', 'visual', 'dialogue', 'onScreenText', 'mood'].map((columnId, order) => ({
    columnId, kind: 'builtin', labelKey: columnId, order, visible: true,
  }))
}

export function createDeconstructionShotTable(sourceNodeId: string, title: string): DeconstructionShotTableDocument {
  return deconstructionShotTableSchema.parse({
    schemaVersion: 1, source: { kind: 'deconstruction', sourceNodeId, title, status: 'idle' },
    columnSetId: 'facts', columns: defaultFactColumns(), rows: [],
    view: { selectedRowIds: [], density: 'auto' }, revision: 0, updatedAt: new Date().toISOString(),
  })
}

export function deconstructionResultToShotTable(
  table: DeconstructionShotTableDocument,
  result: DeconstructionResult,
): DeconstructionShotTableDocument {
  return deconstructionShotTableSchema.parse({
    ...table,
    source: { ...table.source, status: 'ready', durationSeconds: result.durationSeconds, failedShotIndexes: result.failedShotIndexes, errorMessage: undefined },
    rows: result.shots.map((shot) => ({
      rowId: `fact-${shot.index}`, order: shot.index,
      startSeconds: shot.startSeconds, endSeconds: shot.endSeconds, durationSeconds: shot.durationSeconds,
      carriedOver: shot.carriedOver, visionFailed: shot.visionFailed,
      ...(shot.sourceFrameUrl.startsWith('nomi-local://') ? { keyframeRef: shot.sourceFrameUrl } : {}),
      cells: {
        shotSize: shot.shotSize, motion: shot.motionPrompt, visual: shot.visual,
        dialogue: shot.dialogue, onScreenText: shot.onScreenText, mood: shot.mood,
        ...Object.fromEntries(table.columns.filter((column) => column.kind === 'custom')
          .map((column) => [column.columnId, shot.custom[column.columnId] ?? shot.custom[column.labelKey] ?? ''])),
      },
      imagePrompt: shot.imagePrompt, motionPrompt: shot.motionPrompt,
    })),
    revision: table.revision + 1,
    updatedAt: new Date().toISOString(),
  })
}
