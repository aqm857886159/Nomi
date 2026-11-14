// 窄窗档里人的每一下点击 × 每种存下的形态（独立验收 2026-11-14 查出：存着小球、窄窗里点开再收起，存档被写成「停靠」）。
// 约束 narrow.display-only（WindowNarrow 板 D2，用户 2026-11-07）：窄窗里点开、收起只改「这一刻怎么摆」，
// 除了形态切换里明确选的那一下，存下的形态前后逐字相等。宽窗的同一组手势也钉在这里——宽窗行为一格不许变。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readEffectiveAgentForm, useAgentFormStore, type AgentForm, type AgentFormSurface } from './agentFormStore'

const STORAGE_KEY = 'nomi:shell-agent-form:v1'

// 测试环境是 node（无 jsdom）：在模块导入前装一个最小 localStorage，persist 才真的落盘，才量得到「存档逐字相等」。
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

const persisted = (): string | null => saved.get(STORAGE_KEY) ?? null
const store = () => useAgentFormStore.getState()
const stored = (surface: AgentFormSurface): AgentForm => store().bySurface[surface].form
const shown = (surface: AgentFormSurface): AgentForm => readEffectiveAgentForm(surface)

/** 和 ShellAgentHost 的 openFormFor 同一张表：生成页点开是浮窗，其余是停靠。 */
const openFormFor = (surface: AgentFormSurface): AgentForm => (surface === 'generation' ? 'float' : 'dock')

// 每个手势照调用方真实的写法（ShellAgentHost / revealNodeFromChat）在 store 层重放。
const gesture = {
  /** 点小球（小球显示时才有这颗球可点）。 */
  open: (s: AgentFormSurface) => { if (shown(s) === 'ball') store().requestForm(s, openFormFor(s)) },
  /** 面板头部形态切换里点「缩成小球」= 收起。 */
  collapse: (s: AgentFormSurface) => store().chooseForm(s, 'ball'),
  /** ⌘J：小球时打开，否则只聚焦。 */
  modJ: (s: AgentFormSurface) => { if (shown(s) === 'ball') store().requestForm(s, openFormFor(s)) },
  /** Mod+\：小球 ↔ 打开。 */
  modBackslash: (s: AgentFormSurface) => store().requestForm(s, shown(s) === 'ball' ? 'dock' : 'ball'),
  /** 别处叫回（任务中心「定位到制作」等）。 */
  recall: (s: AgentFormSurface) => { if (shown(s) === 'ball') store().requestForm(s, openFormFor(s)) },
  /** 小球右键「浮窗」。 */
  ballMenuFloat: (s: AgentFormSurface) => { if (shown(s) === 'ball') store().requestForm(s, 'float') },
  /** 指向节点时对话挡住画布：收成小球。 */
  pointerCollapse: (s: AgentFormSurface) => { if (shown(s) !== 'ball') store().requestForm(s, 'ball') },
  widen: () => store().setWindowNarrow(false),
  narrow: () => store().setWindowNarrow(true),
  /** 关掉应用再开（窄窗里）：只剩落盘那份，会话态全回初始。 */
  relaunchNarrow: async () => {
    // 换回初始态那一下 persist 会把初始值写回存档：先留住磁盘上那份，换完再放回去、从它重新读。
    const disk = persisted()
    useAgentFormStore.setState(useAgentFormStore.getInitialState(), true)
    if (disk === null) saved.delete(STORAGE_KEY)
    else saved.set(STORAGE_KEY, disk)
    await useAgentFormStore.persist.rehydrate()
    store().setWindowNarrow(true, { animate: false })
  },
}

async function start(surface: AgentFormSurface, form: AgentForm, narrow: boolean): Promise<string | null> {
  useAgentFormStore.setState(useAgentFormStore.getInitialState(), true)
  store().setForm(surface, form)
  store().setWindowNarrow(narrow, { animate: false })
  return persisted()
}

beforeEach(() => saved.clear())
afterEach(async () => { await start('creation', 'dock', false) })

const SURFACES: AgentFormSurface[] = ['creation', 'generation']
const FORMS: AgentForm[] = ['dock', 'ball', 'float']

type Cell = { shown: AgentForm; stored: AgentForm }
type Row = Record<'open' | 'openCollapse' | 'openWiden' | 'openCollapseWiden' | 'modJCycle' | 'relaunch', Cell>

/** 窄窗表：存下的形态只在「存着浮窗、人在形态切换里明确选了小球」那一下变（照今天，存着浮窗窄窗里就是真浮窗）。 */
function narrowRow(form: AgentForm): Row {
  const keep = (shownForm: AgentForm): Cell => ({ shown: shownForm, stored: form })
  if (form === 'float') {
    return {
      open: keep('float'),
      openCollapse: { shown: 'ball', stored: 'ball' },
      openWiden: keep('float'),
      openCollapseWiden: { shown: 'ball', stored: 'ball' },
      modJCycle: keep('ball'),
      relaunch: keep('float'),
    }
  }
  return {
    open: keep('float'),
    openCollapse: keep('ball'),
    openWiden: keep(form),
    openCollapseWiden: keep(form),
    modJCycle: keep('ball'),
    relaunch: keep('ball'),
  }
}

async function play(surface: AgentFormSurface, column: keyof Row): Promise<void> {
  switch (column) {
    case 'open': gesture.open(surface); return
    case 'openCollapse': gesture.open(surface); gesture.collapse(surface); return
    case 'openWiden': gesture.open(surface); gesture.widen(); return
    case 'openCollapseWiden': gesture.open(surface); gesture.collapse(surface); gesture.widen(); return
    case 'modJCycle': gesture.modJ(surface); gesture.modBackslash(surface); return
    case 'relaunch': gesture.open(surface); await gesture.relaunchNarrow(); return
  }
}

describe('窄窗档：点开 / 收起只改此刻怎么摆，不写存档', () => {
  for (const surface of SURFACES) {
    for (const form of FORMS) {
      const row = narrowRow(form)
      for (const column of Object.keys(row) as (keyof Row)[]) {
        it(`${surface} 存着 ${form} · ${column} → 显示 ${row[column].shown}、存档 ${row[column].stored}`, async () => {
          const before = await start(surface, form, true)
          await play(surface, column)
          expect({ shown: shown(surface), stored: stored(surface) }).toEqual(row[column])
          if (row[column].stored === form) expect(persisted()).toBe(before)
        })
      }
    }
  }

  it('存着小球、窄窗里点开：显示成浮窗（点小球有反应）', async () => {
    await start('creation', 'ball', true)
    gesture.open('creation')
    expect(shown('creation')).toBe('float')
  })
})

/**
 * 不变量：窄窗档里任意几下「非形态切换」的手势，存下的形态前后逐字相等。
 * 每种起点 × 7 种手势取 3 下的全部排列（343 条序列），中间夹一次拉宽再拉窄也一样。
 */
describe('不变量：窄窗档里除了形态切换明确选的那一下，存档逐字相等', () => {
  const steps = ['open', 'modJ', 'modBackslash', 'recall', 'ballMenuFloat', 'pointerCollapse', 'cross'] as const
  const run = (step: (typeof steps)[number], surface: AgentFormSurface) => {
    if (step === 'cross') { gesture.widen(); gesture.narrow(); return }
    gesture[step](surface)
  }
  for (const surface of SURFACES) {
    for (const form of FORMS) {
      it(`${surface} 存着 ${form}`, async () => {
        for (const a of steps) for (const b of steps) for (const c of steps) {
          const before = await start(surface, form, true)
          run(a, surface); run(b, surface); run(c, surface)
          expect(persisted(), `${a} → ${b} → ${c}`).toBe(before)
          gesture.widen()
          expect(shown(surface), `${a} → ${b} → ${c} 后拉宽`).toBe(form)
        }
      })
    }
  }
})

/** 宽窗：requestForm / chooseForm 都直接写形态（今天的行为，一格不许变）。 */
describe('宽窗：同一组手势照常写形态（钉住今天的行为）', () => {
  type WideColumn = 'open' | 'openCollapse' | 'modJ' | 'modBackslashTwice' | 'collapseThenOpen'
  // [起点] → 每列之后的存档（宽窗里显示 = 存档）。
  const wide: Record<AgentFormSurface, Partial<Record<AgentForm, Record<WideColumn, AgentForm>>>> = {
    creation: {
      dock: { open: 'dock', openCollapse: 'ball', modJ: 'dock', modBackslashTwice: 'dock', collapseThenOpen: 'dock' },
      ball: { open: 'dock', openCollapse: 'ball', modJ: 'dock', modBackslashTwice: 'ball', collapseThenOpen: 'dock' },
      float: { open: 'float', openCollapse: 'ball', modJ: 'float', modBackslashTwice: 'dock', collapseThenOpen: 'dock' },
    },
    generation: {
      dock: { open: 'dock', openCollapse: 'ball', modJ: 'dock', modBackslashTwice: 'dock', collapseThenOpen: 'float' },
      ball: { open: 'float', openCollapse: 'ball', modJ: 'float', modBackslashTwice: 'ball', collapseThenOpen: 'float' },
      float: { open: 'float', openCollapse: 'ball', modJ: 'float', modBackslashTwice: 'dock', collapseThenOpen: 'float' },
    },
    storyboard: {},
    preview: {},
  }
  for (const surface of SURFACES) {
    for (const form of FORMS) {
      const row = wide[surface][form]!
      for (const column of Object.keys(row) as WideColumn[]) {
        it(`${surface} 存着 ${form} · ${column} → ${row[column]}`, async () => {
          await start(surface, form, false)
          if (column === 'open') gesture.open(surface)
          if (column === 'openCollapse') { gesture.open(surface); gesture.collapse(surface) }
          if (column === 'modJ') gesture.modJ(surface)
          if (column === 'modBackslashTwice') { gesture.modBackslash(surface); gesture.modBackslash(surface) }
          if (column === 'collapseThenOpen') { gesture.collapse(surface); gesture.open(surface) }
          expect(stored(surface)).toBe(row[column])
          expect(shown(surface)).toBe(row[column])
        })
      }
    }
  }

  it('宽窗形态切换：选什么存什么', async () => {
    await start('creation', 'dock', false)
    for (const form of ['float', 'ball', 'dock'] as const) {
      store().chooseForm('creation', form)
      expect(stored('creation')).toBe(form)
    }
  })
})
