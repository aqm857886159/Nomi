import { describe, expect, it } from 'vitest'
import { makeChangeId, parseChangeId } from './changeId'

describe('shared reversible change ids', () => {
  it('uses a versioned prefix that undo can dispatch', () => {
    expect(makeChangeId('canvas', 'prop_123')).toBe('canvas:v1:prop_123')
    expect(makeChangeId('timeline', 'receipt_123')).toBe('timeline:v1:receipt_123')
    expect(parseChangeId('canvas:v1:prop_123')).toEqual({ kind: 'canvas', id: 'prop_123' })
  })

  it('rejects malformed or empty identities', () => {
    expect(parseChangeId('undo-1')).toBeNull()
    expect(() => makeChangeId('canvas', '  ')).toThrow('change_id_invalid')
  })
})
