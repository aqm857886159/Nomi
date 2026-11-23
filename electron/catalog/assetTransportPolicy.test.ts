import { describe, expect, it } from 'vitest'
import {
  ingestionVisibility,
} from './assetTransportPolicy'
import type { AssetIngestion } from './types'

describe('asset transport policy', () => {
  it('describes visibility', () => {
    const anonymous: AssetIngestion = { strategy: 'anon-chain', chain: [], accepts: ['video'], visibility: 'public-anonymous', ttlSeconds: 24 * 60 * 60 }
    expect(ingestionVisibility(anonymous)).toBe('public-anonymous')
  })
})
