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

  // D-1117-delete-verification：任务条只说正在跑的格式任务。结束了的（失败的也算）不再挂卡——
  // 模型缺不缺请求格式它自己那一行写着「待设置」，结束了的任务从模型详情的「查看问题」打开。
  it('keeps finished tasks off the strip, failed ones included', () => {
    const recent = run('recent', 'timed_out', '2026-08-15T11:00:00.000Z')
    const old = run('old', 'cancelled', '2026-08-12T00:00:00.000Z')
    const failed = run('failed', 'failed', '2026-08-15T12:00:00.000Z')

    expect(visibleAdapterRuns([old, recent, failed])).toEqual([])
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


// 「这条失败已经过时了吗」只剩 AI 接入那一节在用（结束了的接入会话不再挂旧失败）；
// 规则本身不变：同一条连接（含晋级后的新身份）上这个模型现在能用了，或之后又跑通了，失败就过时。
describe('adapterFailureIsObsolete follows current model truth', () => {
 it('retires a failure after a newer success for the same model, including after manual disablement', () => {
  const failure = run('failed', 'failed', '2026-08-15T10:00:00.000Z')
  const success = run('succeeded', 'completed', '2026-08-15T11:00:00.000Z')
  expect(adapterFailureIsObsolete(failure, [], [failure, success])).toBe(true)
 })
 it('retires currently usable models, but never hides an unrelated model failure', () => {
  const failure = run('failed', 'failed', '2026-08-15T10:00:00.000Z')
  const model = {vendorKey: 'example', modelKey: 'model-1', enabled: true, kind: 'text', labelZh: 'Text', availability: {usable: true}} as const
  expect(adapterFailureIsObsolete(failure, [model])).toBe(true)
  expect(adapterFailureIsObsolete(failure, [{...model, modelKey: 'other'}])).toBe(false)
 })
 // Shape replayed from the real failed-candidate → successful-candidate window journey.
 it('retires a failed candidate after the same connection succeeds under a new candidate id', () => {
  const failed = {...run('old-candidate', 'failed', '2026-11-16T17:59:50Z'), vendorKey: 'relay--candidate-old', sourceVendorKey: 'relay'}
  const succeeded = {...run('new-candidate', 'completed', '2026-11-16T18:00:01Z'), vendorKey: 'relay--candidate-new', sourceVendorKey: 'relay'}
  expect(adapterFailureIsObsolete(failed, [], [failed, succeeded])).toBe(true)
  const other = {...succeeded, sourceVendorKey: 'another-connection'}
  expect(adapterFailureIsObsolete(failed, [], [failed, other])).toBe(false)
 })
 it('uses current availability in the declared connection lineage without conflating unrelated connections', () => {
  const failed = {...run('failed', 'failed', '2026-11-16T17:59:50Z'), vendorKey: 'relay--candidate-old', sourceVendorKey: 'relay'}
  const usable = {vendorKey: 'relay', modelKey: 'model-1', availability: {usable: true}}
  expect(adapterFailureIsObsolete(failed, [usable] as never, [failed])).toBe(true)
  expect(adapterFailureIsObsolete(failed, [{...usable, vendorKey: 'another-connection'}] as never, [failed])).toBe(false)
 })
 it('never conflates sibling connections sharing a builtin root', () => {
  const failed = {...run('failed', 'failed', '2026-11-16T17:59:50Z'), vendorKey: 'apimart--mini', lineageRootVendorKey: 'apimart'}
  const success = {...run('succeeded', 'completed', '2026-11-16T18:00:01Z'), vendorKey: 'apimart--pro', lineageRootVendorKey: 'apimart'}
  expect(adapterFailureIsObsolete(failed, [], [failed, success])).toBe(false)
 })
 // 半批成功：同一批里一个模型跑通、另一个没跑通；之后创作者手动停用跑通的那个——停用不是新的失败。
 it('a model that passed inside a partial batch retires its older failure even after manual disablement', () => {
  const verified = { taskKind: 'image', state: 'verified' as const, attempts: 1 }
  const failedMode = { taskKind: 'image', state: 'failed' as const, attempts: 1 }
  const partial = {...run('partial', 'partial', '2026-11-17T10:00:00.000Z'), selectedModelKeys: ['model-1', 'model-2'], models: [
   {modelKey: 'model-1', labelZh: 'One', kind: 'image', modes: [verified]},
   {modelKey: 'model-2', labelZh: 'Two', kind: 'image', modes: [failedMode]},
  ]} as never as DesktopProviderAdapterRun
  const older = {...run('older', 'failed', '2026-11-17T09:00:00.000Z'), selectedModelKeys: ['model-1']}
  const olderTwo = {...run('older-two', 'failed', '2026-11-17T09:00:00.000Z'), selectedModelKeys: ['model-2']}
  expect(adapterFailureIsObsolete(older, [], [older, partial])).toBe(true)
  expect(adapterFailureIsObsolete(olderTwo, [], [olderTwo, partial])).toBe(false)
 })
})
