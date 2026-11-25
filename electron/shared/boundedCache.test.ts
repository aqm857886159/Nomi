import { describe, expect, it, vi } from 'vitest'
import { BoundedCache, createSingleFlightCache } from './boundedCache'

describe('BoundedCache ordering', () => {
  it.each([
    ['access', ['a', 'c']],
    ['write', ['b', 'c']],
    ['fifo', ['b', 'c']],
  ] as const)('uses %s order on reads and evicts at capacity', (order, survivors) => {
    const cache = new BoundedCache<string, number>({ maxEntries: 2, order })
    cache.set('a', 1).set('b', 2)
    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)
    expect([...cache.entries()].map(([key]) => key)).toEqual(survivors)
    expect(cache.size).toBe(2)
  })

  it.each([
    ['fifo', ['b', 'c']],
    ['write', ['a', 'c']],
    ['access', ['a', 'c']],
  ] as const)('uses %s order on updates', (order, survivors) => {
    const cache = new BoundedCache<string, number>({ maxEntries: 2, order })
    cache.set('a', 1).set('b', 2).set('a', 4)
    expect(cache.peek('a')).toBe(4)
    cache.set('c', 3)
    expect([...cache.entries()].map(([key]) => key)).toEqual(survivors)
  })

  it('distinguishes a stored undefined and reports automatic eviction only', () => {
    const onEvict = vi.fn()
    const cache = new BoundedCache<string, undefined>({ maxEntries: 2, order: 'fifo', onEvict })
    cache.set('a', undefined).set('b', undefined)
    expect(cache.has('a')).toBe(true)
    cache.set('c', undefined)
    expect(onEvict).toHaveBeenCalledExactlyOnceWith('a')
    expect(cache.delete('b')).toBe(true)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(onEvict).toHaveBeenCalledTimes(1)
  })

  it('makes room before a write when requested, even for a duplicate at capacity', () => {
    const cache = new BoundedCache<string, number>({ maxEntries: 2, order: 'fifo', evictBeforeSet: true })
    cache.set('a', 1).set('b', 2).set('b', 3)
    expect([...cache.entries()]).toEqual([['b', 3]])
  })

  it('expires exactly at the original deadline and prunes before evicting live values', () => {
    let now = 10
    const cache = new BoundedCache<string, number>({ maxEntries: 2, ttlMs: 100, clock: () => now })
    cache.set('first', 1)
    now = 60
    cache.set('second', 2)
    expect(cache.get('first')).toBe(1)
    now = 110
    cache.set('third', 3)
    expect(cache.get('first')).toBeUndefined()
    expect(cache.get('second')).toBe(2)
    now = 160
    expect(cache.get('second')).toBeUndefined()
    expect(cache.size).toBe(1)
  })
})

describe('createSingleFlightCache', () => {
  it('shares a pending load and retries a rejected load', async () => {
    const failure = new Error('load failed')
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(failure).mockResolvedValue('ok')
    const cache = createSingleFlightCache<string, string>({ maxEntries: 2, ttlMs: 1000 })
    const first = cache.getOrLoad('x', load)
    expect(cache.getOrLoad('x', load)).toBe(first)
    await expect(first).rejects.toBe(failure)
    await expect(cache.getOrLoad('x', load)).resolves.toBe('ok')
    await expect(cache.getOrLoad('x', load)).resolves.toBe('ok')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not remove a newer load when an expired flight later fails', async () => {
    let now = 0
    let finishOld!: (value: null) => void
    const cache = createSingleFlightCache<string, string | null>({
      maxEntries: 2, ttlMs: 10, clock: () => now, cacheResult: value => value !== null,
    })
    const old = cache.getOrLoad('x', () => new Promise(resolve => { finishOld = resolve }))
    await Promise.resolve()
    now = 10
    const load = vi.fn(async () => 'fresh')
    const fresh = cache.getOrLoad('x', load)
    finishOld(null)
    await expect(old).resolves.toBeNull()
    await expect(fresh).resolves.toBe('fresh')
    expect(cache.getOrLoad('x', load)).toBe(fresh)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
