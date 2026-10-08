import { describe, expect, it } from 'vitest'
import { resolveCredentialCopy } from './credentialPresentation'

describe('credential presentation follows stored, verified, and published facts', () => {
  it.each([
    [{ credentialMaterialSaved: true, verificationPending: true, curatedModelsPublished: false }, 'offlineTitle', 'offlineHint'],
    [{ credentialMaterialSaved: true, verificationPending: false, curatedModelsPublished: true }, 'publishedTitle', 'publishedHint'],
    [{ credentialMaterialSaved: true, verificationPending: false, curatedModelsPublished: false }, 'pendingTitle', 'pendingHint'],
    [{ credentialMaterialSaved: false, verificationPending: false, curatedModelsPublished: false }, 'savedTitle', 'savedHint'],
  ] as const)('maps %j to the matching bilingual copy keys', (state, title, hint) => {
    expect(resolveCredentialCopy(state)).toEqual({
      titleKey: `onboardingProviders.keyOnly.${title}`,
      hintKey: `onboardingProviders.keyOnly.${hint}`,
    })
  })
})
