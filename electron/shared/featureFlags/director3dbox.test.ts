import { describe, expect, it } from 'vitest'
import { resolveDirector3DBoxFlag } from './director3dbox'

describe('director3dbox bootstrap flag', () => {
  it('allows development opt-in but never uses env in packaged mode', () => {
    expect(resolveDirector3DBoxFlag({ NOMI_DESKTOP_DEV: '1', NOMI_DIRECTOR_3DBOX: 'true' }).enabled).toBe(true)
    expect(resolveDirector3DBoxFlag({ NODE_ENV: 'production', NOMI_DIRECTOR_3DBOX: 'true' }, false).enabled).toBe(false)
    expect(resolveDirector3DBoxFlag({ NODE_ENV: 'production', NOMI_DIRECTOR_3DBOX: 'false' }, true).enabled).toBe(true)
  })

  it('always exposes a stable expiry-bound fingerprint', () => {
    const flag = resolveDirector3DBoxFlag({ NOMI_DESKTOP_DEV: '1', NOMI_DIRECTOR_3DBOX: 'false' })
    expect(flag.fingerprint).toBe('director3dbox:off:2026-11-15')
    expect(flag.expiresOn).toBe('2026-11-15')
  })
})
