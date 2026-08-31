import { describe, expect, it, vi } from 'vitest'
import {
  getLibraryUsage,
  getLibraryUsageVersion,
  markLibraryUsed,
  matchesLibraryQuery,
  normalizeLibraryQuery,
  sortByLibraryUsage,
} from './libraryDiscovery'

describe('library discovery helpers', () => {
  it('normalizes whitespace and case', () => {
    expect(normalizeLibraryQuery('  Sunset  SILHOUETTE ')).toBe('sunset  silhouette')
  })

  it('matches every query term across title, description and tags', () => {
    const item = { title: 'Sunset', description: 'Warm backlight', tags: ['cinematic', 'portrait'] }
    expect(matchesLibraryQuery(item, 'sunset portrait')).toBe(true)
    expect(matchesLibraryQuery(item, 'sunset landscape')).toBe(false)
  })

  it('remembers last use and sorts ties deterministically', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    markLibraryUsed('prompt', 'b', 20)
    markLibraryUsed('prompt', 'a', 30)
    expect(getLibraryUsage('prompt', 'a').lastUsedAt).toBe(30)
    expect(sortByLibraryUsage(
      [{ id: 'b', title: 'Beta' }, { id: 'a', title: 'Alpha' }, { id: 'c', title: 'Gamma' }],
      'prompt',
      (item) => item.id,
    ).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(sortByLibraryUsage(
      [{ id: 'z', title: 'Zulu' }, { id: 'a', title: 'Alpha' }],
      'project',
      (item) => item.id,
    ).map((item) => item.id)).toEqual(['z', 'a'])
    vi.unstubAllGlobals()
  })

  it('treats malformed fallback dates as unused and bounds the recency index', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    expect(sortByLibraryUsage(
      [{ id: 'bad', title: 'Bad', updatedAt: Number.NaN }, { id: 'good', title: 'Good', updatedAt: 10 }],
      'project',
      (item) => item.id,
      (item) => item.updatedAt,
    ).map((item) => item.id)).toEqual(['good', 'bad'])

    for (let index = 0; index < 201; index += 1) markLibraryUsed('asset', `asset-${index}`, index + 1)
    expect(getLibraryUsage('asset', 'asset-0')).toEqual({})
    expect(getLibraryUsage('asset', 'asset-200').lastUsedAt).toBe(201)
    vi.unstubAllGlobals()
  })

  it('ignores malformed persisted entries and rejects empty ids', () => {
    const storage = new Map<string, string>([
      ['nomi:library-discovery:v1', JSON.stringify({
        prompt: {
          good: { lastUsedAt: 42 },
          bad: { lastUsedAt: 'later' },
          negative: { lastUsedAt: -1 },
        },
        unknown: { x: { lastUsedAt: 99 } },
      })],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    expect(getLibraryUsage('prompt', 'good').lastUsedAt).toBe(42)
    expect(getLibraryUsage('prompt', 'bad')).toEqual({})
    expect(getLibraryUsage('prompt', 'negative')).toEqual({})
    const before = getLibraryUsageVersion()
    markLibraryUsed('prompt', '  ')
    expect(getLibraryUsageVersion()).toBe(before)
    vi.unstubAllGlobals()
  })
})
