// 窄窗档（WindowNarrow 板，用户 2026-11-07 拍板）：窗口宽 < 1060 时停靠的 Nomi 临时显示成小球、点开是浮窗，
// 宽回来自动停回。约束 narrow.display-only：只有人亲手点形态切换才写存档——拖窗跨阈值多少次，存下的形态一个字节不变。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSISTANT_CONTENT_FLOOR, ASSISTANT_WIDTH_MIN } from '../../../workbench/assistantWidthBounds'
import { NARROW_TIER_QUERY, NARROW_TIER_WIDTH, effectiveAgentForm, readEffectiveAgentForm, useAgentFormStore } from './agentFormStore'

const STORAGE_KEY = 'nomi:shell-agent-form:v1'

// 测试环境是 node（无 jsdom）：在模块导入前装一个最小 localStorage，persist 中间件才真的落盘，才量得到「存档逐字节不变」。
const saved = vi.hoisted(() => {
  const map = new Map<string, string>()
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      clear: () => void map.clear(),
    },
  })
  return map
})

function persisted(): string | null {
  return saved.get(STORAGE_KEY) ?? null
}

function reset(): void {
  const state = useAgentFormStore.getState()
  state.setWindowNarrow(false, { animate: false })
  state.clearNarrowMotion()
  state.setDockSuppressed(false)
  state.setForm('creation', 'dock')
  state.setForm('generation', 'ball')
}

describe('窄窗档：只是派生，存档不动', () => {
  beforeEach(reset)
  afterEach(reset)

  it('阈值只有一个来源：主内容底线 + 停靠栏下限 = 1060，查询是 width < 1060', () => {
    expect(NARROW_TIER_WIDTH).toBe(ASSISTANT_CONTENT_FLOOR + ASSISTANT_WIDTH_MIN)
    expect(NARROW_TIER_WIDTH).toBe(1060)
    expect(NARROW_TIER_QUERY).toBe('(width < 1060px)')
  })

  it('派生表：只改存着「停靠」的页；窄窗优先于 dockSuppressed', () => {
    const view = (windowNarrow: boolean, narrowOpen: boolean, dockSuppressed: boolean) => ({ windowNarrow, narrowOpen, dockSuppressed })
    expect(effectiveAgentForm('dock', view(false, false, false))).toBe('dock')
    expect(effectiveAgentForm('dock', view(true, false, false))).toBe('ball')
    expect(effectiveAgentForm('dock', view(true, true, false))).toBe('float')
    expect(effectiveAgentForm('dock', view(true, true, true))).toBe('float')
    expect(effectiveAgentForm('dock', view(false, false, true))).toBe('ball')
    for (const stored of ['ball', 'float'] as const) {
      expect(effectiveAgentForm(stored, view(true, true, true))).toBe(stored)
      expect(effectiveAgentForm(stored, view(false, false, false))).toBe(stored)
    }
  })

  it('拖窗 700 ↔ 1100 来回三次：存档逐字节不变，宽回来自动停回', () => {
    const state = useAgentFormStore.getState()
    const before = persisted()
    expect(before).toContain('"dock"')
    for (let round = 0; round < 3; round += 1) {
      state.setWindowNarrow(true)
      expect(readEffectiveAgentForm('creation')).toBe('ball')
      expect(useAgentFormStore.getState().narrowMotion).toBe('collapse')
      state.setWindowNarrow(false)
      expect(readEffectiveAgentForm('creation')).toBe('dock')
      expect(useAgentFormStore.getState().narrowMotion).toBe('restore')
    }
    expect(persisted()).toBe(before)
    expect(useAgentFormStore.getState().bySurface.creation.form).toBe('dock')
  })

  it('同一侧重复报（拖窗过程中 matchMedia 只在跨过时才回调，这里再保一层）：不重复置过渡', () => {
    const state = useAgentFormStore.getState()
    state.setWindowNarrow(true)
    state.clearNarrowMotion()
    state.setWindowNarrow(true)
    expect(useAgentFormStore.getState().narrowMotion).toBeNull()
  })

  it('启动时那次对齐不算跨阈值：不播过渡', () => {
    useAgentFormStore.getState().setWindowNarrow(true, { animate: false })
    expect(useAgentFormStore.getState().narrowMotion).toBeNull()
    expect(readEffectiveAgentForm('creation')).toBe('ball')
  })

  it('窄窗里点开 / 收起停靠的页：只改这一刻怎么摆，不写存档；宽回来照样停回', () => {
    const state = useAgentFormStore.getState()
    const before = persisted()
    state.setWindowNarrow(true)
    state.requestForm('creation', 'dock') // 小球点开（创作页的「打开」是停靠）
    expect(readEffectiveAgentForm('creation')).toBe('float')
    state.requestForm('creation', 'ball') // 浮窗里点「缩成小球」
    expect(readEffectiveAgentForm('creation')).toBe('ball')
    state.requestForm('creation', 'float') // 小球右键「浮窗」
    expect(readEffectiveAgentForm('creation')).toBe('float')
    expect(persisted()).toBe(before)
    state.setWindowNarrow(false)
    expect(readEffectiveAgentForm('creation')).toBe('dock')
  })

  it('跨阈值复位「点开」：再拉窄时停靠的页又是小球，不会自己弹成浮窗', () => {
    const state = useAgentFormStore.getState()
    state.setWindowNarrow(true)
    state.requestForm('creation', 'dock')
    expect(readEffectiveAgentForm('creation')).toBe('float')
    state.setWindowNarrow(false)
    state.setWindowNarrow(true)
    expect(readEffectiveAgentForm('creation')).toBe('ball')
  })

  it('人亲手要停靠（原来存的是小球）：记下「停靠」，此刻以浮窗打开，宽回来就是停靠', () => {
    const state = useAgentFormStore.getState()
    state.setForm('creation', 'ball')
    state.setWindowNarrow(true)
    state.requestForm('creation', 'dock')
    expect(useAgentFormStore.getState().bySurface.creation.form).toBe('dock')
    expect(readEffectiveAgentForm('creation')).toBe('float')
    state.setWindowNarrow(false)
    expect(readEffectiveAgentForm('creation')).toBe('dock')
  })

  it('不是停靠的页在窄窗里照常写形态（画布页小球 → 浮窗是人手点的）', () => {
    const state = useAgentFormStore.getState()
    state.setWindowNarrow(true)
    state.requestForm('generation', 'float')
    expect(useAgentFormStore.getState().bySurface.generation.form).toBe('float')
  })

  it('不在窄窗档：requestForm 就是 setForm', () => {
    const state = useAgentFormStore.getState()
    state.requestForm('creation', 'float')
    expect(useAgentFormStore.getState().bySurface.creation.form).toBe('float')
    state.requestForm('creation', 'dock')
    expect(useAgentFormStore.getState().bySurface.creation.form).toBe('dock')
  })

  it('窄窗档的几个字段不进存档（存档只有 bySurface）', () => {
    useAgentFormStore.getState().setWindowNarrow(true)
    useAgentFormStore.getState().requestForm('creation', 'dock')
    const saved = JSON.parse(persisted() ?? '{}') as { state?: Record<string, unknown> }
    expect(Object.keys(saved.state ?? {})).toEqual(['bySurface'])
  })
})
