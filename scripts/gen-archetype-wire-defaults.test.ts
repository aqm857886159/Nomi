import { describe, expect, it } from 'vitest'
import { normalizeGeneratedText } from './gen-archetype-wire-defaults'

describe('archetype defaults generation', () => {
  it('treats Windows and POSIX line endings as the same generated content', () => {
    expect(normalizeGeneratedText('first\r\nsecond\r\n')).toBe('first\nsecond\n')
  })
})
