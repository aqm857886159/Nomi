import { describe, expect, it } from 'vitest'
import { FEEDBACK_EXCLUSION_REASONS } from '../../electron/shared/contracts/feedback'
import { DYNAMIC_KEY_PREFIXES } from './i18nDynamicKeyPrefixes'

describe('dynamic i18n prefix declarations', () => {
  it('registers members from the runtime source constant, not a hand-copied list', () => {
    const entry = DYNAMIC_KEY_PREFIXES.find((candidate) => candidate.prefix === 'feedbackReport.manifestWhy')
    expect(entry && 'members' in entry ? entry.members : undefined).toBe(FEEDBACK_EXCLUSION_REASONS)
  })
})
