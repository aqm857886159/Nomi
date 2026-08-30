import { describe, expect, it } from 'vitest'
import type { DesktopProviderAdapterRun } from '../../desktop/bridge'
import { adapterRunsRequiringCatalogRefresh, mergeAdapterRuns, visibleAdapterRuns } from './adapterTaskVisibility'

function run(id: string, stage: DesktopProviderAdapterRun['stage'], updatedAt: string): DesktopProviderAdapterRun {
  return {
    id,
    vendorKey: 'example',
    vendorName: 'Example',
    selectedModelKeys: ['model-1'],
    stage,
    repairAttempt: 0,
    models: [],
    sourceUrls: [],
    createdAt: updatedAt,
    updatedAt,
  }
}

describe('adapter task visibility', () => {
  it('keeps active work recoverable even when its last persisted update is old', () => {
    const now = Date.parse('2026-08-15T12:00:00.000Z')
    const active = run('active', 'compiling', '2026-08-01T00:00:00.000Z')
    const oldCompleted = run('old', 'completed', '2026-08-01T00:00:00.000Z')

    expect(visibleAdapterRuns([oldCompleted, active], now).map((item) => item.id)).toEqual(['active'])
  })

  it('shows recent terminal outcomes but lets old history leave the model home', () => {
    const now = Date.parse('2026-08-15T12:00:00.000Z')
    const recent = run('recent', 'timed_out', '2026-08-15T11:00:00.000Z')
    const old = run('old', 'cancelled', '2026-08-12T00:00:00.000Z')

    expect(visibleAdapterRuns([old, recent], now).map((item) => item.id)).toEqual(['recent'])
  })

  it('never hides active work behind the terminal history limit', () => {
    const now = Date.parse('2026-08-15T12:00:00.000Z')
    const active = Array.from({ length: 5 }, (_, index) =>
      run(`active-${index}`, 'testing', `2026-08-15T11:0${index}:00.000Z`),
    )
    const terminal = Array.from({ length: 6 }, (_, index) =>
      run(`done-${index}`, 'completed', `2026-08-15T10:0${index}:00.000Z`),
    )

    const visible = visibleAdapterRuns([...terminal, ...active], now, 3)

    expect(visible.filter((item) => !isAdapterRunTerminalForTest(item.stage))).toHaveLength(5)
    expect(visible.filter((item) => isAdapterRunTerminalForTest(item.stage))).toHaveLength(3)
  })

  it('replaces a polled snapshot by run id and keeps newest tasks first', () => {
    const previous = run('same', 'compiling', '2026-08-15T10:00:00.000Z')
    const next = run('same', 'testing', '2026-08-15T10:01:00.000Z')
    const newest = run('new', 'queued', '2026-08-15T10:02:00.000Z')

    expect(mergeAdapterRuns([previous], [next, newest]).map((item) => [item.id, item.stage])).toEqual([
      ['new', 'queued'],
      ['same', 'testing'],
    ])
  })

  it('refreshes only for a known nonterminal to terminal transition, not first hydration of history', () => {
    const active = run('same', 'testing', '2026-08-15T10:00:00.000Z')
    const completed = run('same', 'completed', '2026-08-15T10:01:00.000Z')
    const historical = run('history', 'failed', '2026-08-15T09:00:00.000Z')

    expect(adapterRunsRequiringCatalogRefresh([active, historical], [completed, historical]).map((item) => item.id)).toEqual(['same'])
    expect(adapterRunsRequiringCatalogRefresh([], [completed, historical])).toEqual([])
    expect(adapterRunsRequiringCatalogRefresh([completed, historical], [completed, historical])).toEqual([])
  })
})

function isAdapterRunTerminalForTest(stage: DesktopProviderAdapterRun['stage']): boolean {
  return ['completed', 'partial', 'failed', 'needs_ai', 'cancelled', 'timed_out', 'stale'].includes(stage)
}
