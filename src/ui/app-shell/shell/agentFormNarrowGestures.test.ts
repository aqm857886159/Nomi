// 不变量（约束 narrow.display-only，WindowNarrow 板 D2，用户 2026-11-07）：窄窗档里除了明确「选摆法」那一下，
// 人点开 / 收起、机器让开 / 回来、跨阈值来回，存下的东西前后逐字相等；拉宽回来，这一页是自己存的样子。
// 这里只用 store 对外的动作（不抄调用方逻辑）；真组件入口 × 每种存法 × 每个手势的全表在 ShellAgentHost.formProbe.test.tsx。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_FORM_STORAGE_KEY,
  collapseAgent,
  machineHold,
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

type Stored = 'collapsed' | 'float' | 'dock'

/** 从宽窗起，人把这一页摆成某个样子（宽窗写人选的那份），再拉窄。 */
function start(surface: AgentFormSurface, stored: Stored): string | null {
  useAgentFormViewStore.setState(useAgentFormViewStore.getInitialState(), true)
  useAgentFormStore.setState(useAgentFormStore.getInitialState(), true)
  const prefs = stored === 'collapsed' ? { collapsed: true } : { placement: stored, collapsed: false }
  useAgentFormStore.setState((state) => ({ bySurface: { ...state.bySurface, [surface]: { ...state.bySurface[surface], ...prefs } } }))
  setAgentWindowNarrow(true, { animate: false })
  return persisted()
}

const steps = ['open', 'collapse', 'machineCollapse', 'machineOpen', 'cross'] as const
function run(step: (typeof steps)[number], surface: AgentFormSurface): void {
  if (step === 'open') openAgent(surface)
  if (step === 'collapse') collapseAgent(surface)
  if (step === 'machineCollapse') machineHold(surface, 'collapsed')
  if (step === 'machineOpen') machineHold(surface, 'open')
  if (step === 'cross') { setAgentWindowNarrow(false); setAgentWindowNarrow(true) }
}

beforeEach(() => saved.clear())

describe('不变量：窄窗档里除了明确选摆法，存档逐字相等；拉宽回来是自己存的样子', () => {
  for (const surface of ['creation', 'generation'] as AgentFormSurface[]) {
    for (const stored of ['collapsed', 'float', 'dock'] as Stored[]) {
      it(`${surface} 存着 ${stored}：5 种动作取 3 下的全部排列（125 条序列）`, () => {
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

describe('宽窗：机器让位只改此刻，让位结束（跨窗宽）后是人存的样子', () => {
  // 机器让位没有「机器自己撤」这一条路：结束只靠人的动作、跨窗宽、离开项目、关掉重开（人的动作那几格在探针表里）。
  const crossAndBack = (): void => { setAgentWindowNarrow(true); setAgentWindowNarrow(false) }
  for (const stored of ['collapsed', 'float', 'dock'] as Stored[]) {
    it(`存着 ${stored}：让开 → 跨窗宽来回；摆出来 → 跨窗宽来回，存档逐字相等`, () => {
      const before = start('generation', stored)
      setAgentWindowNarrow(false, { animate: false })
      machineHold('generation', 'collapsed')
      expect(shownForm('generation')).toBe('collapsed')
      crossAndBack()
      expect(shownForm('generation')).toBe(stored)
      machineHold('generation', 'open')
      expect(shownForm('generation')).toBe(stored === 'collapsed' ? 'float' : stored)
      crossAndBack()
      expect(shownForm('generation')).toBe(stored)
      expect(persisted()).toBe(before)
    })
  }
})
