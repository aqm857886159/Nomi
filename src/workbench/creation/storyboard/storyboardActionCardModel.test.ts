import { describe, expect, it } from 'vitest'
import { storyboardActionMode } from './storyboardActionCardModel'

describe('storyboard action card', () => {
  it('uses a single image-first planning default; shot type is chosen later per shot', () => {
    expect(storyboardActionMode()).toBe('image')
  })
})
