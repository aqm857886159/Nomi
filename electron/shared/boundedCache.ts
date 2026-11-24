import { LRUCache } from 'lru-cache'

type CacheOptions<K> = {
  maxEntries: number
  order?: 'access' | 'write' | 'fifo'
  ttlMs?: number
  clock?: () => number
  /** Make room on every write at capacity, including replacement of an existing key. */
  evictBeforeSet?: boolean
  onEvict?: (key: K) => void
}

type Entry<V> = { value: V; expiresAt: number | undefined }

/** Bounded process-local storage. Entries carry the caller's wall-clock deadline and may hold undefined. */
export class BoundedCache<K extends NonNullable<unknown>, V> {
  private readonly storage: LRUCache<K, Entry<V>>
  private readonly clock: () => number

  constructor(private readonly options: CacheOptions<K>) {
    this.clock = options.clock ?? (() => Date.now())
    this.storage = new LRUCache({
      max: Math.max(1, options.maxEntries),
      dispose: options.onEvict && ((_entry, key, reason) => {
        if (reason === 'evict') options.onEvict?.(key)
      }),
    })
  }

  get size(): number {
    return this.storage.size
  }

  private isExpired(entry: Entry<V>): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= this.clock()
  }

  /** Inspect the stored value for identity checks, even after its deadline. */
  peek(key: K): V | undefined {
    return this.storage.peek(key)?.value
  }

  has(key: K): boolean {
    const entry = this.storage.peek(key)
    return entry !== undefined && !this.isExpired(entry)
  }

  get(key: K): V | undefined {
    const entry = this.storage.peek(key)
    if (!entry) return undefined
    if (this.isExpired(entry)) {
      if (!this.options.evictBeforeSet) this.storage.delete(key)
      return undefined
    }
    if (this.options.order === undefined || this.options.order === 'access') this.storage.get(key)
    return entry.value
  }

  set(key: K, value: V): this {
    const { ttlMs, order, evictBeforeSet } = this.options
    if (evictBeforeSet) {
      if (this.size >= this.storage.max) this.storage.pop()
    } else if (ttlMs !== undefined) {
      const now = this.clock()
      for (const [expiredKey, entry] of this.storage.entries()) {
        if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.storage.delete(expiredKey)
      }
    }
    const expiresAt = ttlMs === undefined ? undefined : this.clock() + ttlMs
    const existing = order === 'fifo' ? this.storage.peek(key) : undefined
    if (existing) {
      existing.value = value
      existing.expiresAt = expiresAt
    } else {
      this.storage.set(key, { value, expiresAt })
    }
    return this
  }

  delete(key: K): boolean {
    return this.storage.delete(key)
  }

  clear(): void {
    this.storage.clear()
  }

  *entries(): IterableIterator<[K, V]> {
    for (const key of this.storage.rkeys()) {
      const entry = this.storage.peek(key)
      if (entry && !this.isExpired(entry)) yield [key, entry.value]
    }
  }

  *values(): IterableIterator<V> {
    for (const [, value] of this.entries()) yield value
  }
}

export function createSingleFlightCache<K extends NonNullable<unknown>, V>(
  { cacheResult, ...options }: CacheOptions<K> & { cacheResult?: (value: V) => boolean },
) {
  const cache = new BoundedCache<K, Promise<V>>(options)
  return {
    getOrLoad(key: K, load: () => Promise<V>): Promise<V> {
      const pending = cache.get(key)
      if (pending) return pending
      const forget = () => {
        if (cache.peek(key) === flight) cache.delete(key)
      }
      const flight = Promise.resolve().then(load).then(value => {
        if (cacheResult && !cacheResult(value)) forget()
        return value
      }).catch(error => {
        forget()
        throw error
      })
      cache.set(key, flight)
      return flight
    },
  }
}
