// 不变量（约束 narrow.display-only，WindowNarrow 板 D2，用户 2026-11-07）：窄窗档里除了明确「选摆法」那一下，
// 人点开 / 收起、机器让开 / 回来、跨阈值来回，存下的东西前后逐字相等；拉宽回来，这一页是自己存的样子。
// 这里只用 store 对外的动作（不抄调用方逻辑）；真组件入口 × 每种存法 × 每个手势的全表在 ShellAgentHost.formProbe.test.tsx。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_FORM_STORAGE_KEY,
  collapseAgent,
  machineHold,
  machineRelease,
  openAgent,
  setAgentWindowNarrow,
  shownForm,
  useAgentFormStore,
  type AgentForm,
  type AgentFormSurface,
} from './agentFormStore'
import { useAgentFormViewStore } from './agentFormViewStore'

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

const persisted = (): string | null => saved.get(AGENT_FORM_STORAGE_KEY) ?? null

type Stored = 'ball' | 'float' | 'dock'

/** 从宽窗起，人把这一页摆成某个样子（宽窗写人选的那份），再拉窄。 */
function start(surface: AgentFormSurface, stored: Stored): string | null {
  useAgentFormViewStore.setState(useAgentFormViewStore.getInitialState(), true)
  useAgentFormStore.setState(useAgentFormStore.getInitialState(), true)
  const prefs = stored === 'ball' ? { collapsed: true } : { placement: stored, collapsed: false }
  useAgentFormStore.setState((state) => ({ bySurface: { ...state.bySurface, [surface]: { ...state.bySurface[surface], ...prefs } } }))
  setAgentWindowNarrow(true, { animate: false })
  return persisted()
}

const steps = ['open', 'collapse', 'machineBall', 'machineOpen', 'machineRelease', 'cross'] as const
function run(step: (typeof steps)[number], surface: AgentFormSurface): void {
  if (step === 'open') openAgent(surface)
  if (step === 'collapse') collapseAgent(surface)
  if (step === 'machineBall') machineHold(surface, 'ball')
  if (step === 'machineOpen') machineHold(surface, 'open')
  if (step === 'machineRelease') machineRelease(surface)
  if (step === 'cross') { setAgentWindowNarrow(false); setAgentWindowNarrow(true) }
}

beforeEach(() => saved.clear())

describe('不变量：窄窗档里除了明确选摆法，存档逐字相等；拉宽回来是自己存的样子', () => {
  for (const surface of ['creation', 'generation'] as AgentFormSurface[]) {
    for (const stored of ['ball', 'float', 'dock'] as Stored[]) {
      it(`${surface} 存着 ${stored}：6 种动作取 3 下的全部排列（216 条序列）`, () => {
        const wideShown: AgentForm = stored
        for (const a of steps) for (const b of steps) for (const c of steps) {
          const before = start(surface, stored)
          run(a, surface); run(b, surface); run(c, surface)
          expect(persisted(), `${a} → ${b} → ${c}`).toBe(before)
          setAgentWindowNarrow(false)
          expect(shownForm(surface), `${a} → ${b} → ${c} 后拉宽`).toBe(wideShown)
        }
      })
    }
  }
})

describe('宽窗：机器让位只改此刻，回来后是人存的样子', () => {
  for (const stored of ['ball', 'float', 'dock'] as Stored[]) {
    it(`存着 ${stored}：让开 → 回来；摆出来 → 回来，存档逐字相等`, () => {
      const before = start('generation', stored)
      setAgentWindowNarrow(false, { animate: false })
      machineHold('generation', 'ball')
      expect(shownForm('generation')).toBe('ball')
      machineRelease('generation')
      expect(shownForm('generation')).toBe(stored)
      machineHold('generation', 'open')
      expect(shownForm('generation')).toBe(stored === 'ball' ? 'float' : stored)
      machineRelease('generation')
      expect(shownForm('generation')).toBe(stored)
      expect(persisted()).toBe(before)
    })
  }
})
