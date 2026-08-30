import { describe, expect, it } from 'vitest'
import { GROUP_VISUAL_CLASS } from './groupVisualContract'

describe('group visual contract', () => {
  it('keeps persistent group chrome neutral across every projection', () => {
    const groupClasses = Object.values(GROUP_VISUAL_CLASS).join(' ')
    expect(groupClasses).toContain('border-nomi-line')
    expect(groupClasses).toContain('bg-nomi-paper')
    expect(groupClasses).toContain('text-nomi-ink')
    expect(groupClasses).not.toContain('nomi-accent')
    expect(groupClasses).not.toContain('purple')
    expect(groupClasses).not.toContain('violet')
  })
})
