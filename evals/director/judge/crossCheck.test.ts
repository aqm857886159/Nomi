import { describe, expect, it } from 'vitest'
import { directionMatches } from './crossCheck'

describe('cross-check vocabulary boundary', () => {
  it('treats Chinese and English motion words as the same direction', () => {
    expect(directionMatches('持续向主体推近', 'push_in')).toBe(true)
    expect(directionMatches('Apparent pull-out / widening', 'pull_out')).toBe(true)
    expect(directionMatches('向右摇摄', 'pan')).toBe(true)
    expect(directionMatches('环绕主体', 'orbit_right')).toBe(true)
  })

  it('does not erase a real direction disagreement', () => {
    expect(directionMatches('向主体推近', 'orbit_right')).toBe(false)
  })
})
