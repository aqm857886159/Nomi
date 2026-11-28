import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as onboardingState from './onboardingState'
import {
  readChecklist,
  markChecklistStep,
  isChecklistDismissed,
  markChecklistDismissed,
  ensureChecklistFirstShownAt,
  isChecklistExpired,
  CHECKLIST_TTL_MS,
  hasCompletedFirstAgentTurn,
  markFirstAgentTurnCompleted,
  canAskFirstAgentConsent,
  markAgentConsentAsked,
  ONBOARDING_STATE_SYNC_EVENT,
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
  it('Q18 删开屏后不再导出 splash 标记读写，老用户残留 nomi:splash:v1 无副作用', () => {
    localStorageStub.setItem('nomi:splash:v1', 'seen')
    expect('hasSeenSplash' in onboardingState).toBe(false)
    expect('markSplashSeen' in onboardingState).toBe(false)
    expect(readChecklist().model).toBe(false)
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

  it('canAskFirstAgentConsent 在未达成首次生成或首轮对话前保持 false，达成任一后变 true 且问过即关', () => {
    expect(hasCompletedFirstAgentTurn()).toBe(false)
    expect(canAskFirstAgentConsent()).toBe(false)

    // 仅完成接入模型或建分镜不足以触发首次遥测询问
    markChecklistStep('model')
    markChecklistStep('storyboard')
    expect(canAskFirstAgentConsent()).toBe(false)

    // 首次生成达成 → 解锁
    markChecklistStep('generated')
    expect(canAskFirstAgentConsent()).toBe(true)

    // 问过一次 → 永久关闭
    markAgentConsentAsked()
    expect(canAskFirstAgentConsent()).toBe(false)
  })

  it('首轮 Agent 对话完成或存在历史线程可解锁首次遥测询问，且派发同步事件', () => {
    const events: string[] = []
    vi.stubGlobal('window', {
      localStorage: localStorageStub,
      dispatchEvent: (event: Event) => {
        events.push(event.type)
        return true
      },
    })

    expect(canAskFirstAgentConsent()).toBe(false)
    expect(canAskFirstAgentConsent({ hasHistoricalAgentThread: true })).toBe(true)

    markFirstAgentTurnCompleted()
    expect(hasCompletedFirstAgentTurn()).toBe(true)
    expect(canAskFirstAgentConsent()).toBe(true)
    expect(events).toContain(ONBOARDING_STATE_SYNC_EVENT)
  })

  it('localStorage 不可用时 canAskFirstAgentConsent fail-closed 返回 false', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => { throw new Error('blocked') },
        setItem: () => { throw new Error('blocked') },
      },
    })
    expect(hasCompletedFirstAgentTurn()).toBe(false)
    expect(canAskFirstAgentConsent()).toBe(false)
    expect(canAskFirstAgentConsent({ hasHistoricalAgentThread: true })).toBe(false)
  })
})
