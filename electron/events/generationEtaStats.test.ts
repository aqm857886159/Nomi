import { describe, expect, it } from 'vitest'
import { deriveGenerationEtaStats, generationEtaBucketKey, type EtaSourceEvent } from './generationEtaStats'

function event(type: string, ts: string, payload: Record<string, unknown>): EtaSourceEvent {
  return { type, ts, payload }
}

describe('generation ETA history', () => {
  it('pairs successful vendor calls and derives vendor/model/kind P50/P90 buckets', () => {
    const requested = (runId: string, modelKey = 'video-model') => event('vendor.call.requested', new Date(0).toISOString(), {
      runId, recipe: { vendorKey: 'relay', modelKey, kind: 'text_to_video' },
    })
    const completed = (runId: string, seconds: number, status = 'succeeded') => event('vendor.call.completed', new Date(seconds * 1000).toISOString(), { runId, status })
    const stats = deriveGenerationEtaStats([
      requested('a'), completed('a', 60),
      requested('b'), completed('b', 120),
      requested('c'), completed('c', 600),
      requested('failed'), completed('failed', 300, 'failed'),
      requested('other', 'image-model'), completed('other', 90),
    ])
    const bucket = stats.find((item) => item.key === generationEtaBucketKey('relay', 'video-model', 'video'))
    expect(bucket).toMatchObject({ vendorKey: 'relay', modelKey: 'video-model', kind: 'video', sampleCount: 3, p50Seconds: 120, p90Seconds: 600 })
    expect(stats.some((item) => item.modelKey === 'image-model')).toBe(true)
  })

  it('ignores malformed, negative, unmatched, and non-successful observations', () => {
    expect(deriveGenerationEtaStats([
      event('vendor.call.completed', '2026-01-01T00:00:01.000Z', { runId: 'orphan', status: 'succeeded' }),
      event('vendor.call.requested', 'bad', { runId: 'bad', recipe: { vendorKey: 'v', modelKey: 'm', kind: 'video' } }),
      event('vendor.call.requested', '1970-01-01T00:00:10.000Z', { runId: 'negative', recipe: { vendorKey: 'v', modelKey: 'm', kind: 'video' } }),
      event('vendor.call.completed', '1970-01-01T00:00:09.000Z', { runId: 'negative', status: 'succeeded' }),
    ])).toEqual([])
  })
})
