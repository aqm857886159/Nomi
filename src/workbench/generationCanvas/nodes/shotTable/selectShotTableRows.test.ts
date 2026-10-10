import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import i18n from '../../../../i18n'
import { selectShotTableRows } from './selectShotTableRows'
import { shotTableDocumentSchema } from '../../../../../electron/shared/canvas/shotTable'

describe('shot table read-through view', () => {
  // 精度归 electron/shared/canvas/shotTime.ts 管。这一层只搬数字：搬之前是什么样，搬之后就是什么样。
  it('passes the owner-quantized deconstruction seconds through without touching them', () => {
    const facts = shotTableDocumentSchema.parse({
      schemaVersion: 1, view: { selectedRowIds: [], density: 'auto' }, revision: 0, updatedAt: '2026-09-15T00:00:00.000Z',
      source: { kind: 'deconstruction', sourceNodeId: 'video-1', title: 'Reference', status: 'ready' },
      columnSetId: 'facts', columns: [{ columnId: 'visual', kind: 'builtin', labelKey: 'visual', order: 0, visible: true }],
      rows: [{ rowId: 'fact-1', order: 1, startSeconds: 1.468126, endSeconds: 3.903333,
        durationSeconds: 2.435207, carriedOver: false, cells: { visual: 'A doorway' } }],
    })
    const rows = selectShotTableRows(facts)
    expect(rows.map((row) => [row.start, row.end, row.duration])).toEqual([[1.5, 3.9, 2.4]])
    // 用户真正看到的那一串：ShotTableGrid.tsx:41 就是这两条文案的唯一消费者。
    expect(i18n.t('shotTable.timeRange', { start: rows[0].start, end: rows[0].end })).toBe('1.5–3.9s')
    expect(i18n.t('shotTable.duration', { duration: rows[0].duration })).toBe('2.4s')
  })

  // 响的检测器，防「每个显示处各写一遍 toFixed」那一族回归（P1：精度只有一个 owner）。
  it('keeps the shot table display layer free of its own rounding', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    for (const file of ['ShotTableGrid.tsx', 'selectShotTableRows.ts']) {
      const source = readFileSync(path.join(here, file), 'utf8')
      expect(source, `${file} must not round shot times itself`).not.toMatch(/toFixed|Math\.round|toPrecision/)
    }
  })
})
