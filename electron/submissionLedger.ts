// 提交幂等台账：把「付费提交」按幂等键 memo 化 —— 同一个键，真正的提交内核【最多执行一次】。
//
// 治「提交瞬间丢回执 → 控制器重试 → 二次下单」残留窗口（详见 docs/plan/2026-06-27-submission-idempotency.md）。
// 控制器无法可靠区分「请求没发出去(可安全重试)」与「发出去了但回执丢了(重试=二次扣费)」，
// 故不靠收窄重试，而靠这里：同键调用重放第一次的 promise（成功 or 失败都重放，绝不重新执行）。
//   · 进行中 → 等同一个 promise（拿到同一个 taskId，渲染层轮询同一个真任务）
//   · 已成功 → 返回同一个结果（连「成功但回执丢了」也找回真任务，无需供应商支持）
//   · 已失败 → 重放同一个 rejection → 绝不二次下单（控制器再重试也是同一个失败）
// 这是【与供应商无关】的完整保证：vendor 是否认 Idempotency-Key 不影响正确性。
//
// 无键则完全不介入（向后兼容 headless/测试路径）——这由调用方判断，本模块只处理「有键」。

type LedgerEntry<T> = {
  readonly promise: Promise<T>
  /** settle 后到点清理的绝对时间戳（ms）；未 settle 前为 null（进行中不过期）。 */
  expiresAt: number | null
}

const DEFAULT_TTL_MS = 5 * 60 * 1000 // settle 后保留 5min：覆盖控制器 ~2s 重试 burst，再清理 bound 内存。

export type DedupeOptions = {
  /** settle 后保留多久（ms）。期间同键重放，过后同键可重新执行。 */
  ttlMs?: number
  /** 注入「现在」便于测试 TTL；默认 Date.now。 */
  now?: () => number
}

/**
 * 按 `key` memo 化提交内核 `fn`。同一个键在「进行中 + settle 后 ttl 内」只执行 fn 一次，
 * 其余同键调用重放同一个 promise（成功/失败都重放）。返回 fn 的结果 promise。
 *
 * 纯模块、无单例：调用方持有一个 ledger Map 注入进来（runtime 持一个进程级 Map）。
 */
export function dedupeSubmission<T>(
  ledger: Map<string, LedgerEntry<T>>,
  key: string,
  fn: () => Promise<T>,
  options: DedupeOptions = {},
): Promise<T> {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS

  const existing = ledger.get(key)
  if (existing) {
    // 进行中(expiresAt=null) → 重放；已 settle 且未过期 → 重放；已过期 → 落到下面重新执行。
    if (existing.expiresAt == null || existing.expiresAt > now()) {
      return existing.promise
    }
    ledger.delete(key)
  }

  // 首次（或过期后重跑）：执行 fn，登记进行中（不过期），settle 后打 TTL 戳。
  const promise = fn()
  const entry: LedgerEntry<T> = { promise, expiresAt: null }
  ledger.set(key, entry)

  const stamp = () => {
    // 仍是同一个 entry 才打戳（防过期重跑后被旧 settle 误伤）。
    if (ledger.get(key) === entry) entry.expiresAt = now() + ttlMs
  }
  promise.then(stamp, stamp)

  return promise
}

// 进程级默认台账 + 薄 helper：在 IPC 边界（main.ts 的 nomi:tasks:run）包住提交，
// 避免把 Map 与包装逻辑塞进巨壳 runtime.ts。同键提交内核 at-most-once。
const defaultLedger = new Map<string, LedgerEntry<unknown>>()

function readIdempotencyKey(payload: unknown): string {
  const key = (payload as { request?: { extras?: { idempotencyKey?: unknown } } })?.request?.extras?.idempotencyKey
  return typeof key === 'string' ? key.trim() : ''
}

/**
 * 在提交入口包一层幂等：payload.request.extras.idempotencyKey 存在 → 同键的 `run` 最多执行一次
 * （重试重放第一次的 promise，绝不二次下单）；无键 → 原样执行（向后兼容 headless/旧路径）。
 */
export function runTaskWithIdempotency<T>(payload: unknown, run: () => Promise<T>, options?: DedupeOptions): Promise<T> {
  const key = readIdempotencyKey(payload)
  if (!key) return run()
  return dedupeSubmission(defaultLedger as Map<string, LedgerEntry<T>>, key, run, options)
}

/** 清掉所有已过期条目（可选的主动 GC；不调也会在同键再次访问时惰性清理）。 */
export function pruneExpiredSubmissions(
  ledger: Map<string, LedgerEntry<unknown>>,
  now: () => number = Date.now,
): void {
  const t = now()
  for (const [key, entry] of ledger) {
    if (entry.expiresAt != null && entry.expiresAt <= t) ledger.delete(key)
  }
}
