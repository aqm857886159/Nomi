import { describe, expect, it } from 'vitest'
import type { DesktopProviderAdapterRun } from '../../desktop/bridge'
import { adapterFailureIsObsolete, adapterRunsRequiringCatalogRefresh, mergeAdapterRuns, visibleAdapterRuns } from './adapterTaskVisibility'

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
    const active = run('active', 'compiling', '2026-08-01T00:00:00.000Z')
    const oldCompleted = run('old', 'completed', '2026-08-01T00:00:00.000Z')

    expect(visibleAdapterRuns([oldCompleted, active]).map((item) => item.id)).toEqual(['active'])
  })

  it('retains unresolved failures regardless of their age', () => {
    const recent = run('recent', 'timed_out', '2026-08-15T11:00:00.000Z')
    const old = run('old', 'cancelled', '2026-08-12T00:00:00.000Z')

    expect(visibleAdapterRuns([old, recent]).map((item) => item.id)).toEqual(['recent', 'old'])
  })

  it('never hides active work behind the terminal history limit', () => {
    const active = Array.from({ length: 5 }, (_, index) =>
      run(`active-${index}`, 'testing', `2026-08-15T11:0${index}:00.000Z`),
    )
    const terminal = Array.from({ length: 6 }, (_, index) =>
      run(`done-${index}`, 'completed', `2026-08-15T10:0${index}:00.000Z`),
    )

    const visible = visibleAdapterRuns([...terminal, ...active])

    expect(visible.filter((item) => !isAdapterRunTerminalForTest(item.stage))).toHaveLength(5)
    expect(visible.filter((item) => isAdapterRunTerminalForTest(item.stage))).toHaveLength(0)
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


describe('failures follow current model truth', () => {
 it('retires a failure after a newer success for the same model, including after manual disablement', () => {
  const failure = run('failed', 'failed', '2026-08-15T10:00:00.000Z');
  const success = run('succeeded', 'completed', '2026-08-15T11:00:00.000Z');
  expect(visibleAdapterRuns([failure, success])).toEqual([]);
 });
 it('retires currently usable models, but never hides an unrelated model failure', () => {
  const failure = run('failed', 'failed', '2026-08-15T10:00:00.000Z');
  const model = {vendorKey: 'example', modelKey: 'model-1', enabled: true, kind: 'text', labelZh: 'Text', availability: {usable: true}} as const;
  expect(visibleAdapterRuns([failure], [model])).toEqual([]);
  expect(adapterFailureIsObsolete(failure, [{...model, modelKey: 'other'}])).toBe(false);
 });
});


it('retires only the recovered model inside a mixed failed batch', () => {
 const failure = {...run('mixed', 'failed', '2026-08-15T10:00:00.000Z'), selectedModelKeys:['model-1','model-2'], models:[
  {modelKey:'model-1',labelZh:'One',kind:'image' as const,modes:[]},
  {modelKey:'model-2',labelZh:'Two',kind:'image' as const,modes:[]},
 ]};
 const current = {vendorKey:'example',modelKey:'model-1',enabled:true,kind:'image',labelZh:'One',availability:{usable:true}} as const;
 const visible = visibleAdapterRuns([failure],[current]);
 expect(visible[0].selectedModelKeys).toEqual(['model-2']);
 expect(visible[0].models.map(model=>model.modelKey)).toEqual(['model-2']);
 expect(failure.selectedModelKeys).toEqual(['model-1','model-2']);
});

// Shape replayed from the real failed-candidate → successful-candidate window journey.
it('retires a failed candidate after the same connection succeeds under a new candidate id', () => {
 const failed = {...run('old-candidate', 'failed', '2026-11-16T17:59:50Z'), vendorKey: 'relay--candidate-old', sourceVendorKey: 'relay'};
 const succeeded = {...run('new-candidate', 'completed', '2026-11-16T18:00:01Z'), vendorKey: 'relay--candidate-new', sourceVendorKey: 'relay'};
 expect(visibleAdapterRuns([failed, succeeded])).toEqual([]);
 const other = {...succeeded, sourceVendorKey: 'another-connection'};
 expect(visibleAdapterRuns([failed, other]).map(item => item.id)).toEqual(['old-candidate']);
});
it('uses current availability in the declared connection lineage without conflating unrelated connections', () => {
 const failed = {...run('failed', 'failed', '2026-11-16T17:59:50Z'), vendorKey: 'relay--candidate-old', sourceVendorKey: 'relay'};
 const usable = {vendorKey: 'relay', modelKey: 'model-1', availability: {usable: true}};
 expect(visibleAdapterRuns([failed], [usable] as never)).toEqual([]);
 expect(visibleAdapterRuns([failed], [{...usable, vendorKey:'another-connection'}] as never)).toEqual([failed]);
});

it('never conflates sibling connections sharing a builtin root or hides disabled verified models', () => {
 const failed = {...run('failed', 'failed', '2026-11-16T17:59:50Z'), vendorKey: 'apimart--mini', lineageRootVendorKey: 'apimart'};
 const success = {...run('succeeded', 'completed', '2026-11-16T18:00:01Z'), vendorKey: 'apimart--pro', lineageRootVendorKey: 'apimart'};
 expect(visibleAdapterRuns([failed, success])).toEqual([failed]);
 expect(visibleAdapterRuns([failed], [{vendorKey:failed.vendorKey, modelKey:'model-1', adapterState:'verified', enabled:false, availability:{usable:false}}] as never)).toEqual([failed]);
});
