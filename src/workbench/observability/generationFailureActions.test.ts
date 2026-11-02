import { encodeStructuredErrorMessage } from '../../../electron/vendor/vendorHttp'
import { describe, expect, it } from 'vitest'
import { generationFailureActions } from './generationFailureActions'
import { tagNomiError } from '../../../electron/shared/nomiErrorCodes'

describe('three production pages share failure decisions', () => {
  it.each(['node_generation_in_flight: active', 'production_shot_claimed: in_flight'])('in-flight refusal never offers retry: %s', (message) => {
    const decision = generationFailureActions(encodeStructuredErrorMessage({ code: message.split(':')[0], reason: message.includes('in_flight') ? 'in_flight' : undefined }, message))
    expect(decision.kind).toBe('local-refusal')
    expect(decision.canRetry).toBe(false)
    expect(decision.primary).toBe('view-task')
  })
  it('unknown submission retains the release exit after a refused newer click', () => {
    const decision = generationFailureActions(encodeStructuredErrorMessage({ code: 'production_shot_claimed', reason: 'needs_reconcile' }, 'claimed'), { id: 'refused-newer-click' })
    expect(decision.primary).toBe('reconcile')
    expect(decision.secondary).toBe('release-regenerate')
    expect(decision.canRetry).toBe(false)
  })
  it('retrieval with a real task is free; sync output without a task can be regenerated', () => {
    const raw = tagNomiError('retrieval-download', 'HTTP 403')
    expect(generationFailureActions(raw, { taskId: 'paid-task' }).primary).toBe('open-recoverable')
    expect(generationFailureActions(raw, { id: 'canvas-click' }).canRetry).toBe(true)
    expect(generationFailureActions(raw, { id: 'production-job-1' }).canRetry).toBe(false)
  })
})
