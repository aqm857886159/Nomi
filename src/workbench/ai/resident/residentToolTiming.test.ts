import { describe, expect, it } from 'vitest'
import { formatResidentToolElapsed, residentToolElapsedMs } from './residentToolTiming'

describe('resident tool timing', () => {
  it('derives a terminal duration from Host timestamps', () => {
    expect(residentToolElapsedMs('done', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:05.250Z', 0)).toBe(5250)
    expect(formatResidentToolElapsed(5250)).toBe('5s')
    expect(formatResidentToolElapsed(65_000)).toBe('1:05')
  })

  it('keeps a live operation duration moving without changing Host state', () => {
    expect(residentToolElapsedMs('running', '2026-08-31T00:00:00.000Z', undefined, Date.parse('2026-08-31T00:00:01.200Z'))).toBe(1200)
    expect(formatResidentToolElapsed(350)).toBe('<1s')
  })

  it('returns no misleading duration for malformed timestamps', () => {
    expect(residentToolElapsedMs('done', 'not-a-date', '2026-08-31T00:00:05.250Z')).toBeUndefined()
    expect(formatResidentToolElapsed(undefined)).toBe('')
  })
})
