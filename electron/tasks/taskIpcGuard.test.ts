import { describe, expect, it } from 'vitest'
import { runTaskIpcGuard } from './taskIpcGuard'
import { parseVendorErrorFromMessage } from '../shared/generationFailure'

describe('runTaskIpcGuard structured task errors', () => {
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
