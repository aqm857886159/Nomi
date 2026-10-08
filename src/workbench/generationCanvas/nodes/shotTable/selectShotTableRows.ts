import type { ShotTableDocument } from '../../../../../electron/shared/canvas/shotTable'

export type ShotTableRowView = {
  id: string
  index: number
  /** 没有时长（静帧）就是 undefined，**不是 0**——「没有」和「零秒」是两件事，挤进一个表示读者就分不开。 */
  duration?: number
  start?: number
  end?: number
  prompt: string
  thumbnail?: string
  cells?: Record<string, string>
  visionFailed?: boolean
}

/** 拆解事实表的行视图（只读）。分镜表 / Agent 分镜表已退役，镜头的行在生成页「列表」里。 */
export function selectShotTableRows(table: ShotTableDocument): ShotTableRowView[] {
  return table.rows.map(row => ({
    id: row.rowId, index: row.order, duration: row.durationSeconds, start: row.startSeconds, end: row.endSeconds,
    prompt: row.cells.visual ?? '', thumbnail: row.keyframeRef,
    cells: row.cells, visionFailed: row.visionFailed,
  }))
}
