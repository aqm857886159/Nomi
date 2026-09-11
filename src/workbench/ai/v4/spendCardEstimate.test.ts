// 本地重算（2026-09-11 P1.1b）：改一个 chip，价格行当场跟着动，而且和主进程报的是同一个数。
import { describe, expect, it } from 'vitest'
import type { PendingSpendConfirm, PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import type { ModelOption } from '../../../config/models'
import { EMPTY_SPEND_DRAFT, draftAfterNodeEdit, type SpendDraft } from './spendCardDraft'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { priceDisagreements, pricingResolverFromModelOptions, repricePendingSpend } from './spendCardEstimate'

const OPTIONS: ModelOption[] = [
  {
    value: 'gpt-image-2', label: 'GPT Image 2', vendor: 'apimart', modelKey: 'gpt-image-2',
    pricing: { cost: 0.3, enabled: true, specCosts: [{ specKey: 'size:1536x1024', cost: 0.2, enabled: true }] },
  },
  {
    value: 'seedream', label: 'Seedream', vendor: 'apimart', modelKey: 'seedream',
    pricing: { cost: 1.1, enabled: true, specCosts: [] },
  },
  { value: 'unpriced', label: '没配价目的', vendor: 'apimart', modelKey: 'unpriced' },
]

function shot(id: string, overrides: Partial<PendingSpendShot> = {}): PendingSpendShot {
  return {
    shotId: id, nodeId: `node-${id}`, index: 1, prompt: '六棱柱',
    providerId: 'apimart', modelId: 'gpt-image-2',
    parameters: { size: '1024x1024' }, price: { known: true, amount: 0.3 },
    ...overrides,
  }
}

function pending(shots: PendingSpendShot[]): PendingSpendConfirm {
  return {
    projectId: 'p', runId: 'r', operationId: 'op', planVersion: 1, candidateRevision: 1, currency: 'CNY',
    shots, knownSubtotal: shots.reduce((sum, entry) => (entry.price.known ? sum + entry.price.amount : sum), 0),
    unknownShotCount: shots.filter((entry) => !entry.price.known).length,
  }
}

function editedTo(base: PendingSpendShot, meta: Record<string, unknown>, scope: 'each' | 'all' = 'each'): SpendDraft {
  const node = { id: base.nodeId!, kind: 'image', position: { x: 0, y: 0 }, prompt: base.prompt, meta } as unknown as GenerationCanvasNode
  return draftAfterNodeEdit(EMPTY_SPEND_DRAFT, base, node, scope)
}

describe('spendCardEstimate', () => {
  const resolve = pricingResolverFromModelOptions(OPTIONS)

  it('没改动时本地重算与宿主报价逐分相同', () => {
    const source = pending([shot('a')])
    const repriced = repricePendingSpend(source, EMPTY_SPEND_DRAFT, resolve)
    expect(repriced.knownSubtotal).toBe(0.3)
    expect(priceDisagreements(repriced, source)).toEqual([])
  })

  it('改一个带加价的参数 → 价格当场变（基价 + 规格加价，和主进程同一条算式）', () => {
    const base = shot('a')
    const draft = editedTo(base, { modelKey: 'gpt-image-2', modelVendor: 'apimart', size: '1536x1024' })
    const repriced = repricePendingSpend(pending([base]), draft, resolve)
    expect(repriced.shots[0].price).toEqual({ known: true, amount: 0.5 })
    expect(repriced.knownSubtotal).toBe(0.5)
  })

  it('换模型 → 价格跟着那一行的价目走', () => {
    const base = shot('a')
    const draft = editedTo(base, { modelKey: 'seedream', modelVendor: 'apimart', size: '1024x1024' })
    const repriced = repricePendingSpend(pending([base]), draft, resolve)
    expect(repriced.shots[0]).toMatchObject({ modelId: 'seedream', price: { known: true, amount: 1.1 } })
  })

  it('换到没配价目的模型 → 诚实报「算不出」，绝不落成 0', () => {
    const base = shot('a')
    const draft = editedTo(base, { modelKey: 'unpriced', modelVendor: 'apimart', size: '1024x1024' })
    const repriced = repricePendingSpend(pending([base]), draft, resolve)
    expect(repriced.shots[0].price).toEqual({ known: false })
    expect(repriced.unknownShotCount).toBe(1)
    expect(repriced.knownSubtotal).toBe(0)
  })

  it('「全部」模式改一个参数 → 每一镜都重算，合计按镜累加', () => {
    const first = shot('a')
    const second = shot('b', { index: 2 })
    const draft = editedTo(first, { modelKey: 'gpt-image-2', modelVendor: 'apimart', size: '1536x1024' }, 'all')
    const repriced = repricePendingSpend(pending([first, second]), draft, resolve)
    expect(repriced.shots.map((entry) => entry.price)).toEqual([
      { known: true, amount: 0.5 }, { known: true, amount: 0.5 },
    ])
    expect(repriced.knownSubtotal).toBe(1)
  })

  it('目录还没加载出来时原样用宿主那一份（本地缺目录不许把已知价抹成未知）', () => {
    const source = pending([shot('a')])
    expect(repricePendingSpend(source, EMPTY_SPEND_DRAFT, undefined)).toBe(source)
    const blind = pricingResolverFromModelOptions([])
    expect(repricePendingSpend(source, EMPTY_SPEND_DRAFT, blind).shots[0].price).toEqual({ known: true, amount: 0.3 })
  })

  it('本地估算与正式报价对不上时说得出差在哪一镜、差多少', () => {
    const local = pending([shot('a', { price: { known: true, amount: 0.5 } }), shot('b', { index: 2 })])
    const authoritative = pending([shot('a', { price: { known: true, amount: 0.55 } }), shot('b', { index: 2 })])
    expect(priceDisagreements(local, authoritative)).toEqual([{ shotId: 'a', local: 0.5, authoritative: 0.55 }])
  })
})
