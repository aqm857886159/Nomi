import { describe, expect, it } from 'vitest'
import { groupColorClass, normalizeGroupColorToken, resolveGroupColor } from './groupColor'

describe('group color (scheme B)', () => {
  it('defaults to neutral grey when nothing was chosen', () => {
    expect(resolveGroupColor(undefined)).toBe('neutral')
    expect(groupColorClass(undefined)).toEqual({ soft: 'bg-nomi-group-neutral-soft', dot: 'bg-nomi-group-neutral' })
  })

  it('only recognises token names; legacy hex values and unknown strings fall back to grey', () => {
    for (const legacy of ['#3b82f6', '#14b8a6', '#EF4444', 'blue', '', '  ']) {
      expect(normalizeGroupColorToken(legacy), legacy).toBeUndefined()
      expect(resolveGroupColor(legacy), legacy).toBe('neutral')
    }
    expect(normalizeGroupColorToken('ocean')).toBe('ocean')
    expect(normalizeGroupColorToken(' Rose ')).toBe('rose')
    // 灰是默认，不落盘。
    expect(normalizeGroupColorToken('neutral')).toBeUndefined()
  })

  it('maps every chosen token to a static soft fill + dot class and never to a border', () => {
    const tokens = ['ocean', 'teal', 'amber', 'coral', 'violet', 'rose'] as const
    for (const token of tokens) {
      const cls = groupColorClass(token)
      expect(cls).toEqual({ soft: `bg-nomi-group-${token}-soft`, dot: `bg-nomi-group-${token}` })
    }
  })
})
