import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  hasSeenSplash,
  markSplashSeen,
  readChecklist,
  markChecklistStep,
  readChecklistCollapsed,
  writeChecklistCollapsed,
  isChecklistDismissed,
  markChecklistDismissed,
  ensureChecklistFirstShownAt,
  isChecklistExpired,
  CHECKLIST_TTL_MS,
} from './onboardingState'

// 测试环境是 node（无 jsdom），用最小 localStorage 桩模拟 window（照 activeProject.test.ts）。
const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
}

beforeEach(() => {
  store.clear()
  vi.stubGlobal('window', { localStorage: localStorageStub })
})
afterEach(() => vi.unstubAllGlobals())

describe('onboardingState', () => {
  it('splash 默认未看过，标记后为 true', () => {
    expect(hasSeenSplash()).toBe(false)
    markSplashSeen()
    expect(hasSeenSplash()).toBe(true)
  })

  it('清单步骤累积打勾', () => {
    expect(readChecklist().model).toBe(false)
    markChecklistStep('model')
    expect(readChecklist().model).toBe(true)
    expect(readChecklist().exported).toBe(false)
  })

  it('多步打勾互不覆盖', () => {
    markChecklistStep('model')
    markChecklistStep('exported')
    const state = readChecklist()
    expect(state.model).toBe(true)
    expect(state.exported).toBe(true)
    expect(state.storyboard).toBe(false)
    expect(state.generated).toBe(false)
  })

  it('readChecklist 容错坏 JSON，回退到全 false', () => {
    localStorageStub.setItem('nomi:checklist:v1', '{not json')
    expect(readChecklist()).toEqual({
      model: false,
      storyboard: false,
      generated: false,
      exported: false,
    })
  })

  it('折叠态默认展开（false），写入后可读回', () => {
    expect(readChecklistCollapsed()).toBe(false)
    writeChecklistCollapsed(true)
    expect(readChecklistCollapsed()).toBe(true)
    writeChecklistCollapsed(false)
    expect(readChecklistCollapsed()).toBe(false)
  })

  it('清单未关闭默认 false，标记后 true', () => {
    expect(isChecklistDismissed()).toBe(false)
    markChecklistDismissed()
    expect(isChecklistDismissed()).toBe(true)
  })

  it('首次显示时间只写一次，后续调用返回首值（不被覆盖）', () => {
    const t0 = 1_000_000
    expect(ensureChecklistFirstShownAt(t0)).toBe(t0)
    expect(ensureChecklistFirstShownAt(t0 + 99_999)).toBe(t0)
  })

  it('首显满 2 天未完成即过期；首显当下与差 1ms 均不过期', () => {
    const t0 = 1_000_000
    expect(isChecklistExpired(t0)).toBe(false) // 首次：记 now，不算过期
    expect(isChecklistExpired(t0 + CHECKLIST_TTL_MS - 1)).toBe(false)
    expect(isChecklistExpired(t0 + CHECKLIST_TTL_MS)).toBe(true)
  })
})
