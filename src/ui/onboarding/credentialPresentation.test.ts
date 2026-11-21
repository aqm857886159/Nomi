import { describe, expect, it } from 'vitest'
import { resolveCredentialStored } from './credentialPresentation'

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
