import { describe, expect, it, vi } from 'vitest'
import { describeGenerationCost, generationCostContextForNode } from './spendConfirm'

const etaBridge = vi.hoisted(() => ({
  generationEtaStats: vi.fn(),
}))

vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ events: etaBridge }),
}))

vi.mock('../../../desktop/activeProject', () => ({
  getDesktopActiveProjectId: () => 'eta-context-project',
}))

describe('generation spend ETA copy', () => {
  it('uses the selected concurrency within each serial dependency wave', () => {
    const parallel = describeGenerationCost(6, 'video', { concurrency: 6, waveSizes: [6], etaStats: [] })
    const dependent = describeGenerationCost(6, 'video', { concurrency: 6, waveSizes: [1, 5], etaStats: [] })
    expect(parallel).toContain('5–20')
    expect(dependent).toContain('10–40')
  })
  it('uses historical P50/P90 with an explicit serial preference', () => {
    const message = describeGenerationCost(2, 'video', {
      vendorKey: 'relay', modelKey: 'video-model', concurrency: 1,
      etaStats: [{ key: 'relay|video-model|video', vendorKey: 'relay', modelKey: 'video-model', kind: 'video', sampleCount: 4, p50Seconds: 480, p90Seconds: 1020 }],
    })
    expect(message).toContain('16–34')
    expect(message).not.toContain('预计约 1 分钟')
  })

  it('auto admits the whole independent wave without an invented serial ETA', () => {
    const one = describeGenerationCost(1, 'video', { etaStats: [] })
    const many = describeGenerationCost(8, 'video', { etaStats: [] })
    expect(one).toContain('5–20')
    expect(many).toContain('5–20')
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

    const message = describeGenerationCost(1, 'video', context)

    expect(context.projectId).toBe('eta-context-project')
    expect(etaBridge.generationEtaStats).toHaveBeenCalledWith('eta-context-project')
    expect(message).toContain('2–10')
    expect(message).not.toMatch(/预计约 5–20 分钟/)
  })
})
