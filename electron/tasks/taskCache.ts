// 带 TTL + LRU 上限的内存缓存 —— 替换 runtime.ts 里裸的无界 Map（多维审计 P0-7）。
// 裸 Map 会让永不被轮询/永远 stuck 的异步任务条目（含敏感数据）永久驻留、无上限。
// 泛型、无领域依赖、可注入 clock 便于测试。Map 兼容的 get/set/delete 接口。
export type TtlLruCacheOptions = {
  maxEntries: number;
  ttlMs: number;
  clock?: () => number;
};

type Entry<V> = { value: V; expiresAt: number };

/** Shared retention for pending task context and completed query delivery. */
export function createTaskCache<V>(): TtlLruCache<V> {
  return new TtlLruCache<V>({ maxEntries: 200, ttlMs: 60 * 60 * 1000 });
}

export class TtlLruCache<V> {
  private readonly map = new Map<string, Entry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(options: TtlLruCacheOptions) {
    this.maxEntries = Math.max(1, options.maxEntries);
    this.ttlMs = options.ttlMs;
    this.clock = options.clock ?? (() => Date.now());
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock()) {
      this.map.delete(key);
      return undefined;
    }
    // 命中刷新最近使用顺序（LRU）。
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.pruneExpired();
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.clock() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  private pruneExpired(): void {
    const now = this.clock();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
  }
}
