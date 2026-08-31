import { describe, expect, it } from 'vitest'

import { resolveKeyOnlySaveOutcome } from './keyOnlyConnectionPolicy'

describe('key-only connection policy', () => {
  it('completes a direct-key connection when the backend enables it', () => {
    expect(resolveKeyOnlySaveOutcome('direct-key', true)).toBe('connected')
  })

  it('keeps certification-owned vendors in verification even if a caller asks to enable them', () => {
    expect(resolveKeyOnlySaveOutcome('certification', true)).toBe('needs-verification')
  })

  it('does not present a direct-key connection as successful when the backend denies enablement', () => {
    expect(resolveKeyOnlySaveOutcome('direct-key', false)).toBe('rejected')
  })
})
