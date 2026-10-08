import { describe, expect, it } from 'vitest'
import { resolveCredentialCopy, resolveCredentialStored } from './credentialPresentation'

describe('credential presentation follows stored, verified, and published facts', () => {
  it.each([
    [{ credentialMaterialSaved: true, verificationPending: true, curatedModelsPublished: false }, 'offlineTitle', 'offlineHint'],
    [{ credentialMaterialSaved: true, verificationPending: false, curatedModelsPublished: true }, 'publishedTitle', 'publishedHint'],
    [{ credentialMaterialSaved: true, verificationPending: false, curatedModelsPublished: false }, 'pendingTitle', 'pendingHint'],
    [{ credentialMaterialSaved: false, verificationPending: false, curatedModelsPublished: false }, 'savedTitle', 'savedHint'],
  ] as const)('maps %j to the matching bilingual copy keys', (state, title, hint) => {
    expect(resolveCredentialCopy(state)).toMatchObject({
      titleKey: `onboardingProviders.keyOnly.${title}`,
      hintKey: `onboardingProviders.keyOnly.${hint}`,
    })
  })
})

describe('"is a key stored" comes from the stored credential, never from the form mode', () => {
  it('replacing a stored key (form open, save rejected) still reports the stored key', () => {
    expect(resolveCredentialStored({ credentialMaterialSaved: true, hasApiKey: false, savedHere: false })).toBe(true)
    expect(resolveCredentialStored({ credentialMaterialSaved: false, hasApiKey: true, savedHere: false })).toBe(true)
  })
  it('a first save that failed stores nothing; a first save that worked does', () => {
    expect(resolveCredentialStored({ credentialMaterialSaved: false, hasApiKey: false, savedHere: false })).toBe(false)
    expect(resolveCredentialStored({ credentialMaterialSaved: false, hasApiKey: false, savedHere: true })).toBe(true)
  })
})

describe('the automatic re-check changes what the card says', () => {
  it('a key that was re-checked online says the key is confirmed and models are not', () => {
    const rechecked = resolveCredentialCopy({ credentialMaterialSaved: true, verificationPending: false, curatedModelsPublished: false, keyRechecked: true })
    expect(rechecked.titleKey).toBe('onboardingProviders.keyOnly.recheckedTitle')
    expect(rechecked.hintKey).toBe('onboardingProviders.keyOnly.recheckedHint')
    expect(rechecked.titleKey).not.toBe(resolveCredentialCopy({ credentialMaterialSaved: true, verificationPending: true, curatedModelsPublished: false }).titleKey)
  })
})
