// 能力核 · 派发参数的形状校验（从 dispatcher.ts 原样搬出，行为逐字不变）。
//
// 为什么单拎：`production.*` 的路由体已经开始外移（见 productionTrustGrantChallenge.ts），而这三个
// 校验是**每条路由都要用的同一把尺子**。留在 dispatcher 里就只有两条路：外移的模块反向 import
// dispatcher（造静态环，check:boundaries 拦），或各写一份（同一语义两份定义，R14.1 拦）。
// 搬出来两边都从这里取，尺子仍然只有一把。
import { RpcError } from './rpcError'

export function requiredIdentifier(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized) || normalized === '.' || normalized === '..') throw new RpcError(`Invalid ${label} id`, 400)
  return normalized
}

export function assertOnlyFields(params: Record<string, unknown>, allowed: Set<string>): void {
  const unexpected = Object.keys(params).find((key) => !allowed.has(key))
  if (unexpected) throw new RpcError(`Production field is not allowed: ${unexpected}`, 400)
}

export function optionalText(value: unknown, label: string, max = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > max) throw new RpcError(`Invalid ${label}`, 400)
  return normalized
}
