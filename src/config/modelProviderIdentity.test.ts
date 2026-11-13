import { describe, expect, it } from 'vitest'
import { providerIdentityIcon } from './modelProviderIdentity'

describe('providerIdentityIcon', () => {
  it('uses the bundled brand asset for a known provider', () => {
    expect(providerIdentityIcon('apimart')).toMatchObject({
      kind: 'provider',
      fallback: 'A',
      src: expect.stringContaining('apimart.png'),
    })
  })

  it('uses a stable glyph without inventing a remote favicon for a custom provider', () => {
    expect(providerIdentityIcon('my-private-gateway')).toEqual({ kind: 'provider', fallback: 'M' })
    expect(providerIdentityIcon()).toEqual({ kind: 'provider' })
  })
})
