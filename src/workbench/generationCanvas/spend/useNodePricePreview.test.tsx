/**
 * 约价的时序（设计卡 ★4「加载」「过期」）：真挂钩子（react-reconciler 测试渲染器），计时器是假的、问价的口由测试手动回。
 * - 新价 300 毫秒内回来：键上从旧数直接换成新数，中间不闪成没有数；
 * - 超过 300 毫秒没回来：收成没有数，回来再显示；
 * - 旧响应后到：只采用和当前参数对得上的那一次。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../ai/v4/testReactRenderer'
import type { VendorPricePreview, VendorPriceRequest } from '../../../../electron/shared/contracts/vendorPricePreview'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const harness = vi.hoisted(() => ({
  reads: [] as Array<{ duration: unknown; resolve: (quote: unknown) => void; reject: (error: unknown) => void }>,
}))

vi.mock('../runner/catalogTaskActions', () => ({
  buildCatalogTaskRequest: (node: { prompt?: string; meta?: { duration?: number; vendor?: string } }) => ({
    vendor: node.meta?.vendor ?? 'apimart',
    request: { kind: 'text_to_video', prompt: node.prompt, extras: { modelKey: 'm', archetypeInput: { duration: node.meta?.duration } } },
  }),
}))
vi.mock('../runner/generationReferenceResolver', () => ({ resolveGenerationReferences: () => ({}) }))
vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({
    onboarding: {
      vendorPricePreview: (payload: VendorPriceRequest) => new Promise((resolve, reject) => {
        harness.reads.push({ duration: (payload.request.extras as { archetypeInput: { duration: number } }).archetypeInput.duration, resolve, reject })
      }),
    },
  }),
}))

import { PRICE_DEBOUNCE_MS, PRICE_HOLD_MS, useNodePricePreview } from './useNodePricePreview'

const price = (credits: number): VendorPricePreview => ({ credits, usd: credits / 10, source: 'fake' })
const node = (duration: number, vendor = 'apimart') => ({ id: 'n', kind: 'video', prompt: 'p', meta: { duration, vendor } }) as unknown as GenerationCanvasNode
const graph = { nodes: [], edges: [] }

function mount() {
  const frames: Array<number | null> = []
  function Probe({ target }: { target: GenerationCanvasNode }) {
    const { quote } = useNodePricePreview(target, graph)
    frames.push(quote ? quote.credits : null)
    return null
  }
  const renderer = createReactTestRenderer()
  const flush = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); renderer.flushPassiveEffects() } }
  return {
    frames,
    async show(target: GenerationCanvasNode) { renderer.render(<Probe target={target} />); await flush() },
    async advance(ms: number) { vi.advanceTimersByTime(ms); await flush() },
    async answer(duration: number, quote: VendorPricePreview | null) {
      const index = harness.reads.findIndex(read => read.duration === duration)
      expect(index, 'asked for ' + duration).toBeGreaterThanOrEqual(0)
      harness.reads.splice(index, 1)[0].resolve(quote)
      await flush()
    },
    close: () => renderer.close(),
  }
}

beforeEach(() => {
  harness.reads.length = 0
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  ;(globalThis as { window?: unknown }).window = globalThis
})
afterEach(() => { vi.useRealTimers() })

describe('useNodePricePreview 时序', () => {
  it('新价 300 毫秒内回来：只出现过旧数和新数，中间不闪成没有数', async () => {
    const view = mount()
    await view.show(node(5))
    await view.advance(PRICE_DEBOUNCE_MS)
    await view.answer(5, price(1.95))
    expect(view.frames.at(-1)).toBe(1.95)
    const from = view.frames.length
    await view.show(node(10))
    await view.advance(PRICE_DEBOUNCE_MS)
    await view.advance(50)
    await view.answer(10, price(3.9))
    const during = view.frames.slice(from)
    expect(during.at(-1)).toBe(3.9)
    expect(new Set(during)).toEqual(new Set([1.95, 3.9]))
    view.close()
  })

  it('超过 300 毫秒没回来：收成没有数；回来后显示新数', async () => {
    const view = mount()
    await view.show(node(5))
    await view.advance(PRICE_DEBOUNCE_MS)
    await view.answer(5, price(1.95))
    await view.show(node(10))
    expect(view.frames.at(-1)).toBe(1.95)
    await view.advance(PRICE_HOLD_MS)
    expect(view.frames.at(-1)).toBeNull()
    await view.answer(10, price(3.9))
    expect(view.frames.at(-1)).toBe(3.9)
    view.close()
  })

  it('旧响应后到：最终是当前参数的价', async () => {
    const view = mount()
    await view.show(node(5))
    await view.advance(PRICE_DEBOUNCE_MS)
    await view.show(node(10))
    await view.advance(PRICE_DEBOUNCE_MS)
    await view.answer(10, price(3.9))
    await view.answer(5, price(1.95))
    expect(view.frames.at(-1)).toBe(3.9)
    expect(view.frames).not.toContain(1.95)
    view.close()
  })

  it('连着改只问最后一次；读不到（拒绝）= 没有数', async () => {
    const view = mount()
    await view.show(node(5))
    await view.advance(PRICE_DEBOUNCE_MS / 2)
    await view.show(node(10))
    await view.advance(PRICE_DEBOUNCE_MS)
    expect(harness.reads.map(read => read.duration)).toEqual([10])
    harness.reads.splice(0, 1)[0].reject(new Error('500'))
    await view.advance(0)
    expect(view.frames.at(-1)).toBeNull()
    view.close()
  })

  it('不走公开价的那家：不问价', async () => {
    const view = mount()
    await view.show(node(5, 'kie'))
    await view.advance(PRICE_HOLD_MS)
    expect(harness.reads).toEqual([])
    expect(view.frames.every(frame => frame === null)).toBe(true)
    view.close()
  })
})
