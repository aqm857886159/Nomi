import { describe, expect, it } from 'vitest'
import { parseDirectorCard } from './cardSchema'

describe('director card schema', () => {
  it('accepts a benchmark card and rejects missing identity', () => {
    expect(parseDirectorCard({ id: 'x', prompt: 'p', scene: {}, actors: [], shots: [] }).id).toBe('x')
    expect(() => parseDirectorCard({ prompt: 'p' })).toThrow()
  })
})
