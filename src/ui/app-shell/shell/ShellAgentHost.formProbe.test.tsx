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

// 生成页画布那一格的「回到对话」（NodePointerReturnDock，真组件）里那颗按钮：换成一颗点了走真 returnToChat 的按钮，
// 挂上 / 摘下记数——「那一枚在不在」量的是真 dock 此刻画没画它。
const returnButton = vi.hoisted(() => ({ live: 0 }))
vi.mock('../../../workbench/ai/pointer/NodePointerGroup', async () => {
  const ReactModule = await import('react')
  const { returnToChat } = await import('../../../workbench/ai/pointer/revealNodeFromChat')
  const { useNodePointerStore } = await import('../../../workbench/ai/pointer/nodePointerStore')
  function NodePointerReturnToChat(): React.ReactElement | null {
    const target = useNodePointerStore((state) => state.returnTo)
    ReactModule.useEffect(() => {
      if (!target) return undefined
      returnButton.live += 1
      return () => { returnButton.live -= 1 }
    }, [target])
    return target ? ReactModule.createElement('button', { 'data-node-pointer-return': 'true', onClick: returnToChat }) : null
  }
  return { NodePointerReturnToChat }
})

import { PROBE_SURFACES, bootProbe, type OldForm, type Probe, type Shown } from './agentFormProbe.testkit'
import { machineHold, type AgentFormSurface } from './agentFormStore'
import { NodePointerReturnDock } from '../../../workbench/ai/pointer/NodePointerReturnDock'
import { useNodePointerStore } from '../../../workbench/ai/pointer/nodePointerStore'
import { yieldChatToCanvas } from '../../../workbench/ai/pointer/revealNodeFromChat'

let probe: Probe | null = null
afterEach(() => {
  probe?.close()
  probe = null
  useNodePointerStore.setState({ locatedNodeId: null, returnTo: null })
})

/** 生成页画布那一格里和外壳一起挂着的真「回到对话」。 */
const withReturnDock = (page: AgentFormSurface): React.ReactElement | null => (page === 'generation' ? React.createElement(NodePointerReturnDock, { surface: 'generation' }) : null)
const returnDockShown = (): boolean => returnButton.live > 0
const clickReturn = (p: Probe): void => p.clickWhere((props) => props['data-node-pointer-return'] === 'true', '回到对话')

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

describe('独立验收查出的三条（先钉现状）', () => {
  it('① 窄窗点开 → 指向让开 → 拉宽：那一枚跟着消失、显示存的样子（存收着 = 小球），点小球打开到上次选的摆法', async () => {
    probe = await bootProbe({ forms: { generation: 'ball' }, narrow: true, page: 'generation', alongside: withReturnDock })
    expect(probe.clickBall()).toBe(true)
    expect(probe.shown()).toBe('float')
    yieldChatToCanvas({ surface: 'generation', nodeId: 'n1', label: '镜 01' })
    probe.settle()
    expect(probe.shown()).toBe('ball')
    expect(returnDockShown()).toBe(true)
    probe.resize(false)
    expect(probe.shown(), '拉宽：显示存的样子').toBe('ball')
    expect(returnDockShown(), '拉宽：让位结束，那一枚跟着消失').toBe(false)
    expect(probe.clickBall()).toBe(true)
    expect(probe.shown()).toBe('float')
  })

  it('① 补格 · 让位还在时（没跨窗宽）点「回到对话」：对话回来、那一枚消失', async () => {
    probe = await bootProbe({ forms: { generation: 'ball' }, narrow: true, page: 'generation', alongside: withReturnDock })
    probe.clickBall()
    yieldChatToCanvas({ surface: 'generation', nodeId: 'n1', label: '镜 01' })
    probe.settle()
    clickReturn(probe)
    expect(probe.shown()).toBe('float')
    expect(returnDockShown()).toBe(false)
  })

  for (const surface of PROBE_SURFACES) {
    it(`② 宽窗 · ${surface} 选浮窗 → 收起 → ⌘\\：是浮窗，存的摆法没变`, async () => {
      probe = await bootProbe({ forms: { [surface]: 'dock' }, narrow: false, page: surface })
      probe.choose('float')
      probe.choose('ball')
      expect(probe.shown()).toBe('ball')
      const disk = probe.disk()
      probe.key('\\')
      expect(probe.shown()).toBe('float')
      expect(JSON.parse(probe.disk()!).state.bySurface[surface].placement).toBe('float')
      expect(JSON.parse(disk!).state.bySurface[surface].placement).toBe('float')
    })
  }
})

describe('③ 新格式存档坏了：外壳照样画得出来（四种坏法 × 坏在哪一页 × 停在哪一页）', () => {
  const good = { placement: 'float', collapsed: false, float: null, ball: null }
  const blobs: Record<string, (bad: AgentFormSurface) => string> = {
    'missing-page': (bad) => JSON.stringify({ state: { bySurface: Object.fromEntries(PROBE_SURFACES.filter((s) => s !== bad).map((s) => [s, good])) }, version: 2 }),
    'unknown-values': (bad) => JSON.stringify({ state: { bySurface: Object.fromEntries(PROBE_SURFACES.map((s) => [s, s === bad ? { ...good, placement: 'sidebar', collapsed: 'yes' } : good])) }, version: 2 }),
    'non-number-geometry': (bad) => JSON.stringify({ state: { bySurface: Object.fromEntries(PROBE_SURFACES.map((s) => [s, s === bad ? { ...good, float: { x: 'a', y: 1, width: 300, height: null }, ball: { x: '3', y: 4 } } : good])) }, version: 2 }),
    'not-an-object': () => JSON.stringify({ state: { bySurface: 'broken' }, version: 2 }),
  }
  for (const [kind, make] of Object.entries(blobs)) {
    for (const bad of PROBE_SURFACES) {
      it(`${kind} · 坏在 ${bad}`, async () => {
        probe = await bootProbe({ blob: make(bad), narrow: false, page: bad })
        for (const page of PROBE_SURFACES) {
          probe.goto(page)
          expect(['ball', 'float', 'dock'], page).toContain(probe.shown())
        }
      })
    }
  }
})

// ── 探针表：窗宽 × 页 × 旧存档三值 × 人的手势，之后切页 / 跨阈值 / 重开 ────────────────────────────────
// 期望逐格写死（不在测试里再算一遍）。'D' = 这一页的默认摆法：生成页浮窗、其余停靠（旧存档存小球的页迁成「收着 + 默认摆法」）。
// ⌘\ 是「收起 / 展开 Nomi」（concept-owners/shell.recall-entry）：开着收成小球，收着打开到上次选的摆法（和点小球同一个动作）。

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
    ball: { clickBall: 'D', ballMenuFloat: 'float', modJ: 'D', modBackslash: 'D', openCollapse: 'ball', openChooseFloat: 'float', openMoreBall: 'ball', openMoreFloat: 'float', recall: 'D' },
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

  it('宽窗收起再点开回到上次选的摆法：每页 × 两种摆法 × 三种收法（形态切换、「⋯」、⌘\\）× 三种开法（点小球、⌘J、⌘\\）', async () => {
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
            expect(probe.shown(), `${surface} ${placement} ${collapse} ${open}`).toBe(placement)
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

})

// ── 让位期间环境变了（独立验收真问题 1：上一次这张表没有「让位期间跨窗宽」这一列）───────────────────────────
// 两种机器让位（指向让开、挑参考图摆出来）× 让位期间发生的事 × 之后（点「回到对话」/ 不点），生成页，每格断言：
// 此刻显示什么、存档变没变、「回到对话」那一枚在不在。期望逐格写死。
// 让位期间发生的事：none 什么都没发生 · cross 跨窗宽（宽 → 窄 / 窄 → 宽）· page 切到分镜页再切回 · ball 人点小球 ·
// close 人点关闭钮（面板头部收成小球）· relaunch 关掉重开。指向让开时对话是小球、没有关闭钮（close 不适用）；
// 挑参考图时对话开着、没有小球（ball 不适用），所以两种让位各 5 件事。

type Hold = 'pointer' | 'pickRef'
type During = 'none' | 'cross' | 'page' | 'ball' | 'close' | 'relaunch'
const DURING: Record<Hold, During[]> = { pointer: ['none', 'cross', 'page', 'ball', 'relaunch'], pickRef: ['none', 'cross', 'page', 'close', 'relaunch'] }
type HoldCell = { shown: Shown; dock: boolean; diskChanged: boolean }
const cell = (shown: Shown, dock = false, diskChanged = false): HoldCell => ({ shown, dock, diskChanged })

/** 让位期间那件事之后。键：让位 · 窗宽 · 生成页旧存档 · 那件事。 */
const HOLD_AFTER: Record<Hold, Record<'wide' | 'narrow', Record<OldForm, Partial<Record<During, HoldCell>>>>> = {
  pointer: {
    // 宽窗：存小球的先点开（人的动作，记下「开着」，之后才量存档）。
    wide: {
      dock: { none: cell('ball', true), cross: cell('ball'), page: cell('ball', true), ball: cell('dock'), relaunch: cell('dock') },
      ball: { none: cell('ball', true), cross: cell('float'), page: cell('ball', true), ball: cell('float'), relaunch: cell('float') },
      float: { none: cell('ball', true), cross: cell('float'), page: cell('ball', true), ball: cell('float'), relaunch: cell('float') },
    },
    // 窄窗：存停靠 / 小球的先点开（窄窗里点开只改此刻）。拉宽 = 回到存的样子（存小球的就是小球）。
    narrow: {
      dock: { none: cell('ball', true), cross: cell('dock'), page: cell('ball', true), ball: cell('float'), relaunch: cell('ball') },
      ball: { none: cell('ball', true), cross: cell('ball'), page: cell('ball', true), ball: cell('float'), relaunch: cell('ball') },
      float: { none: cell('ball', true), cross: cell('float'), page: cell('ball', true), ball: cell('float'), relaunch: cell('float') },
    },
  },
  pickRef: {
    // 宽窗存停靠 / 浮窗：本来就开着，机器不留覆盖；人点关闭钮就是平常的收起（宽窗记下「收着」）。
    wide: {
      dock: { none: cell('dock'), cross: cell('ball'), page: cell('dock'), close: cell('ball', false, true), relaunch: cell('dock') },
      ball: { none: cell('float'), cross: cell('ball'), page: cell('float'), close: cell('ball'), relaunch: cell('ball') },
      float: { none: cell('float'), cross: cell('float'), page: cell('float'), close: cell('ball', false, true), relaunch: cell('float') },
    },
    narrow: {
      dock: { none: cell('float'), cross: cell('dock'), page: cell('float'), close: cell('ball'), relaunch: cell('ball') },
      ball: { none: cell('float'), cross: cell('ball'), page: cell('float'), close: cell('ball'), relaunch: cell('ball') },
      float: { none: cell('float'), cross: cell('float'), page: cell('float'), close: cell('ball'), relaunch: cell('float') },
    },
  },
}

/** 让位还在、点「回到对话」之后（= 人点开）：此刻显示、那一枚没了、存档不变。 */
const POINTER_RETURN: Record<'wide' | 'narrow', Record<OldForm, Shown>> = {
  wide: { dock: 'dock', ball: 'float', float: 'float' },
  narrow: { dock: 'float', ball: 'float', float: 'float' },
}

async function bootHold(hold: Hold, width: 'wide' | 'narrow', stored: OldForm): Promise<{ p: Probe; disk: string | null }> {
  const p = await bootProbe({ forms: { creation: 'dock', storyboard: 'dock', generation: stored }, narrow: width === 'narrow', page: hold === 'pointer' ? 'generation' : 'creation', alongside: withReturnDock })
  if (hold === 'pointer') {
    p.clickBall()
    expect(p.shown(), '指向之前对话开着').not.toBe('ball')
    const disk = p.disk()
    yieldChatToCanvas({ surface: 'generation', nodeId: 'n1', label: '镜 01' })
    p.settle()
    expect(p.shown(), '指向让开').toBe('ball')
    expect(returnDockShown(), '让开时「回到对话」在').toBe(true)
    return { p, disk }
  }
  const disk = p.disk()
  pickReferenceOnCanvas(p)
  expect(p.shown(), '挑参考图：生成页的 Nomi 开着').not.toBe('ball')
  return { p, disk }
}

async function playDuring(p: Probe, during: During, width: 'wide' | 'narrow'): Promise<void> {
  if (during === 'cross') p.resize(width === 'wide')
  if (during === 'page') { p.goto('storyboard'); p.goto('generation') }
  if (during === 'ball') expect(p.clickBall()).toBe(true)
  if (during === 'close') expect(p.choose('ball')).toBe(true)
  if (during === 'relaunch') await p.relaunch()
}

describe('机器让位 × 让位期间发生的事 × 之后（点「回到对话」/ 不点）', () => {
  for (const hold of ['pointer', 'pickRef'] as const) {
    for (const width of ['wide', 'narrow'] as const) {
      for (const stored of STORED_CYCLE) {
        for (const during of DURING[hold]) {
          const expected = HOLD_AFTER[hold][width][stored][during]!
          const label = `${hold} · ${width} · 生成页存 ${stored} · 期间 ${during}`
          it(`${label} → 不点`, async () => {
            const { p, disk } = await bootHold(hold, width, stored)
            probe = p
            await playDuring(p, during, width)
            expect(p.shown(), '此刻显示').toBe(expected.shown)
            expect(returnDockShown(), '「回到对话」在不在').toBe(expected.dock)
            expect(p.disk() !== disk, '存档变没变').toBe(expected.diskChanged)
          })
          if (hold === 'pointer') {
            it(`${label} → 点「回到对话」`, async () => {
              const { p, disk } = await bootHold(hold, width, stored)
              probe = p
              await playDuring(p, during, width)
              if (!expected.dock) {
                // 让位已经结束：那一枚不在，没有可点的（点小球照常打开，在「ball」那一列）。
                expect(returnDockShown()).toBe(false)
                return
              }
              clickReturn(p)
              expect(p.shown(), '回到对话 = 人点开').toBe(POINTER_RETURN[width][stored])
              expect(returnDockShown(), '那一枚消失').toBe(false)
              expect(p.disk(), '宽窗本来就记着「开着」、窄窗只改此刻：存档不变').toBe(disk)
            })
          }
        }
      }
    }
  }
})
