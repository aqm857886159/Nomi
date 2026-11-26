// 样片事实全从结果来历和运行记录现算：是不是样片、还剩多久、出高清在不在路上、没成之后重试发什么。
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult, GenerationNodeRunRecord } from './generationCanvasTypes'
import {
  failedSampleFinalOf,
  finalsMadeFrom,
  isSampleFinalResult,
  sampleExpiry,
  sampleFactsOf,
  sampleFinalRetryOf,
  sampleFinalRunOf,
  sampleRowOf,
  sampleRowOwnsProgress,
} from './sampleFacts'

const HOUR = 3_600_000
const T0 = 1_800_000_000_000

function sampleResult(id = 'sample-1', taskId = 'draft-1', createdAt = T0): GenerationNodeResult {
  return {
    id,
    type: 'video',
    url: `nomi-local://asset/p/${id}.mp4`,
    taskId,
    model: 'doubao-seedance-2.5-sample',
    createdAt,
    provenance: {
      provider: 'apimart',
      timestamp: createdAt,
      params: { extras: { archetype: { id: 'seedance-2.5-apimart-sample', modeId: 'text_to_video' }, modelKey: 'doubao-seedance-2.5-sample', modelVendor: 'apimart', duration: 5 } },
    },
  } as unknown as GenerationNodeResult
}

function finalResult(draftTaskId = 'draft-1', createdAt = T0 + HOUR): GenerationNodeResult {
  return {
    id: `final-${draftTaskId}-${createdAt}`,
    type: 'video',
    url: 'nomi-local://asset/p/final.mp4',
    taskId: 'final-task',
    model: 'doubao-seedance-2.5-sample',
    createdAt,
    provenance: {
      provider: 'apimart',
      timestamp: createdAt,
      params: { extras: { archetype: { id: 'seedance-2.5-apimart-sample', modeId: 'sample-final' }, draft_task_id: draftTaskId, resolution: '1080p' } },
    },
  } as unknown as GenerationNodeResult
}

function plainResult(): GenerationNodeResult {
  return {
    id: 'plain-1',
    type: 'video',
    url: 'nomi-local://asset/p/plain.mp4',
    taskId: 'plain-task',
    model: 'doubao-seedance-2.5',
    createdAt: T0,
    provenance: { provider: 'apimart', timestamp: T0, params: { extras: { archetype: { id: 'seedance-2.5-apimart', modeId: 'text_to_video' }, modelKey: 'doubao-seedance-2.5', resolution: '480p' } } },
  } as unknown as GenerationNodeResult
}

function run(patch: Partial<GenerationNodeRunRecord> & { id: string }): GenerationNodeRunRecord {
  return { status: 'success', startedAt: T0, updatedAt: T0, ...patch }
}

function node(patch: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return { id: 'n1', kind: 'video', title: 'v', position: { x: 0, y: 0 }, status: 'success', result: sampleResult(), history: [], runs: [], ...patch } as GenerationCanvasNode
}

describe('是不是样片：只读结果自己的来历', () => {
  it('样片行出的结果是样片：样片号、发给谁、出片时刻都读得出', () => {
    const facts = sampleFactsOf({ runs: [] }, sampleResult())
    expect(facts).toMatchObject({ draftTaskId: 'draft-1', vendorKey: 'apimart', modelKey: 'doubao-seedance-2.5-sample', createdAt: T0 })
    expect(facts?.archetype.sampleOf.spec).toEqual({ ttlHours: 72, draftResolution: '480p', finalResolutions: ['1080p'] })
  })

  it('反例：普通 2.5 出的 480p、老项目没来历的结果、高清版本身，都不是样片', () => {
    expect(sampleFactsOf({ runs: [] }, plainResult())).toBeNull()
    expect(sampleFactsOf({ runs: [] }, { ...sampleResult(), provenance: undefined } as GenerationNodeResult)).toBeNull()
    expect(sampleFactsOf({ runs: [] }, finalResult())).toBeNull()
    expect(isSampleFinalResult(finalResult())).toBe(true)
    expect(isSampleFinalResult(sampleResult())).toBe(false)
  })

  it('出过几次高清按样片号数，别的样片出的不算', () => {
    const subject = node({ history: [finalResult('draft-1'), finalResult('draft-2')] })
    expect(finalsMadeFrom(subject, 'draft-1')).toHaveLength(1)
  })
})

describe('还剩多久（C-D3）', () => {
  const at = (remaining: number) => sampleExpiry(T0, 72, T0 + 72 * HOUR - remaining)
  it('≥24 小时按天向下取整；1–24 小时按小时向下取整；不到 1 小时按分钟向上取整、不出 0', () => {
    expect(at(72 * HOUR)).toEqual({ kind: 'days', count: 3, warning: false })
    expect(at(24 * HOUR)).toEqual({ kind: 'days', count: 1, warning: false })
    expect(at(24 * HOUR - 1)).toEqual({ kind: 'hours', count: 23, warning: false })
    expect(at(HOUR)).toEqual({ kind: 'hours', count: 1, warning: true })
    expect(at(HOUR - 1)).toEqual({ kind: 'minutes', count: 60, warning: true })
    expect(at(1)).toEqual({ kind: 'minutes', count: 1, warning: true })
  })
  it('不到 2 小时换提醒色；到点就是已过期；档案没写有效期 = 不显示剩余（C-D4）', () => {
    expect(at(2 * HOUR)?.warning).toBe(false)
    expect(at(2 * HOUR - 1)?.warning).toBe(true)
    expect(at(0)).toEqual({ kind: 'expired', warning: false })
    expect(sampleExpiry(T0, undefined, T0)).toBeNull()
  })
})

describe('出高清在路上 / 没成：只认样片号', () => {
  it('准入前只有进度带着样片号：这次是出高清，归节点下方那一行画（遮罩让位）', () => {
    const subject = node({ status: 'running', progress: { runId: 'r2', draftTaskId: 'draft-1', updatedAt: T0 } })
    expect(sampleFinalRunOf(subject)).toEqual({ draftTaskId: 'draft-1', phase: 'active' })
    expect(sampleRowOwnsProgress(subject)).toBe(true)
  })

  it('准入后读运行记录上的样片号', () => {
    const subject = node({ status: 'running', runs: [run({ id: 'r2', status: 'running', attempt: { vendorKey: 'apimart', modelKey: 'doubao-seedance-2.5-sample', draftTaskId: 'draft-1' } })] })
    expect(sampleFinalRunOf(subject)).toEqual({ draftTaskId: 'draft-1', phase: 'active' })
  })

  it('出高清没成之后又照常发了一次（准入前）：这次不是出高清，遮罩照常画', () => {
    const subject = node({
      status: 'running',
      progress: { runId: 'r3', updatedAt: T0 },
      runs: [run({ id: 'r2', status: 'error', error: 'boom', attempt: { vendorKey: 'apimart', modelKey: 'm', draftTaskId: 'draft-1' } })],
    })
    expect(sampleFinalRunOf(subject)).toBeNull()
    expect(sampleRowOwnsProgress(subject)).toBe(false)
  })

  it('最新一次是出高清且没成：行上说原因；更早的出高清失败不算「最新」', () => {
    const failed = run({ id: 'r2', status: 'error', error: 'HTTP 500', attempt: { vendorKey: 'apimart', modelKey: 'm', draftTaskId: 'draft-1' } })
    expect(sampleRowOf(node({ runs: [failed] }))?.run).toEqual({ draftTaskId: 'draft-1', phase: 'failed', error: 'HTTP 500' })
    expect(failedSampleFinalOf([run({ id: 'r3', status: 'error', error: 'x' }), failed])).toBeNull()
  })

  it('别的样片的出高清不挂在这条样片的行上', () => {
    const failed = run({ id: 'r2', status: 'error', error: 'x', attempt: { vendorKey: 'apimart', modelKey: 'm', draftTaskId: 'draft-other' } })
    expect(sampleRowOf(node({ runs: [failed] }))?.run).toBeNull()
  })
})

describe('重试出高清只带样片号和清晰度', () => {
  it('样片还在、没过期：只带样片号 + 1080p', () => {
    expect(sampleFinalRetryOf(node(), 'draft-1', T0 + HOUR)).toEqual({ draftTaskId: 'draft-1', resolution: '1080p' })
  })
  it('样片已不在版本栈 / 已过期：不给重试（如实留着失败，不退回重新出样片）', () => {
    expect(sampleFinalRetryOf(node(), 'draft-gone', T0 + HOUR)).toBeNull()
    expect(sampleFinalRetryOf(node(), 'draft-1', T0 + 72 * HOUR)).toBeNull()
  })
})
