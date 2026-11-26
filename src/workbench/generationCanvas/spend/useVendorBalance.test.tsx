import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VendorAccountBalance } from '../../../../electron/shared/contracts/vendorAccountBalance'
import { createReactTestRenderer } from '../../ai/v4/testReactRenderer'
import {
  BALANCE_TTL_MS,
  markTopUpOpened,
  resetVendorBalanceCacheForTest,
  useVendorBalance,
} from './useVendorBalance'

function makeBalance(remainCredits: number): VendorAccountBalance {
  return {
    remainCredits,
    remainUsd: remainCredits / 10,
    unlimited: false,
    topUpUrl: 'https://apimart.ai/register?aff=t55VtP',
    fetchedAt: Date.now(),
  }
}

describe('useVendorBalance（独立于约价钩子：TTL 过期主动回退 + 缓存防重 + 充值返回刷新）', () => {
  let latest: VendorAccountBalance | null = null
  let renderer: ReturnType<typeof createReactTestRenderer>
  let focusListeners: Array<() => void> = []

  function Probe({ vendorKey }: { vendorKey?: string }) {
    latest = useVendorBalance(vendorKey)
    return null
  }

  beforeEach(() => {
    vi.useFakeTimers()
    latest = null
    focusListeners = []
    resetVendorBalanceCacheForTest()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
    renderer = createReactTestRenderer()
  })

  afterEach(() => {
    renderer.close()
    resetVendorBalanceCacheForTest()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function stubWindow(readBalance: (payload: { vendorKey: string }) => Promise<VendorAccountBalance | null>) {
    vi.stubGlobal('window', {
      nomiDesktop: { onboarding: { vendorAccountBalance: readBalance } },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'focus') focusListeners.push(fn)
      },
      removeEventListener: (type: string, fn: () => void) => {
        if (type === 'focus') focusListeners = focusListeners.filter((listener) => listener !== fn)
      },
    })
  }

  async function flushMicrotasks() {
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve()
      renderer.flushPassiveEffects()
    }
  }

  it('同供应商在 TTL 内第二次挂载 0 次额外 IPC，TTL 到期且重查失败时主动回退 null', async () => {
    const readBalance = vi.fn()
      .mockResolvedValueOnce(makeBalance(2))
      .mockResolvedValueOnce(null)
    stubWindow(readBalance)

    renderer.render(<Probe vendorKey="apimart" />)
    await flushMicrotasks()
    expect(latest?.remainCredits).toBe(2)
    expect(readBalance).toHaveBeenCalledTimes(1)

    // 卸载再挂：TTL 内直接复用缓存，不发二次 IPC。
    renderer.render(null)
    renderer.flushPassiveEffects()
    renderer.render(<Probe vendorKey="apimart" />)
    await flushMicrotasks()
    expect(latest?.remainCredits).toBe(2)
    expect(readBalance).toHaveBeenCalledTimes(1)

    // TTL 到期：主动清掉过期余额并重查；重查回 null 时画面立刻回退 null（不卡在过期缺额态）。
    await vi.advanceTimersByTimeAsync(BALANCE_TTL_MS + 10)
    await flushMicrotasks()
    expect(readBalance).toHaveBeenCalledTimes(2)
    expect(latest).toBeNull()
  })

  it('点击去充值后窗口重新获得焦点时立即刷新余额', async () => {
    const readBalance = vi.fn()
      .mockResolvedValueOnce(makeBalance(1))
      .mockResolvedValueOnce(makeBalance(50))
    stubWindow(readBalance)

    renderer.render(<Probe vendorKey="apimart" />)
    await flushMicrotasks()
    expect(latest?.remainCredits).toBe(1)

    markTopUpOpened('apimart')
    for (const listener of [...focusListeners]) listener()
    await flushMicrotasks()

    expect(readBalance).toHaveBeenCalledTimes(2)
    expect(latest?.remainCredits).toBe(50)
  })
})
