// Nomi 三形态的常驻探针（方向检查 docs/engineering/direction-checks/2026-11-14-agent-form-shown-vs-stored.md 第 3 节、文末两份清单）。
// 挂真的外壳、点真按钮、按真快捷键、拨真窗宽、切页、重开，读外壳画出来的形态。
import './agentFormProbe.globals'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-rnd', () => ({ Rnd: ({ children }: { children?: unknown }) => children ?? null }))
vi.mock('react-reverse-portal', () => ({
  createHtmlPortalNode: () => ({}),
  InPortal: ({ children }: { children?: unknown }) => children ?? null,
  OutPortal: () => null,
}))
// 门户落点（停靠栏 / 隐藏容器）和这张表无关：就地画出来，层上的 data-agent-form 照样是外壳此刻的形态。
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), createPortal: (children: unknown) => children }))
vi.mock('./useAgentBallEyeFollow', () => ({ useAgentBallEyeFollow: () => undefined }))
vi.mock('../../../design', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const Pass = ({ children }: { children?: unknown }) => children ?? null
  return {
    ...actual,
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent: () => null,
    TooltipProvider: Pass,
    NomiAgentFace: () => null,
    // 小球右键菜单：开着时把每一项摆成一颗按钮（点它 = 选这一项）。
    WorkbenchMenu: ({ open, items }: { open: boolean; items: { id: string; disabled?: boolean; onSelect: () => void }[] }) => (open
      ? React.createElement(React.Fragment, null, ...items.map((item) => React.createElement('button', { key: item.id, 'data-probe-menu-item': item.id, disabled: item.disabled, onClick: item.disabled ? undefined : item.onSelect })))
      : null),
  }
})

import { PROBE_SURFACES, bootProbe, type OldForm, type Probe, type Shown } from './agentFormProbe.testkit'
import { machineHold, machineRelease, type AgentFormSurface } from './agentFormStore'

let probe: Probe | null = null
afterEach(() => { probe?.close(); probe = null })

/** 从创作页面板里点「参考」去画布挑图时，外壳这一侧做的事：ProjectAgentResidentShell 的 pickReferenceOnCanvas 只调这一个动作（结构测试钉住）。 */
function pickReferenceOnCanvas(p: Probe): void {
  machineHold('generation', 'open')
  p.goto('generation')
}

describe('没钉住的三条（方向检查第 3 节）：写成期望行为', () => {
  it('预测 1a · 窄窗里创作页点开，生成页没点不跟着开', async () => {
    probe = await bootProbe({ forms: { creation: 'ball', generation: 'ball' }, narrow: true, page: 'creation' })
    expect(probe.clickBall()).toBe(true)
    expect(probe.shown()).toBe('float')
    probe.goto('generation')
    expect(probe.shown()).toBe('ball')
  })

  it('预测 1b · 窄窗里生成页（存浮窗）收起，创作页（存浮窗）没点不跟着收', async () => {
    probe = await bootProbe({ forms: { creation: 'float', generation: 'float' }, narrow: true, page: 'generation' })
    expect(probe.shown()).toBe('float')
    probe.key('\\')
    expect(probe.shown()).toBe('ball')
    probe.goto('creation')
    expect(probe.shown()).toBe('float')
  })

  for (const creation of ['dock', 'ball', 'float'] as const) {
    it(`预测 2 · 窄窗里生成页被收成小球、从创作页（存${creation}）去挑参考图：生成页的 Nomi 叫得出来`, async () => {
      probe = await bootProbe({ forms: { creation, generation: 'float' }, narrow: true, page: 'generation' })
      probe.key('\\')
      expect(probe.shown()).toBe('ball')
      probe.goto('creation')
      probe.clickBall()
      expect(probe.shown()).not.toBe('ball')
      pickReferenceOnCanvas(probe)
      expect(probe.shown()).not.toBe('ball')
    })
  }

  it('预测 3 · 宽窗里创作页选浮窗、收起、再点开：回到浮窗', async () => {
    probe = await bootProbe({ forms: { creation: 'dock' }, narrow: false, page: 'creation' })
    expect(probe.choose('float')).toBe(true)
    expect(probe.shown()).toBe('float')
    expect(probe.choose('ball')).toBe(true)
    expect(probe.shown()).toBe('ball')
    expect(probe.clickBall()).toBe(true)
    expect(probe.shown()).toBe('float')
  })
})

// ── 探针表：窗宽 × 页 × 旧存档三值 × 人的手势，之后切页 / 跨阈值 / 重开 ────────────────────────────────
// 期望逐格写死（不在测试里再算一遍）。'D' = 这一页的默认摆法：生成页浮窗、其余停靠（旧存档存小球的页迁成「收着 + 默认摆法」）。
// ⌘\ 是「停靠 ↔ 小球」（concept-owners/shell.recall-entry）：宽窗从小球按它是人选停靠；窄窗档停靠放不下，只是点开。

type Gesture = 'clickBall' | 'ballMenuFloat' | 'modJ' | 'modBackslash' | 'openCollapse' | 'openChooseFloat' | 'openMoreBall' | 'openMoreFloat' | 'recall'
type Cell = Shown | 'D'
const GESTURES: Gesture[] = ['clickBall', 'ballMenuFloat', 'modJ', 'modBackslash', 'openCollapse', 'openChooseFloat', 'openMoreBall', 'openMoreFloat', 'recall']
/** 选了摆法的手势（窄窗档里只有它们写存档：写摆法）。 */
const PLACEMENT_GESTURES = new Set<Gesture>(['ballMenuFloat', 'openChooseFloat', 'openMoreFloat'])

function play(p: Probe, gesture: Gesture): void {
  const openFirst = () => { if (p.shown() === 'ball') p.clickBall() }
  switch (gesture) {
    case 'clickBall': p.clickBall(); return
    case 'ballMenuFloat': p.ballMenu('float'); return
    case 'modJ': p.key('j'); return
    case 'modBackslash': p.key('\\'); return
    case 'openCollapse': openFirst(); p.choose('ball'); return
    case 'openChooseFloat': openFirst(); p.choose('float'); return
    case 'openMoreBall': openFirst(); p.more('ball'); return
    case 'openMoreFloat': openFirst(); p.more('float'); return
    case 'recall': p.recall(); return
  }
}

/** 手势之后此刻显示的。 */
const AFTER: Record<'wide' | 'narrow', Record<OldForm, Record<Gesture, Cell>>> = {
  wide: {
    dock: { clickBall: 'dock', ballMenuFloat: 'dock', modJ: 'dock', modBackslash: 'ball', openCollapse: 'ball', openChooseFloat: 'float', openMoreBall: 'ball', openMoreFloat: 'float', recall: 'dock' },
    ball: { clickBall: 'D', ballMenuFloat: 'float', modJ: 'D', modBackslash: 'dock', openCollapse: 'ball', openChooseFloat: 'float', openMoreBall: 'ball', openMoreFloat: 'float', recall: 'D' },
    float: { clickBall: 'float', ballMenuFloat: 'float', modJ: 'float', modBackslash: 'ball', openCollapse: 'ball', openChooseFloat: 'float', openMoreBall: 'ball', openMoreFloat: 'float', recall: 'float' },
  },
  narrow: {
    dock: { clickBall: 'float', ballMenuFloat: 'float', modJ: 'float', modBackslash: 'float', openCollapse: 'ball', openChooseFloat: 'float', openMoreBall: 'ball', openMoreFloat: 'float', recall: 'float' },
    ball: { clickBall: 'float', ballMenuFloat: 'float', modJ: 'float', modBackslash: 'float', openCollapse: 'ball', openChooseFloat: 'float', openMoreBall: 'ball', openMoreFloat: 'float', recall: 'float' },
    float: { clickBall: 'float', ballMenuFloat: 'float', modJ: 'float', modBackslash: 'ball', openCollapse: 'ball', openChooseFloat: 'float', openMoreBall: 'ball', openMoreFloat: 'float', recall: 'float' },
  },
}

/** 窄窗里做完手势再拉宽：宽窗显示的是存下的那个（窄窗里只有选摆法写了摆法，开没开一律没写）。 */
const NARROW_THEN_WIDE: Record<OldForm, Record<Gesture, Cell>> = {
  dock: { clickBall: 'dock', ballMenuFloat: 'float', modJ: 'dock', modBackslash: 'dock', openCollapse: 'dock', openChooseFloat: 'float', openMoreBall: 'dock', openMoreFloat: 'float', recall: 'dock' },
  ball: { clickBall: 'ball', ballMenuFloat: 'ball', modJ: 'ball', modBackslash: 'ball', openCollapse: 'ball', openChooseFloat: 'ball', openMoreBall: 'ball', openMoreFloat: 'ball', recall: 'ball' },
  float: { clickBall: 'float', ballMenuFloat: 'float', modJ: 'float', modBackslash: 'float', openCollapse: 'float', openChooseFloat: 'float', openMoreBall: 'float', openMoreFloat: 'float', recall: 'float' },
}

/** 窄窗里做完手势、关掉再开（还是窄窗）：只剩存下的那份。 */
const NARROW_RELAUNCH: Record<OldForm, Record<Gesture, Cell>> = {
  dock: { clickBall: 'ball', ballMenuFloat: 'float', modJ: 'ball', modBackslash: 'ball', openCollapse: 'ball', openChooseFloat: 'float', openMoreBall: 'ball', openMoreFloat: 'float', recall: 'ball' },
  ball: { clickBall: 'ball', ballMenuFloat: 'ball', modJ: 'ball', modBackslash: 'ball', openCollapse: 'ball', openChooseFloat: 'ball', openMoreBall: 'ball', openMoreFloat: 'ball', recall: 'ball' },
  float: { clickBall: 'float', ballMenuFloat: 'float', modJ: 'float', modBackslash: 'float', openCollapse: 'float', openChooseFloat: 'float', openMoreBall: 'float', openMoreFloat: 'float', recall: 'float' },
}

/** 宽窗手势之后拉窄：停靠放不下 = 小球；浮窗、小球照旧。 */
const narrowOf = (shown: Shown): Shown => (shown === 'dock' ? 'ball' : shown)
const resolve = (cell: Cell, surface: AgentFormSurface): Shown => (cell === 'D' ? (surface === 'generation' ? 'float' : 'dock') : cell)

/** 窄窗里哪几格写存档：只有选浮窗、且存下的摆法本来不是浮窗（存小球的生成页默认摆法就是浮窗，一个字节不写）。 */
function narrowWrites(stored: OldForm, gesture: Gesture, surface: AgentFormSurface): boolean {
  if (!PLACEMENT_GESTURES.has(gesture)) return false
  if (stored === 'float') return false
  if (stored === 'ball') return surface !== 'generation'
  return true
}

const STORED_CYCLE: OldForm[] = ['dock', 'ball', 'float']

describe('常驻探针表（窗宽 × 页 × 旧存档 × 手势）', () => {
  for (const width of ['wide', 'narrow'] as const) {
    for (const surface of PROBE_SURFACES) {
      for (const stored of STORED_CYCLE) {
        for (const gesture of GESTURES) {
          const label = `${width} · ${surface} 存 ${stored} · ${gesture}`
          const others = PROBE_SURFACES.filter((page) => page !== surface)
          // 别的页存的各不相同（三值轮着摆），串页从哪个方向来都看得见。
          const forms = Object.fromEntries(PROBE_SURFACES.map((page, index) => [page, page === surface ? stored : STORED_CYCLE[index % 3]])) as Record<AgentFormSurface, OldForm>

          it(`${label} → 此刻、别的页、存档、跨阈值`, async () => {
            probe = await bootProbe({ forms, narrow: width === 'narrow', page: surface })
            const before: Record<string, Shown> = {}
            for (const page of others) { probe.goto(page); before[page] = probe.shown() }
            probe.goto(surface)
            const disk = probe.disk()
            play(probe, gesture)
            const after = resolve(AFTER[width][stored][gesture], surface)
            expect(probe.shown(), '手势之后此刻').toBe(after)
            if (width === 'narrow') expect(probe.disk() === disk, '窄窗档只有选摆法写存档').toBe(!narrowWrites(stored, gesture, surface))
            for (const page of others) {
              probe.goto(page)
              expect(probe.shown(), `切到 ${page}：别的页没被这一下带动`).toBe(before[page])
            }
            probe.goto(surface)
            expect(probe.shown(), '切回来还是手势之后的样子').toBe(after)
            probe.resize(width === 'wide')
            const crossed = width === 'narrow' ? resolve(NARROW_THEN_WIDE[stored][gesture], surface) : narrowOf(after)
            expect(probe.shown(), width === 'narrow' ? '拉宽：回到存下的样子' : '拉窄').toBe(crossed)
          })

          it(`${label} → 关掉再开`, async () => {
            probe = await bootProbe({ forms, narrow: width === 'narrow', page: surface })
            play(probe, gesture)
            await probe.relaunch()
            const expected = width === 'wide' ? resolve(AFTER.wide[stored][gesture], surface) : resolve(NARROW_RELAUNCH[stored][gesture], surface)
            expect(probe.shown()).toBe(expected)
          })
        }
      }
    }
  }

  it('宽窗收起再点开回到上次选的摆法：每页 × 两种摆法 × 三种收法（形态切换、「⋯」、⌘\\）× 两种开法（点小球、⌘J）；⌘\\ 从小球是选停靠', async () => {
    for (const surface of PROBE_SURFACES) {
      for (const placement of ['float', 'dock'] as const) {
        for (const collapse of ['switch', 'more', 'key'] as const) {
          for (const open of ['ball', 'j', 'key'] as const) {
            probe?.close()
            probe = await bootProbe({ forms: { [surface]: 'dock' }, narrow: false, page: surface })
            probe.choose(placement)
            if (collapse === 'switch') probe.choose('ball')
            if (collapse === 'more') probe.more('ball')
            if (collapse === 'key') probe.key('\\')
            expect(probe.shown()).toBe('ball')
            if (open === 'ball') probe.clickBall()
            if (open === 'j') probe.key('j')
            if (open === 'key') probe.key('\\')
            expect(probe.shown(), `${surface} ${placement} ${collapse} ${open}`).toBe(open === 'key' ? 'dock' : placement)
          }
        }
      }
    }
  })
})

// ── 机器的让位：只写此刻显示，不改人存的 ─────────────────────────────────────────────────────────

describe('机器的让位（挑参考图摆出来、指向节点让开 / 回来）不改人存的', () => {
  for (const width of ['wide', 'narrow'] as const) {
    for (const generation of STORED_CYCLE) {
      it(`${width} · 生成页存 ${generation} · 从创作页去挑参考图：生成页的 Nomi 摆出来，存档一个字节不改，重开回到存下的`, async () => {
        probe = await bootProbe({ forms: { creation: 'dock', generation }, narrow: width === 'narrow', page: 'creation' })
        probe.goto('generation')
        const natural = probe.shown()
        probe.goto('creation')
        const disk = probe.disk()
        pickReferenceOnCanvas(probe)
        expect(probe.shown()).not.toBe('ball')
        expect(probe.disk()).toBe(disk)
        await probe.relaunch()
        expect(probe.shown()).toBe(natural)
      })
    }
  }

  it('宽窗：生成页开着浮窗，指向节点让开 → 小球；回到对话 → 浮窗；存档一个字节不改', async () => {
    probe = await bootProbe({ forms: { generation: 'float' }, narrow: false, page: 'generation' })
    const disk = probe.disk()
    machineHold('generation', 'ball')
    probe.settle()
    expect(probe.shown()).toBe('ball')
    machineRelease('generation')
    probe.settle()
    expect(probe.shown()).toBe('float')
    expect(probe.disk()).toBe(disk)
  })

  it('窄窗：存停靠的页人点开（此刻浮窗）→ 让开 → 回到对话：回到人点出来的浮窗，不是存下的小球', async () => {
    probe = await bootProbe({ forms: { generation: 'dock' }, narrow: true, page: 'generation' })
    probe.clickBall()
    expect(probe.shown()).toBe('float')
    machineHold('generation', 'ball')
    probe.settle()
    expect(probe.shown()).toBe('ball')
    machineRelease('generation')
    probe.settle()
    expect(probe.shown()).toBe('float')
  })

  it('让开之后人自己点小球：人的动作赢；宽窗里存的本来就是开着，一个字节不写', async () => {
    probe = await bootProbe({ forms: { generation: 'float' }, narrow: false, page: 'generation' })
    const disk = probe.disk()
    machineHold('generation', 'ball')
    probe.settle()
    probe.clickBall()
    expect(probe.shown()).toBe('float')
    expect(probe.disk()).toBe(disk)
  })

  it('让开期间跨阈值：让位作废，回到自己存的样子', async () => {
    probe = await bootProbe({ forms: { generation: 'float' }, narrow: false, page: 'generation' })
    machineHold('generation', 'ball')
    probe.settle()
    probe.resize(true)
    expect(probe.shown()).toBe('float')
  })
})
