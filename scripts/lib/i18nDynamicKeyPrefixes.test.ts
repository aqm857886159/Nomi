import { describe, expect, it } from 'vitest'
import { DYNAMIC_KEY_PREFIXES } from './i18nDynamicKeyPrefixes'

describe('dynamic i18n prefix declarations', () => {
  it('registers every runtime vendor connection pill label', () => {
    const entry = DYNAMIC_KEY_PREFIXES.find((candidate) => candidate.prefix === 'onboardingProviders.vendorCard.connection')
    expect(entry && 'members' in entry ? entry.members : undefined).toEqual(['reachable', 'unreachable', 'checking', 'saved'])
  })
})
