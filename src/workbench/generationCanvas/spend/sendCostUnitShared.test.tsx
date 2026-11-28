// 约价单位只有一份偏好、一个格式化函数（D-1126-sd-cost-unit）：发送键、节点下方「出高清」「重拍样片」、
// 第二次出高清确认框主钮四处都从 sendCostPillText + 发送键那份单位偏好出数，记号都由 SendCostAmount 画。
// 切一次单位，四处一起变；积分带硬币，人民币 / 美元写「≈」、不带硬币。价是钉住的替身（不走真价目）。
import i18n from '../../../i18n'
import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VendorPricePreview } from '../../../../electron/shared/contracts/vendorPricePreview'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { sampleRowOf } from '../model/sampleFacts'
import { sendCostPillText } from './sendCostFormat'
import { resetSendCostUnitForTest, setSendCostUnit, type SendCostUnit } from './sendCostUnitStore'

const HOUR = 3_600_000
const T0 = 1_800_000_000_000
const QUOTE: VendorPricePreview = { usd: 2.16, credits: 21.6, source: 'test-fixture' }
const env = vi.hoisted(() => ({ now: 0 }))

vi.mock('./useNodePricePreview', async (importOriginal) => {
  const priced = { vendorKey: 'apimart', quote: { usd: 2.16, credits: 21.6, source: 'test-fixture' }, pending: false }
  return {
    ...(await importOriginal<typeof import('./useNodePricePreview')>()),
    useNodePricePreview: () => priced,
    usePricePreview: () => priced,
    sampleFinalPriceRequest: () => ({ vendorKey: 'apimart' }),
    readPricePreviewOnce: async () => priced.quote,
  }
})
vi.mock('../../observability/useGenerationFeedback', () => ({ useGenerationFeedbackClockValue: (read: (now: number) => unknown) => read(env.now) }))
vi.mock('../nodes/composerGraphSnapshot', () => ({ useComposerGraph: () => ({ nodes: [], edges: [] }) }))
vi.mock('../nodes/nodeOutsideRows', () => ({ useNodeOutsideRowsHidden: () => false }))
vi.mock('../runner/generationRunController', () => ({ confirmAndRunNode: vi.fn() }))
vi.mock('../nodes/composerRun', () => ({ startGenerationFromComposer: vi.fn() }))

const { useSendCost, sampleFinalCredits } = await import('./useSendCost')
const { ComposerSendButton } = await import('../nodes/ComposerSendButton')
const { NodeSampleRow } = await import('../nodes/sampleRow/NodeSampleRow')
const { SpendConfirmDialog } = await import('./SpendConfirmDialog')
const { confirmGenerationResend, useSpendConfirmStore } = await import('./spendConfirm')

const sampleArchetype = { id: 'seedance-2.5-apimart-sample', modeId: 'text_to_video' }
const sampleNode = {
  id: 'n1', kind: 'video', title: 'v', position: { x: 0, y: 0 }, status: 'success', history: [], runs: [],
  result: {
    id: 's1', type: 'video', url: 'nomi-local://asset/p/s1.mp4', taskId: 'draft-1', model: 'doubao-seedance-2.5-sample', createdAt: T0,
    provenance: { provider: 'apimart', timestamp: T0, params: { extras: { archetype: sampleArchetype, modelKey: 'doubao-seedance-2.5-sample', modelVendor: 'apimart' } } },
  } as unknown as GenerationNodeResult,
  meta: { modelKey: 'doubao-seedance-2.5-sample', modelVendor: 'apimart', archetype: sampleArchetype },
} as GenerationCanvasNode

/** 生成框里那颗发送键：同 NodeGenerationComposer 一样把 useSendCost 的结果原样交给 ComposerSendButton。 */
function SendKey(): React.JSX.Element {
  const cost = useSendCost(sampleNode, { nodes: [], edges: [] }, { idle: true })
  return (
    <ComposerSendButton
      ariaLabel="send"
      onClick={() => undefined}
      cost={cost.description ? { ...cost, description: cost.description } : undefined}
    />
  )
}

/** 一处约价的样子：data-*-unit 那一格里印的字、有没有硬币。 */
function amountAt(html: string, attr: string): { unit: string; text: string; coin: boolean } {
  const open = new RegExp(`<(button|span)[^>]*${attr}="([a-z]+)"[^>]*>`).exec(html)
  if (!open) throw new Error(`没找到 ${attr}`)
  const rest = html.slice(open.index + open[0].length)
  const inner = rest.slice(0, rest.indexOf(`</${open[1]}>`))
  return { unit: open[2], text: inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, ''), coin: /<svg/.test(inner) }
}

async function confirmPrimary(): Promise<{ unit: string; text: string; coin: boolean }> {
  const facts = sampleRowOf(sampleNode)
  if (!facts) throw new Error('样片事实没读出来')
  const price = await sampleFinalCredits(facts.sample, '1080p', i18n.language)
  // 同 generationRunController 第二次出高清那一句：价与单位原样交给确认框。
  const decision = confirmGenerationResend({ resultUnknown: false, kind: 'video', secondSampleFinal: { resolution: '1080p', ...(price ? { credits: price.text, unit: price.unit } : {}) } })
  const server = useSpendConfirmStore.getInitialState()
  const saved = server.pending
  server.pending = useSpendConfirmStore.getState().pending
  try {
    const html = renderToStaticMarkup(<MantineProvider env="test"><SpendConfirmDialog /></MantineProvider>)
    const open = /<span[^>]*data-spend-confirm-credits=""[^>]*>/.exec(html)
    if (!open) throw new Error('确认框主钮上没有价')
    const rest = html.slice(open.index + open[0].length)
    const inner = rest.slice(0, rest.indexOf('</span>'))
    return { unit: price?.unit ?? '', text: inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, ''), coin: /<svg/.test(inner) }
  } finally {
    server.pending = saved
    useSpendConfirmStore.getState().resolvePending(false)
    await decision
  }
}

async function fourPlaces(): Promise<Record<'send' | 'hd' | 'redraft' | 'confirm', { unit: string; text: string; coin: boolean }>> {
  env.now = T0 + HOUR
  const send = amountAt(renderToStaticMarkup(<SendKey />), 'data-send-cost-unit')
  const hd = amountAt(renderToStaticMarkup(<NodeSampleRow node={sampleNode} onFeedback={() => undefined} />), 'data-sample-cost-unit')
  env.now = T0 + 72 * HOUR
  const redraft = amountAt(renderToStaticMarkup(<NodeSampleRow node={sampleNode} onFeedback={() => undefined} />), 'data-sample-cost-unit')
  return { send, hd, redraft, confirm: await confirmPrimary() }
}

beforeEach(() => resetSendCostUnitForTest('credits'))
afterEach(() => resetSendCostUnitForTest('credits'))

describe('约价单位：发送键、出高清、重拍样片、确认框主钮同一份偏好、同一个格式化函数', () => {
  it('切一次单位，四处一起变；积分带硬币，人民币 / 美元写 ≈、不带硬币', async () => {
    const seen: Record<SendCostUnit, Awaited<ReturnType<typeof fourPlaces>>> = {} as never
    for (const unit of ['credits', 'cny', 'usd'] as const) {
      setSendCostUnit(unit)
      seen[unit] = await fourPlaces()
      const expected = sendCostPillText(QUOTE, i18n.language, unit)
      for (const [place, amount] of Object.entries(seen[unit])) {
        expect({ place, ...amount }).toEqual({ place, unit, text: expected, coin: unit === 'credits' })
        if (unit === 'credits') expect(amount.text, place).not.toContain('≈')
        else expect(amount.text.startsWith('≈'), place).toBe(true)
      }
    }
    // 三种单位印出来的字互不相同：四处确实跟着切了，不是碰巧一样。
    expect(new Set([seen.credits.send.text, seen.cny.send.text, seen.usd.send.text]).size).toBe(3)
  })
})
