import { describe, expect, it } from 'vitest'
import { shotClaimCopy } from './generationFailure'

describe('shotClaimCopy', () => {
  it('covers every production-owned reason emitted by decideShotClaim', () => {
    expect(shotClaimCopy('queued')).toEqual({ key: 'queued', action: 'view-task' })
    expect(shotClaimCopy('awaiting_confirmation')).toEqual({ key: 'awaitingConfirmation', action: 'view-task' })
    expect(shotClaimCopy('in_flight')).toEqual({ key: 'inFlight', action: 'view-task' })
    expect(shotClaimCopy('needs_reconcile')).toEqual({ key: 'needsReconcile', action: 'reconcile' })
  })

  it('does not silently turn an unregistered reason into queued copy', () => {
    expect(shotClaimCopy('missing_run')).toBeUndefined()
  })
})
