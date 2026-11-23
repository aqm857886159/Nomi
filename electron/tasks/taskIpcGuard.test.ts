import { describe, expect, it } from 'vitest'
import { runTaskIpcGuard } from './taskIpcGuard'
import { ApimartGenerationProviderError } from '../capabilityCore/apimartGenerationErrors'
import { VendorRequestError } from '../shared/vendorFailure'
import { decideGenerationFailure, parseVendorErrorFromMessage } from '../shared/generationFailure'

describe('runTaskIpcGuard structured task errors', () => {
  it.each([false, true])('a classified provider failure survives task IPC (wrapped=%s)', async wrapped => {
    const cause = new VendorRequestError('opaque diagnostic', {
      vendorKey: 'fixture', method: 'POST', url: 'https://provider.invalid', upstreamMsg: '',
      category: 'quota', httpStatus: 429, retryable: true,
    })
    const failure = wrapped ? new ApimartGenerationProviderError('adapter failed', { cause }) : cause
    await expect(runTaskIpcGuard({}, async () => { throw failure })).rejects.toSatisfy((error: Error) =>
      decideGenerationFailure({ message: error.message, locale: 'en' }).kind === 'quota')
  })

  it('preserves production shot claim code and reason through the existing IPC marker', async () => {
    const failure = Object.assign(new Error('production_shot_claimed: in_flight'), {
      code: 'production_shot_claimed',
      reason: 'in_flight',
    })
    await expect(runTaskIpcGuard({}, async () => { throw failure })).rejects.toSatisfy((error: Error) => {
      expect(parseVendorErrorFromMessage(error.message)).toMatchObject({ code: 'production_shot_claimed', reason: 'in_flight' })
      return true
    })
  })
})
