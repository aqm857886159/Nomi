import { describe, expect, it } from 'vitest'
import { createStoryboardShotTable, normalizeShotTableMeta, readShotTable, shotTableDocumentSchema } from './shotTable'

const table = () => createStoryboardShotTable('document-1', 'design-1', '2026-09-10T00:00:00.000Z')

describe('shot table persistence ownership', () => {
  it('round trips only a storyboard reference and view state, with no owned rows', () => {
    const value = table()
    value.view.selectedRowIds = ['shot-3']
    value.view.density = 'compact'
    const restored = readShotTable(JSON.parse(JSON.stringify({ shotTable: value })))
    expect(restored).toEqual(value)
    expect(restored).not.toHaveProperty('rows')
  })

  it('rejects cached production rows at the shared persistence boundary', () => {
    const meta = { shotTable: { ...table(), rows: [{ rowId: 'shot-3' }] } }
    expect(readShotTable(meta)).toBeUndefined()
    expect(() => normalizeShotTableMeta(meta)).toThrow()
    expect(meta.shotTable.rows).toEqual([{ rowId: 'shot-3' }])
  })

  it('rejects missing and future schemas without rewriting the source', () => {
    expect(() => normalizeShotTableMeta(undefined)).toThrow()
    const future = { shotTable: { ...table(), schemaVersion: 2 } }
    expect(() => normalizeShotTableMeta(future)).toThrow()
    expect(future.shotTable.schemaVersion).toBe(2)
  })

  it('keeps fact cells keyed by stable column identity when a column is removed', () => {
    const value = {
      ...table(), source: { kind: 'deconstruction', sourceNodeId: 'video-1', title: 'Reference', status: 'ready' },
      columnSetId: 'facts',
      columns: [{ columnId: 'visual', kind: 'builtin', labelKey: 'visual', order: 2, visible: true }],
      rows: [{ rowId: 'fact-1', order: 1, startSeconds: 0, endSeconds: 3, durationSeconds: 3, carriedOver: false,
        keyframeRef: 'nomi-local://project/frame.png', cells: { removed: 'old', visual: 'A doorway' } }],
    }
    const restored = shotTableDocumentSchema.parse(value)
    expect(restored.rows?.[0].cells.visual).toBe('A doorway')
    expect(shotTableDocumentSchema.safeParse({ ...value, rows: [...value.rows, ...value.rows] }).success).toBe(false)
    expect(shotTableDocumentSchema.safeParse({ ...value, rows: [{ ...value.rows[0], keyframeRef: 'data:image/png;base64,AA==' }] }).success).toBe(false)
  })
})
