import { describe, expect, it } from 'vitest'
import { CertificationIntentKey } from './certificationIntentKey'

describe('CertificationIntentKey', () => {
  it('retransmits a lost response with the same key and creates one canonical run', async () => {
    let serial = 0
    const keys = new CertificationIntentKey(() => `confirmation-${++serial}`)
    const canonicalRuns = new Map<string, string>()
    const main = async (idempotencyKey: string) => {
      const runId = canonicalRuns.get(idempotencyKey) || `run-${canonicalRuns.size + 1}`
      canonicalRuns.set(idempotencyKey, runId)
      return runId
    }
    const intent = {
      action: 'start' as const,
      vendorKey: 'relay',
      models: [{ modelKey: 'image-1', kind: 'image' }],
    }

    const firstKey = keys.for(intent)
    await main(firstKey) // main committed; renderer never receives this response
    const retryKey = keys.for(intent)
    const visibleRun = await main(retryKey)

    expect(retryKey).toBe(firstKey)
    expect(visibleRun).toBe('run-1')
    expect(canonicalRuns).toEqual(new Map([['confirmation-1', 'run-1']]))
  })

  it('rotates only when the immutable contract changes or the caller starts a new operation', () => {
    let serial = 0
    const keys = new CertificationIntentKey(() => `confirmation-${++serial}`)
    const first = keys.for({ action: 'start', vendorKey: 'relay', models: [{ modelKey: 'a', kind: 'image' }] })
    expect(keys.for({ action: 'start', vendorKey: 'relay', models: [{ modelKey: 'a', kind: 'image' }] })).toBe(first)
    expect(keys.for({ action: 'start', vendorKey: 'relay', models: [{ modelKey: 'b', kind: 'video' }] })).not.toBe(first)
    keys.rotate()
    expect(keys.for({ action: 'start', vendorKey: 'relay', models: [{ modelKey: 'b', kind: 'video' }] })).toBe('confirmation-3')
  })
})
