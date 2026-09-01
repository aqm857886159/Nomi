// 项目级常驻 Agent 发布闸（#223）。这份单测锁的核心不变量是「默认关闭」——发布闸最要命的属性，
// 谁把默认翻成 true 或让垃圾落盘值兜成 true，这里当场报红。hook 本身测不了（无 @testing-library/react），
// 测纯读写/订阅函数即可。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_HOST_ENABLED_KEY,
  DEFAULT_AGENT_HOST_ENABLED,
  __resetAgentHostEnabledForTest,
  getAgentHostEnabled,
  setAgentHostEnabled,
  subscribeAgentHostEnabled,
} from './agentHostPreference'

// 测试环境是 node（无 jsdom），用最小 localStorage 桩（照 canvasGesturePreference.test.ts）。
const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
}

describe('agentHostEnabled — 发布闸默认关闭', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', localStorageStub)
    __resetAgentHostEnabledForTest()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('没存过 → 默认关（#194 交互对齐 epic 完成前不把半成品摆给用户）', () => {
    expect(getAgentHostEnabled()).toBe(false)
    expect(DEFAULT_AGENT_HOST_ENABLED).toBe(false)
  })

  it('开启后当场生效并落盘', () => {
    setAgentHostEnabled(true)
    expect(getAgentHostEnabled()).toBe(true)
    expect(store.get(AGENT_HOST_ENABLED_KEY)).toBe('true')
  })

  it('落盘 true 在新会话里读得回来（走查隔离 profile 靠这条显式开闸）', () => {
    store.set(AGENT_HOST_ENABLED_KEY, 'true')
    __resetAgentHostEnabledForTest() // 模拟重开 App 时的模块初始化
    expect(getAgentHostEnabled()).toBe(true)
  })

  it('落盘值是垃圾 → 兜回默认关，绝不误开（发布闸的保命线）', () => {
    store.set(AGENT_HOST_ENABLED_KEY, 'wat')
    __resetAgentHostEnabledForTest()
    expect(getAgentHostEnabled()).toBe(false)
  })

  it('localStorage 抛错（隐私模式）→ 读默认关、写不炸，只是本次会话不记住', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    __resetAgentHostEnabledForTest()
    expect(getAgentHostEnabled()).toBe(false)
    expect(() => setAgentHostEnabled(true)).not.toThrow()
    expect(getAgentHostEnabled()).toBe(true) // 内存里仍然开了
  })
})

describe('订阅 — 设置页开关一改常驻壳当场挂载/卸载', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', localStorageStub)
    __resetAgentHostEnabledForTest()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('切换会通知订阅者（useSyncExternalStore 靠它重渲染 WorkbenchShell）', () => {
    const seen: boolean[] = []
    const unsubscribe = subscribeAgentHostEnabled(() => seen.push(getAgentHostEnabled()))
    setAgentHostEnabled(true)
    setAgentHostEnabled(false)
    unsubscribe()
    setAgentHostEnabled(true) // 退订后不该再收到
    expect(seen).toEqual([true, false])
  })

  it('设成同一态 → 不空通知（避免无谓重渲染）', () => {
    let calls = 0
    const unsubscribe = subscribeAgentHostEnabled(() => { calls += 1 })
    setAgentHostEnabled(false) // 已经是默认关
    expect(calls).toBe(0)
    unsubscribe()
  })
})
