import { describe, expect, it, vi } from 'vitest'
import { describeGenerationCost, generationCostContextForNode } from './spendConfirm'

const etaBridge = vi.hoisted(() => ({
  generationEtaStats: vi.fn(),
}))

vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ events: etaBridge }),
}))

describe('generation spend ETA copy', () => {
  it('uses historical P50/P90 as an interval', () => {
    const message = describeGenerationCost(2, 'video', {
      vendorKey: 'relay', modelKey: 'video-model',
      etaStats: [{ key: 'relay|video-model|video', vendorKey: 'relay', modelKey: 'video-model', kind: 'video', sampleCount: 4, p50Seconds: 480, p90Seconds: 1020 }],
    })
    expect(message).toContain('16–34')
    expect(message).not.toContain('预计约 1 分钟')
  })

  it('uses a cold-start interval when history is unavailable', () => {
    const message = describeGenerationCost(1, 'video', { vendorKey: 'new', modelKey: 'new-video', etaStats: [] })
    expect(message).toMatch(/预计约 .*–.* 分钟/)
  })

  it('matches history by the model alias used in generation events', () => {
    etaBridge.generationEtaStats.mockReturnValue({ stats: [{
      key: 'relay|video-model|video', vendorKey: 'relay', modelKey: 'video-model', kind: 'video',
      sampleCount: 2, p50Seconds: 120, p90Seconds: 600,
    }] })
    const context = generationCostContextForNode({ meta: {
      modelVendor: 'relay', modelKey: 'canonical-video-id', modelAlias: 'video-model',
    } })

    const message = describeGenerationCost(1, 'video', { ...context, projectId: 'eta-alias-regression' })

    expect(message).toContain('2–10')
    expect(message).not.toMatch(/预计约 5–20 分钟/)
  })
})
