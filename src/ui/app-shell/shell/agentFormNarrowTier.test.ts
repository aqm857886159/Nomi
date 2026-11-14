// 窄窗档（WindowNarrow 板，用户 2026-11-07 拍板）：窗口宽 < 1060 时停靠的 Nomi 临时显示成小球、点开是浮窗，
// 宽回来自动停回。约束 narrow.display-only：窄窗里点开 / 收起只改此刻那份（agentFormViewStore，不落盘）——
// 拖窗跨阈值多少次，存下的东西一个字节不变。真组件入口 × 每种存法 × 每个手势的全表在 ShellAgentHost.formProbe.test.tsx。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSISTANT_CONTENT_FLOOR, ASSISTANT_WIDTH_MIN } from '../../../workbench/assistantWidthBounds'
import {
  AGENT_FORM_STORAGE_KEY,
  NARROW_TIER_QUERY,
  NARROW_TIER_WIDTH,
  chooseAgentPlacement,
  clearAgentNarrowMotion,
  collapseAgent,
  openAgent,
  setAgentWindowNarrow,
  shownForm,
  useAgentFormStore,
} from './agentFormStore'
import { useAgentFormViewStore } from './agentFormViewStore'

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
  return saved.get(AGENT_FORM_STORAGE_KEY) ?? null
}

function reset(): void {
  useAgentFormViewStore.setState(useAgentFormViewStore.getInitialState(), true)
  useAgentFormStore.setState(useAgentFormStore.getInitialState(), true)
  // 创作页开着停靠、生成页收着（各页默认）；先落一次盘，后面才量得到「逐字节不变」。
  chooseAgentPlacement('creation', 'dock')
  collapseAgent('generation')
  useAgentFormStore.setState({ bySurface: { ...useAgentFormStore.getState().bySurface } })
}

describe('窄窗档：只是派生，存档不动', () => {
  beforeEach(reset)
  afterEach(reset)

  it('阈值只有一个来源：主内容底线 + 停靠栏下限 = 1060，查询是 width < 1060', () => {
    expect(NARROW_TIER_WIDTH).toBe(ASSISTANT_CONTENT_FLOOR + ASSISTANT_WIDTH_MIN)
    expect(NARROW_TIER_WIDTH).toBe(1060)
    expect(NARROW_TIER_QUERY).toBe('(width < 1060px)')
  })

  it('拖窗 700 ↔ 1100 来回三次：存档逐字节不变，宽回来自动停回', () => {
    const before = persisted()
    expect(before).toContain('"dock"')
    for (let round = 0; round < 3; round += 1) {
      setAgentWindowNarrow(true)
      expect(shownForm('creation')).toBe('ball')
      expect(useAgentFormViewStore.getState().narrowMotion).toBe('collapse')
      setAgentWindowNarrow(false)
      expect(shownForm('creation')).toBe('dock')
      expect(useAgentFormViewStore.getState().narrowMotion).toBe('restore')
    }
    expect(persisted()).toBe(before)
  })

  it('同一侧重复报（拖窗过程中 matchMedia 只在跨过时才回调，这里再保一层）：不重复置过渡', () => {
    setAgentWindowNarrow(true)
    clearAgentNarrowMotion()
    setAgentWindowNarrow(true)
    expect(useAgentFormViewStore.getState().narrowMotion).toBeNull()
  })

  it('启动时那次对齐不算跨阈值：不播过渡', () => {
    setAgentWindowNarrow(true, { animate: false })
    expect(useAgentFormViewStore.getState().narrowMotion).toBeNull()
    expect(shownForm('creation')).toBe('ball')
  })

  it('窄窗里点开 / 收起停靠的页：只改这一刻怎么摆，不写存档；宽回来照样停回', () => {
    const before = persisted()
    setAgentWindowNarrow(true)
    openAgent('creation')
    expect(shownForm('creation')).toBe('float')
    collapseAgent('creation')
    expect(shownForm('creation')).toBe('ball')
    openAgent('creation')
    expect(shownForm('creation')).toBe('float')
    expect(persisted()).toBe(before)
    setAgentWindowNarrow(false)
    expect(shownForm('creation')).toBe('dock')
  })

  it('跨阈值复位「点开」：再拉窄时停靠的页又是小球，不会自己弹成浮窗', () => {
    setAgentWindowNarrow(true)
    openAgent('creation')
    expect(shownForm('creation')).toBe('float')
    setAgentWindowNarrow(false)
    setAgentWindowNarrow(true)
    expect(shownForm('creation')).toBe('ball')
  })

  it('窄窗里点开只管这一页：别的页还是自己存的样子（旧版整窗一份，点开一页别的页也弹出来）', () => {
    setAgentWindowNarrow(true)
    openAgent('creation')
    expect(shownForm('creation')).toBe('float')
    expect(shownForm('generation')).toBe('ball')
    expect(shownForm('storyboard')).toBe('ball')
  })

  it('不在窄窗档：收起 / 打开 / 选摆法都写人选的那份；收起再开回到上次选的摆法', () => {
    chooseAgentPlacement('creation', 'float')
    expect(useAgentFormStore.getState().bySurface.creation).toMatchObject({ placement: 'float', collapsed: false })
    collapseAgent('creation')
    expect(useAgentFormStore.getState().bySurface.creation).toMatchObject({ placement: 'float', collapsed: true })
    openAgent('creation')
    expect(shownForm('creation')).toBe('float')
  })

  it('此刻那份不进存档（存档只有 bySurface，每页只有摆法、收没收起、位置）', () => {
    setAgentWindowNarrow(true)
    openAgent('creation')
    const disk = JSON.parse(persisted() ?? '{}') as { state?: { bySurface?: Record<string, Record<string, unknown>> } }
    expect(Object.keys(disk.state ?? {})).toEqual(['bySurface'])
    expect(Object.keys(disk.state?.bySurface?.creation ?? {}).sort()).toEqual(['ball', 'collapsed', 'float', 'placement'])
  })
})
