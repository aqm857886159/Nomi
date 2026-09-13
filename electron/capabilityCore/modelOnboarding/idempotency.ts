// 幂等：把「点 4 次确认 3 次白点」从信封里消掉。设计正本 §4。
//
// 一句话：**幂等键从模型入参里拿掉**，由宿主按 (setupId, action, canonicalJson(args) 的 SHA-256) 派生；
// 同一跳重放返回**同一个结果**（含同一个 changeId），永不作废人的点击。这正是 Stripe 的语义。
//
// 为什么让调用方铸键必然出错：幂等的语义（同 key 重放返回同一结果）只有服务端能保证；
// 让调用方铸，等于把幂等的定义权交给最不稳定的一方。实测里 22 次失败有 2 次直接死在这个必填上，
// 另外 4 次死在「等人的时候不知道该干什么，于是又 confirm 了一次」——而那一次重签作废了人的点击。
// 新面上这两件事结构上都不可表达：模型手里没有键，且重放恒等。
import { createHash } from 'node:crypto'

/** 稳定序列化：对象键排序，数组保序。同一份语义入参 -> 同一个字符串。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/**
 * (setupId, action, 入参摘要) -> 幂等键。
 * setupId 缺席（还没有句柄的 connect_provider 首跳）时用空串占位——此时入参摘要本身就足以定位这一跳。
 */
export function deriveIdempotencyKey(setupId: string | undefined, action: string, args: Record<string, unknown>): string {
  const digest = createHash('sha256')
    .update(`${setupId ?? ''} ${action} ${canonicalJson(args)}`)
    .digest('hex')
  return `idem_${digest.slice(0, 32)}`
}

type Entry<T> = { value: T; at: number }

/**
 * 重放缓存：同一个派生键 -> 同一个结果。
 *
 * 保留窗口与会话句柄同寿（默认 7 天），但容量有上限——它是「让重复调用无害」的机制，
 * 不是持久存储；进程重启后重放会真的重跑一次，而所有 reversible_local 动作本身就是幂等的
 * （upsert / 选择集覆盖 / 可见性置位 / 取消），所以重跑不会产生第二份后果。
 */
export class ReplayCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  constructor(
    private readonly ttlMs = 7 * 24 * 60 * 60 * 1000,
    private readonly capacity = 512,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key)
    if (!hit) return undefined
    if (this.now() - hit.at > this.ttlMs) {
      this.entries.delete(key)
      return undefined
    }
    return hit.value
  }

  set(key: string, value: T): T {
    this.entries.set(key, { value, at: this.now() })
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
    return value
  }

  /** 有就返回旧的，没有就跑一次并记下来。**同一跳重放一字不差**。 */
  async replay(key: string, run: () => Promise<T>): Promise<T> {
    const hit = this.get(key)
    if (hit !== undefined) return hit
    return this.set(key, await run())
  }
}

/** changeId 也从幂等键派生——重放返回同一个 changeId（信封契约）。 */
export function changeIdFor(idempotencyKey: string): string {
  return `chg_${idempotencyKey.slice('idem_'.length, 'idem_'.length + 20)}`
}
