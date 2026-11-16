import { describe, expect, it } from 'vitest'
import {
  ingestionVisibility,
  minimumLeaseSecondsForMedia,
} from './assetTransportPolicy'
import type { AssetIngestion } from './types'

describe('asset transport policy', () => {
  it('describes visibility and a conservative minimum lease', () => {
    const anonymous: AssetIngestion = { strategy: 'anon-chain', chain: [], accepts: ['video'], visibility: 'public-anonymous', ttlSeconds: 24 * 60 * 60 }
    expect(ingestionVisibility(anonymous)).toBe('public-anonymous')
    expect(minimumLeaseSecondsForMedia('video')).toBeGreaterThan(minimumLeaseSecondsForMedia('image'))
  })
})
