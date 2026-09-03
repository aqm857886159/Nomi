import { describe, expect, it } from 'vitest'
import type { VendorHealth } from '../../desktop/onboardingBridgeTypes'
import {
  invalidateVendorHealthSnapshots,
  resetVendorHealthSnapshotsForTests,
  seedVendorHealthSnapshotForTests,
  vendorHealthSnapshotForTests,
} from './useVendorHealth'

const errorHealth: VendorHealth = { state: 'unreachable', reason: 'old error', checkedAt: 1 }

describe('vendor health snapshot invalidation', () => {
  it('clears the affected vendor after a catalog mutation', () => {
    seedVendorHealthSnapshotForTests('custom|https://relay.test', errorHealth)
    seedVendorHealthSnapshotForTests('other|https://other.test', errorHealth)
    invalidateVendorHealthSnapshots('custom')
    expect(vendorHealthSnapshotForTests('custom|https://relay.test')).toBeUndefined()
    expect(vendorHealthSnapshotForTests('other|https://other.test')).toEqual(errorHealth)
    resetVendorHealthSnapshotsForTests()
  })

  it('clears all snapshots for a session restart boundary', () => {
    seedVendorHealthSnapshotForTests('custom|https://relay.test', errorHealth)
    invalidateVendorHealthSnapshots()
    expect(vendorHealthSnapshotForTests('custom|https://relay.test')).toBeUndefined()
  })
})
