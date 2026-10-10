import { describe, expect, it } from 'vitest'
import { isRetiredShotTableNode, normalizeShotTableMeta, readShotTable, shotTableDocumentSchema } from './shotTable'

const table = () => ({
  schemaVersion: 1, view: { selectedRowIds: [] as string[], density: 'auto' as 'auto' | 'compact' }, revision: 0, updatedAt: '2026-09-10T00:00:00.000Z',
  source: { kind: 'deconstruction', sourceNodeId: 'video-1', title: 'Reference', status: 'ready' },
  columnSetId: 'facts', columns: [], rows: [],
})

describe('shot table persistence ownership', () => {
  it('round trips a deconstruction table with its view state', () => {
    const value = table()
    value.view.selectedRowIds = ['shot-3']
    value.view.density = 'compact'
    const restored = readShotTable(JSON.parse(JSON.stringify({ shotTable: value })))
    expect(restored).toEqual(value)
  })

  it('rejects malformed rows at the shared persistence boundary', () => {
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

describe('cut coverage survives persistence (2026-09-22)', () => {
  const deconstruction = (extra: Record<string, unknown>) => ({
    ...table(),
    source: { kind: 'deconstruction', sourceNodeId: 'video-1', title: 'Reference', status: 'ready', ...extra },
    columnSetId: 'facts',
    columns: [{ columnId: 'visual', kind: 'builtin', labelKey: 'visual', order: 0, visible: true }],
    rows: [],
  })

  it('round trips the whole coverage block, so a reopened project still knows the table was capped', () => {
    const coverage = {
      detectedCuts: 399, keptCuts: 120, appliedThreshold: 0.2055,
      capped: true, coveredSeconds: 348.1, durationSeconds: 361.081,
    }
    const restored = shotTableDocumentSchema.parse(deconstruction({ cutCoverage: coverage }))
    expect(restored.source).toMatchObject({ cutCoverage: coverage })
  })

  // 2026-09-22 之前落盘的表里没有这一块。读不回来不该让整张表 parse 失败——
  // 那会把一次「缺字段」变成一次「项目打不开」。
  it('still reads tables saved before the field existed', () => {
    const restored = shotTableDocumentSchema.parse(deconstruction({}))
    expect(restored.source).not.toHaveProperty('cutCoverage')
  })

  // 半块覆盖信息比没有更糟：它会让 UI 理直气壮地显示一个错数字。
  it('refuses a partial coverage block instead of filling the gaps itself', () => {
    expect(shotTableDocumentSchema.safeParse(deconstruction({ cutCoverage: { detectedCuts: 399, capped: true } })).success).toBe(false)
    expect(shotTableDocumentSchema.safeParse(deconstruction({ cutCoverage: { detectedCuts: 399, keptCuts: 120, appliedThreshold: 0.2, capped: true, coveredSeconds: 1, durationSeconds: 2, extra: 1 } })).success).toBe(false)
  })
})

describe('shot time precision is owned by the persistence boundary', () => {
  const factsTable = (rows: unknown[], sourceDuration?: number) => ({
    ...table(),
    source: {
      kind: 'deconstruction', sourceNodeId: 'video-1', title: 'Reference', status: 'ready',
      ...(sourceDuration === undefined ? {} : { durationSeconds: sourceDuration }),
    },
    columnSetId: 'facts',
    columns: [{ columnId: 'visual', kind: 'builtin', labelKey: 'visual', order: 0, visible: true }],
    rows,
  })

  // 老项目里已经躺着的长小数：读入口归一，显示层不写任何 round。
  it('normalizes long-decimal rows already saved in a project', () => {
    const legacy = factsTable([
      { rowId: 'fact-1', order: 1, startSeconds: 0, endSeconds: 1.468126,
        durationSeconds: 1.468126, carriedOver: false, cells: {} },
      { rowId: 'fact-2', order: 2, startSeconds: 1.468126, endSeconds: 3.903333,
        durationSeconds: 2.435207, carriedOver: false, cells: {} },
    ], 3.903333)
    const restored = readShotTable({ shotTable: legacy })
    expect(restored?.rows?.map((row) => [row.startSeconds, row.endSeconds, row.durationSeconds]))
      .toEqual([[0, 1.5, 1.5], [1.5, 3.9, 2.4]])
    expect(restored?.source.kind === 'deconstruction' && restored.source.durationSeconds).toBe(3.9)
    // 没有一个数字的字面量还带尾数——这正是用户看到的那一串。
    for (const row of restored?.rows ?? []) {
      for (const value of [row.startSeconds, row.endSeconds, row.durationSeconds]) {
        expect(String(value)).toMatch(/^\d+(\.\d)?$/)
      }
    }
  })

  it('derives duration from the quantized ends instead of trusting a stale cached subtraction', () => {
    const drifted = factsTable([{ rowId: 'fact-1', order: 1, startSeconds: 1.5, endSeconds: 3.9,
      durationSeconds: 99, carriedOver: false, cells: {} }])
    expect(readShotTable({ shotTable: drifted })?.rows?.[0].durationSeconds).toBe(2.4)
  })

  it('heals the saved copy through the normalizing write boundary, and is idempotent', () => {
    const meta = { shotTable: factsTable([{ rowId: 'fact-1', order: 1, startSeconds: 0.04999,
      endSeconds: 2.0500001, durationSeconds: 2.0000101, carriedOver: false, cells: {} }]) }
    const once = normalizeShotTableMeta(meta)
    expect((once.shotTable as { rows: Array<{ startSeconds: number; endSeconds: number }> }).rows[0])
      .toMatchObject({ startSeconds: 0, endSeconds: 2.1, durationSeconds: 2.1 })
    expect(normalizeShotTableMeta(once)).toEqual(once)
  })
})

describe('retired table sources (0.23.1 storyboard / production tables)', () => {
  const retired = (kind: string) => ({ kind: 'shot_table', meta: { shotTable: { schemaVersion: 1, source: { kind }, columnSetId: 'production', view: { selectedRowIds: [], density: 'auto' }, revision: 0, updatedAt: '2026-09-18T00:00:00.000Z' } } })
  it('the current schema no longer reads them, and the owner recognizes them for removal', () => {
    for (const kind of ['storyboard', 'production']) {
      expect(readShotTable(retired(kind).meta)).toBeUndefined()
      expect(isRetiredShotTableNode(retired(kind))).toBe(true)
    }
  })
  it('never flags a live deconstruction table or any other node', () => {
    expect(isRetiredShotTableNode({ kind: 'shot_table', meta: { shotTable: table() } })).toBe(false)
    expect(isRetiredShotTableNode({ kind: 'image', meta: { shotTable: { source: { kind: 'storyboard' } } } })).toBe(false)
  })
})
