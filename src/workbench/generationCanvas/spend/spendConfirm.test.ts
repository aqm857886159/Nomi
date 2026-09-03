import { describe, expect, it } from 'vitest'
import { describeGenerationCost } from './spendConfirm'

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
})
