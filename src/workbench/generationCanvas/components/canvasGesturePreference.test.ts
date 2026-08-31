// 画布滚轮语义二选一（#832）。抽纯函数就是为了这份真值表能单测——hook 本身测不了（无 @testing-library/react）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CANVAS_GESTURE_SCHEME,
  __resetCanvasGestureSchemeForTest,
  getCanvasGestureScheme,
  resolveWheelIntent,
  setCanvasGestureScheme,
  subscribeCanvasGestureScheme,
} from './canvasGesturePreference'

const bare = { ctrlKey: false, metaKey: false }

describe('resolveWheelIntent — 两档 × 修饰键真值表', () => {
  it('wheel-zoom 档：裸滚轮 = 缩放（ComfyUI 习惯，默认档）', () => {
    expect(resolveWheelIntent('wheel-zoom', bare)).toBe('zoom')
  })

  it('modifier-zoom 档：裸滚轮 = 平移（触控板双指滑不再被当缩放，这正是这一档存在的理由）', () => {
    expect(resolveWheelIntent('modifier-zoom', bare)).toBe('pan')
  })

  // 这两条是 modifier-zoom 的保命线：那一档下 ⌘/Ctrl+滚轮是**唯一**的缩放入口，
  // 谁把它也翻成平移，那一档就彻底没法缩放了。
  it.each([
    ['ctrlKey（触控板捏合浏览器合成的就是它）', { ctrlKey: true, metaKey: false }],
    ['metaKey（⌘+滚轮）', { ctrlKey: false, metaKey: true }],
  ])('%s：两档都恒缩放', (_label, event) => {
    expect(resolveWheelIntent('wheel-zoom', event)).toBe('zoom')
    expect(resolveWheelIntent('modifier-zoom', event)).toBe('zoom')
  })
})

// 测试环境是 node（无 jsdom），用最小 localStorage 桩（照 onboardingState.test.ts）。
// 本模块读的是 globalThis.localStorage（照 previewSourcePanelPreference.ts），故直接 stub 它。
const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
}

describe('偏好读写', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', localStorageStub)
    __resetCanvasGestureSchemeForTest()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('没存过 → 默认 wheel-zoom（#832 拍板：comfyui 习惯优先）', () => {
    expect(getCanvasGestureScheme()).toBe('wheel-zoom')
    expect(DEFAULT_CANVAS_GESTURE_SCHEME).toBe('wheel-zoom')
  })

  it('设置后当场生效并落盘', () => {
    setCanvasGestureScheme('modifier-zoom')
    expect(getCanvasGestureScheme()).toBe('modifier-zoom')
    expect(store.get('nomi.canvasGesture.scheme')).toBe('modifier-zoom')
  })

  it('落盘值在新会话里读得回来', () => {
    store.set('nomi.canvasGesture.scheme', 'modifier-zoom')
    __resetCanvasGestureSchemeForTest() // 模拟重开 App 时的模块初始化
    expect(getCanvasGestureScheme()).toBe('modifier-zoom')
  })

  it('落盘值是垃圾 → 兜回默认档，不让画布进未定义状态', () => {
    store.set('nomi.canvasGesture.scheme', 'wat')
    __resetCanvasGestureSchemeForTest()
    expect(getCanvasGestureScheme()).toBe('wheel-zoom')
  })

  it('localStorage 抛错（隐私模式）→ 读默认、写不炸，只是本次会话不记住', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    __resetCanvasGestureSchemeForTest()
    expect(getCanvasGestureScheme()).toBe('wheel-zoom')
    expect(() => setCanvasGestureScheme('modifier-zoom')).not.toThrow()
    expect(getCanvasGestureScheme()).toBe('modifier-zoom') // 内存里仍然切了
  })
})

describe('订阅 — 设置页改完画布当场换语义，不用重开', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', localStorageStub)
    __resetCanvasGestureSchemeForTest()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('切换会通知订阅者（useSyncExternalStore 靠它重渲染画布与提示卡）', () => {
    const seen: string[] = []
    const unsubscribe = subscribeCanvasGestureScheme(() => seen.push(getCanvasGestureScheme()))
    setCanvasGestureScheme('modifier-zoom')
    setCanvasGestureScheme('wheel-zoom')
    unsubscribe()
    setCanvasGestureScheme('modifier-zoom') // 退订后不该再收到
    expect(seen).toEqual(['modifier-zoom', 'wheel-zoom'])
  })

  it('设成同一档 → 不空通知（避免无谓重渲染）', () => {
    let calls = 0
    const unsubscribe = subscribeCanvasGestureScheme(() => { calls += 1 })
    setCanvasGestureScheme('wheel-zoom') // 已经是默认档
    expect(calls).toBe(0)
    unsubscribe()
  })
})
