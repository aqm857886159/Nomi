import { describe, expect, it } from 'vitest'
import { resolveResultStackPlacement } from './nodeResultStackPlacement'

describe('resolveResultStackPlacement', () => {
  it('keeps the preferred right side when the tray fits', () => {
    expect(resolveResultStackPlacement({ leftSpace: 480, rightSpace: 380, requiredSpace: 360 })).toBe('right')
  })

  it('flips left when the right edge collides and the left side fits', () => {
    expect(resolveResultStackPlacement({ leftSpace: 480, rightSpace: 140, requiredSpace: 360 })).toBe('left')
  })

  it('uses the side with more space when neither side fully fits', () => {
    expect(resolveResultStackPlacement({ leftSpace: 260, rightSpace: 180, requiredSpace: 360 })).toBe('left')
    expect(resolveResultStackPlacement({ leftSpace: 180, rightSpace: 260, requiredSpace: 360 })).toBe('right')
  })
})
