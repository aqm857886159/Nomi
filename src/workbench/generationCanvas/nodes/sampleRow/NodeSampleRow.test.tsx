// 节点下方样片行各态（板 2026-11-26-sample-mode：sample.below-row / sample.expiry-warning / sample.expired / sample.hd-running /
// sample.hd-failure / sample.price-unknown）。行在不在、写什么只读样片事实；价只是显示。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult, GenerationNodeRunRecord } from '../../model/generationCanvasTypes'
import type { SendCost } from '../../spend/useSendCost'

const HOUR = 3_600_000
const T0 = 1_800_000_000_000
const env = vi.hoisted(() => ({ now: 0, cost: {} as SendCost }))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => (options ? `${key}${JSON.stringify(options)}` : key) }),
}))
vi.mock('../../../observability/useGenerationFeedback', () => ({ useGenerationFeedbackClockValue: (read: (now: number) => unknown) => read(env.now) }))
vi.mock('../../spend/useSendCost', () => ({ useSampleFinalCost: () => env.cost, useSendCost: () => env.cost }))
vi.mock('../composerGraphSnapshot', () => ({ useComposerGraph: () => ({ nodes: [], edges: [] }) }))
vi.mock('../nodeOutsideRows', () => ({ useNodeOutsideRowsHidden: () => false }))
vi.mock('../../runner/generationRunController', () => ({ confirmAndRunNode: vi.fn() }))
vi.mock('../composerRun', () => ({ startGenerationFromComposer: vi.fn() }))

const { NodeSampleRow } = await import('./NodeSampleRow')

const sampleArchetype = { id: 'seedance-2.5-apimart-sample', modeId: 'text_to_video' }

function sampleResult(): GenerationNodeResult {
  return {
    id: 's1', type: 'video', url: 'nomi-local://asset/p/s1.mp4', taskId: 'draft-1', model: 'doubao-seedance-2.5-sample', createdAt: T0,
    provenance: { provider: 'apimart', timestamp: T0, params: { extras: { archetype: sampleArchetype, modelKey: 'doubao-seedance-2.5-sample', modelVendor: 'apimart' } } },
  } as unknown as GenerationNodeResult
}

function node(patch: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id: 'n1', kind: 'video', title: 'v', position: { x: 0, y: 0 }, status: 'success', result: sampleResult(), history: [], runs: [],
    meta: { modelKey: 'doubao-seedance-2.5-sample', modelVendor: 'apimart', archetype: sampleArchetype },
    ...patch,
  } as GenerationCanvasNode
}

const render = (subject: GenerationCanvasNode, props: { readOnly?: boolean } = {}): string =>
  renderToStaticMarkup(<NodeSampleRow node={subject} onFeedback={() => undefined} {...props} />)
/** 一颗按钮键面上的字（去标签）。 */
const buttonText = (html: string): string => (html.match(/<button[\s\S]*?<\/button>/)?.[0] ?? '').replace(/<[^>]*>/g, '')

beforeEach(() => {
  env.now = T0 + HOUR
  env.cost = { credits: '21.6', description: '这次约 21.6 积分（$2.16）。' }
})

describe('这一行在不在：只读样片事实（★9-5 反例）', () => {
  it('普通 2.5 出的 480p、老项目没来历的视频、高清版当前：都没有这一行', () => {
    const plain = { ...sampleResult(), model: 'doubao-seedance-2.5', provenance: { provider: 'apimart', timestamp: T0, params: { extras: { archetype: { id: 'seedance-2.5-apimart', modeId: 'text_to_video' }, resolution: '480p' } } } }
    expect(render(node({ result: plain as unknown as GenerationNodeResult }))).toBe('')
    expect(render(node({ result: { ...sampleResult(), provenance: undefined } }))).toBe('')
    const final = { ...sampleResult(), id: 'f1', taskId: 'final', provenance: { provider: 'apimart', timestamp: T0, params: { extras: { archetype: { ...sampleArchetype, modeId: 'sample-final' }, draft_task_id: 'draft-1', resolution: '1080p' } } } }
    expect(render(node({ result: final as unknown as GenerationNodeResult, history: [sampleResult()] }))).toBe('')
  })
})

describe('样片还在（★9-1 / ★9-2）', () => {
  it('小标写剩几天，右边「出高清 · 价」，读屏名带清晰度', () => {
    const html = render(node())
    expect(html).toContain('data-sample-state="ready"')
    expect(html).toContain('data-sample-expiry="days"')
    expect(html).toContain('generationCommon.sample.expiry.days{&quot;count&quot;:2}')
    expect(html).toContain('aria-label="generationCommon.sample.makeFinalAria{&quot;resolution&quot;:&quot;1080p&quot;}"')
    expect(buttonText(html)).toBe('generationCommon.sample.makeFinal21.6')
    expect(html).not.toContain('data-sample-expiry-warning')
  })

  it('不到 2 小时换提醒色；不到 1 小时按分钟、不出 0', () => {
    env.now = T0 + 72 * HOUR - 30_000
    const html = render(node())
    expect(html).toContain('data-sample-expiry-warning="true"')
    expect(html).toContain('generationCommon.sample.expiry.minutes{&quot;count&quot;:1}')
  })

  it('过期后：「出高清」换成「重拍样片」，不再有出高清钮、不说失败原因', () => {
    env.now = T0 + 72 * HOUR
    const failed: GenerationNodeRunRecord = { id: 'r2', status: 'error', error: 'HTTP 500', startedAt: T0, updatedAt: T0, attempt: { vendorKey: 'apimart', modelKey: 'm', draftTaskId: 'draft-1' } }
    const html = render(node({ runs: [failed] }))
    expect(html).toContain('data-sample-state="expired"')
    expect(html).toContain('data-sample-redraft=""')
    expect(html).not.toContain('data-sample-make-final')
    expect(html).not.toContain('data-sample-final-failure')
  })

  it('过期了、节点已换成别的模型：不画「重拍样片」（发新的走生成框）', () => {
    env.now = T0 + 72 * HOUR
    const html = render(node({ meta: { modelKey: 'doubao-seedance-2.5', modelVendor: 'apimart', archetype: { id: 'seedance-2.5-apimart', modeId: 'text_to_video' } } }))
    expect(html).not.toContain('data-sample-redraft')
    expect(html).toContain('data-sample-expiry="expired"')
  })

  it('只读画布：只说还剩多久，没有花钱的钮', () => {
    expect(render(node(), { readOnly: true })).not.toContain('<button')
  })
})

describe('价估不出（★9-6 反例）', () => {
  it('钮上没有数字、没有 0；悬停那一句是发送键那一句', () => {
    env.cost = { description: '暂时估不出这次用量' }
    const html = render(node())
    expect(buttonText(html)).toBe('generationCommon.sample.makeFinal')
    expect(buttonText(html)).not.toMatch(/\d/)
    expect(html).not.toContain('data-sample-cost')
    expect(html).toContain('aria-description="暂时估不出这次用量"')
  })
})

describe('出高清在路上 / 没成', () => {
  it('在路上：写「高清生成中」，没有钮', () => {
    const html = render(node({ status: 'running', progress: { runId: 'r2', draftTaskId: 'draft-1', updatedAt: T0 } }))
    expect(html).toContain('data-sample-state="final-active"')
    expect(html).toContain('generationCommon.sample.finalInFlight')
    expect(html).not.toContain('<button')
  })

  it('没成：钮还在（点了就重试），下面一行说原因 + 样片还在', () => {
    const failed: GenerationNodeRunRecord = { id: 'r2', status: 'error', error: 'HTTP 500 upstream', startedAt: T0, updatedAt: T0, attempt: { vendorKey: 'apimart', modelKey: 'm', draftTaskId: 'draft-1' } }
    const html = render(node({ runs: [failed] }))
    expect(html).toContain('data-sample-state="final-failed"')
    expect(html).toContain('data-sample-make-final=""')
    expect(html).toContain('data-sample-final-failure=""')
    expect(html).toContain('generationCommon.sample.failed{&quot;reason&quot;:')
  })
})
