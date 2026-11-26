import React from 'react'
import type { VendorAccountBalance } from '../../../../electron/shared/contracts/vendorAccountBalance'
import { getDesktopBridge } from '../../../desktop/bridge'

/**
 * 账户余额快照的存活期：超过此时长主动失效并回退正常发送键，绝不拿过期余额一直卡在「去充值」。
 */
export const BALANCE_TTL_MS = 60_000

type CacheEntry = {
  balance: VendorAccountBalance | null
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<VendorAccountBalance | null>>()
const pendingTopUpRefresh = new Set<string>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function readFreshEntry(vendorKey: string, now = Date.now()): CacheEntry | undefined {
  const entry = cache.get(vendorKey)
  if (!entry) return undefined
  if (now >= entry.expiresAt) {
    cache.delete(vendorKey)
    return undefined
  }
  return entry
}

async function fetchBalance(vendorKey: string, force = false): Promise<VendorAccountBalance | null> {
  if (!force) {
    const fresh = readFreshEntry(vendorKey)
    if (fresh) return fresh.balance
  }
  const existing = inFlight.get(vendorKey)
  if (existing) return existing
  const read = getDesktopBridge()?.onboarding?.vendorAccountBalance
  if (!read) return null
  const promise = Promise.resolve()
    .then(() => read({ vendorKey }))
    .catch(() => null)
    .then((balance) => {
      cache.set(vendorKey, { balance: balance ?? null, expiresAt: Date.now() + BALANCE_TTL_MS })
      emit()
      return balance ?? null
    })
    .finally(() => {
      if (inFlight.get(vendorKey) === promise) inFlight.delete(vendorKey)
    })
  inFlight.set(vendorKey, promise)
  return promise
}

/** 标记用户点击了「去充值」：切回 Nomi 窗口时自动重查一次余额。 */
export function markTopUpOpened(vendorKey: string): void {
  pendingTopUpRefresh.add(vendorKey)
}

/** 主动失效并刷新某供应商的余额缓存（如任务完成后或用户从充值页切回）。 */
export function refreshVendorBalance(vendorKey: string): void {
  cache.delete(vendorKey)
  emit()
  void fetchBalance(vendorKey, true)
}

/**
 * 读取指定官方供应商的余额快照（与公开约价 `useNodePricePreview` 完全解耦）。
 * - 同一供应商在 `BALANCE_TTL_MS` 内共享一份缓存，切换画布节点不产生额外 IPC；
 * - 到达 `expiresAt` 时主动调度定时器清掉过期快照并触发重渲，保证不会停在过期的「余额不足」态；
 * - 用户点击「去充值」并切回应用窗口（`focus`）时自动刷新余额。
 */
export function useVendorBalance(vendorKey: string | undefined): VendorAccountBalance | null {
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => subscribe(() => setTick((n) => n + 1)), [])
  void tick

  const fresh = vendorKey ? readFreshEntry(vendorKey) : undefined
  const balance = fresh?.balance ?? null
  const expiresAt = fresh?.expiresAt ?? null

  React.useEffect(() => {
    if (!vendorKey) return
    if (!readFreshEntry(vendorKey)) {
      void fetchBalance(vendorKey)
    }
  }, [vendorKey, tick])

  const hasBalance = balance !== null
  // 余额快照到期时主动清掉并重渲（修复旧 PR 过期余额不回退的问题）；仅在有真实余额快照时挂定时器。
  React.useEffect(() => {
    if (!vendorKey || !hasBalance || expiresAt === null) return
    const remaining = Math.max(0, expiresAt - Date.now())
    const timer = window.setTimeout(() => {
      const current = cache.get(vendorKey)
      if (current && Date.now() >= current.expiresAt) {
        cache.delete(vendorKey)
        emit()
      }
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [vendorKey, hasBalance, expiresAt])

  // 用户点「去充值」后切回窗口，立即重查余额。
  React.useEffect(() => {
    if (!vendorKey || typeof window === 'undefined') return
    const onFocus = (): void => {
      if (!pendingTopUpRefresh.has(vendorKey)) return
      pendingTopUpRefresh.delete(vendorKey)
      refreshVendorBalance(vendorKey)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [vendorKey])

  return balance
}

export function resetVendorBalanceCacheForTest(): void {
  cache.clear()
  inFlight.clear()
  pendingTopUpRefresh.clear()
  emit()
}
