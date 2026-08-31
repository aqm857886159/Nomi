import { describe, expect, it } from 'vitest'
import { hideBrokenIdentityImage } from './identityIconUtils'

describe('NomiIdentityIcon image fallback', () => {
  it('reveals the local fallback when a bundled brand asset cannot load', () => {
    const image = { hidden: false } as HTMLImageElement
    hideBrokenIdentityImage(image)
    expect(image.hidden).toBe(true)
  })
})
