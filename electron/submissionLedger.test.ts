import { describe, expect, it } from 'vitest'
import { dedupeSubmission, pruneExpiredSubmissions, runTaskWithIdempotency } from './submissionLedger'

type Entry = Parameters<typeof dedupeSubmission>[0] extends Map<string, infer E> ? E : never

describe('dedupeSubmission — 提交幂等台账（at-most-once 钱安全保证）', () => {
  it('同键并发(进行中) → fn 只执行一次，全部拿到同一个结果', async () => {
    const ledger = new Map()
    let calls = 0
    let resolveFn: (v: string) => void = () => {}
    const fn = () => { calls += 1; return new Promise<string>((res) => { resolveFn = res }) }

    const p1 = dedupeSubmission(ledger, 'run-1', fn)
    const p2 = dedupeSubmission(ledger, 'run-1', fn) // 第一次还在跑
    resolveFn('task-abc')

    expect(await p1).toBe('task-abc')
    expect(await p2).toBe('task-abc')
    expect(calls).toBe(1) // ★真正的提交内核只调一次
  })

  it('同键已成功(settle 后 ttl 内) → 重放同一结果，不重新执行（找回同一个 taskId）', async () => {
    const ledger = new Map()
    let calls = 0
    const fn = async () => { calls += 1; return 'task-xyz' }

    expect(await dedupeSubmission(ledger, 'run-2', fn, { now: () => 1000 })).toBe('task-xyz')
    // 模拟「成功但回执丢了」后控制器重试：同键再来
    expect(await dedupeSubmission(ledger, 'run-2', fn, { now: () => 1500 })).toBe('task-xyz')
    expect(calls).toBe(1) // ★绝不二次下单
  })

  it('同键已失败(settle 后 ttl 内) → 重放同一个 rejection，绝不二次下单', async () => {
    const ledger = new Map()
    let calls = 0
    const fn = async () => { calls += 1; throw new Error('Failed to fetch') }

    await expect(dedupeSubmission(ledger, 'run-3', fn, { now: () => 1000 })).rejects.toThrow('Failed to fetch')
    // 控制器重试循环再次提交同键：仍是同一个失败，不重新发 vendor
    await expect(dedupeSubmission(ledger, 'run-3', fn, { now: () => 1100 })).rejects.toThrow('Failed to fetch')
    await expect(dedupeSubmission(ledger, 'run-3', fn, { now: () => 1200 })).rejects.toThrow('Failed to fetch')
    expect(calls).toBe(1) // ★三次重试，真正提交只发生一次
  })

  it('TTL 过期后同键可重新执行（用户手动重试场景的兜底；正常用户重试是新 run.id）', async () => {
    const ledger = new Map()
    let calls = 0
    const fn = async () => { calls += 1; return `task-${calls}` }

    let clock = 1000
    expect(await dedupeSubmission(ledger, 'run-4', fn, { ttlMs: 100, now: () => clock })).toBe('task-1')
    clock = 5000 // 远超 ttl
    expect(await dedupeSubmission(ledger, 'run-4', fn, { ttlMs: 100, now: () => clock })).toBe('task-2')
    expect(calls).toBe(2)
  })

  it('不同键互不影响（批量每节点各自 run.id）', async () => {
    const ledger = new Map()
    let calls = 0
    const fn = async () => { calls += 1; return `t-${calls}` }
    const [a, b] = await Promise.all([
      dedupeSubmission(ledger, 'node-a', fn),
      dedupeSubmission(ledger, 'node-b', fn),
    ])
    expect(a).not.toBe(b)
    expect(calls).toBe(2)
  })

  // 生产包装（main.ts IPC 边界用的就是这个函数）：从 payload 抠 extras.idempotencyKey 决定是否去重。
  it('runTaskWithIdempotency：同 payload(带键) 连发 → run 只执行一次（模拟控制器重试）', async () => {
    let runs = 0
    const run = async () => { runs += 1; return `task-${runs}` }
    const payload = { vendor: 'v', request: { kind: 'image_to_video', extras: { idempotencyKey: 'run-X' } } }
    const a = await runTaskWithIdempotency(payload, run)
    const b = await runTaskWithIdempotency(payload, run) // 重试同键
    expect(runs).toBe(1)        // ★真正提交只一次
    expect(a).toBe('task-1')
    expect(b).toBe('task-1')    // 重放第一次（找回同一个真任务）
  })

  it('runTaskWithIdempotency：无键 payload → 不去重（向后兼容），每次都执行', async () => {
    let runs = 0
    const run = async () => { runs += 1; return `task-${runs}` }
    const payload = { vendor: 'v', request: { kind: 'image_to_video', extras: {} } }
    await runTaskWithIdempotency(payload, run)
    await runTaskWithIdempotency(payload, run)
    expect(runs).toBe(2)
  })

  it('runTaskWithIdempotency：同键提交失败 → 重试重放同一个 rejection，run 不再执行（绝不二次下单）', async () => {
    let runs = 0
    const run = async () => { runs += 1; throw new Error('Failed to fetch') }
    const payload = { vendor: 'v', request: { kind: 'image_to_video', extras: { idempotencyKey: 'run-Y' } } }
    await expect(runTaskWithIdempotency(payload, run)).rejects.toThrow('Failed to fetch')
    await expect(runTaskWithIdempotency(payload, run)).rejects.toThrow('Failed to fetch')
    expect(runs).toBe(1)
  })

  it('pruneExpiredSubmissions 清掉过期条目、保留进行中与未过期', async () => {
    const ledger = new Map<string, Entry>()
    let release: () => void = () => {}
    dedupeSubmission(ledger as never, 'inflight', () => new Promise<string>((res) => { release = () => res('x') }))
    await dedupeSubmission(ledger as never, 'fresh', async () => 'f', { ttlMs: 10000, now: () => 1000 })
    await dedupeSubmission(ledger as never, 'stale', async () => 's', { ttlMs: 10, now: () => 1000 })

    pruneExpiredSubmissions(ledger as never, () => 2000)
    expect(ledger.has('inflight')).toBe(true) // 进行中不清
    expect(ledger.has('fresh')).toBe(true)    // 未过期保留
    expect(ledger.has('stale')).toBe(false)   // 过期清掉
    release()
  })
})
