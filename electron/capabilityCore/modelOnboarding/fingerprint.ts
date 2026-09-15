// 不透明状态指纹：nomi_remove_provider 的 ifUnchanged 原样抄它。
//
// 为什么是**不透明字符串**而不是整数 revision：整数会诱导模型「自己 +1」——实测的错误码表里
// 专门有一条 integration_revision_ahead 就是在骂这件事。一个必须由模型计算、又不许它计算的整数
// 是一个设计好的陷阱。换成带前缀的哈希之后，「计算下一个值」这件事在模型面上**不可表达**（门岗 O3）。
import { createHash } from 'node:crypto'
import { canonicalJson } from './idempotency'

export function fingerprintOf(state: unknown): string {
  return `fp_${createHash('sha256').update(canonicalJson(state)).digest('hex').slice(0, 12)}`
}
