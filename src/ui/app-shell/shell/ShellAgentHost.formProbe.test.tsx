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

import { AgentPanelV4Panel } from '../../../workbench/ai/v4/AgentPanelV4Panel'
import type { PromptEditorProps } from '../../../workbench/assets/PromptEditor'
import { useResidentComposerFocusRequest } from '../../../workbench/ai/residentComposerFocus'

let editor: PromptEditorProps
vi.mock('../../../workbench/assets/PromptEditor', () => ({ default: (props: PromptEditorProps) => { editor = props; return null } }))
vi.mock('use-stick-to-bottom', () => ({ useStickToBottom: () => ({
  scrollRef: { current: null }, contentRef: { current: null }, scrollToBottom: vi.fn(), state: { isAtBottom: true }, isAtBottom: true,
}) }))

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
const clickReturn = (p: Probe): void => p.clickWhere((props) => props['data-node-pointer-return'] === 'true', 'data-node-pointer-return 按钮')

/** 从创作页面板里点「参考」去画布挑图时，外壳这一侧做的事：ProjectAgentResidentShell 的 pickReferenceOnCanvas 只调这一个动作（结构测试钉住）。 */
function pickReferenceOnCanvas(p: Probe): void {
  machineHold('generation', 'open')
  p.goto('generation')
}

it('starts the 500ms review after Mod+J reveals the new quote in the viewport', async () => {
  vi.useFakeTimers()
  const onConfirm = vi.fn()
  let intersects = true
  const notify = new Set<() => void>()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    private publish?: () => void
    observe(target: Element) {
      this.publish = () => this.callback([{ target, isIntersecting: intersects, intersectionRatio: intersects ? 1 : 0 } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      notify.add(this.publish)
      this.publish()
    }
    disconnect() { if (this.publish) notify.delete(this.publish) }
  })
  const focusEditor = vi.fn(() => true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(performance.now()); return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  let setQuote!: (quote: string) => void
  function Panel() {
    const [quote, updateQuote] = React.useState('first')
    setQuote = updateQuote
    useResidentComposerFocusRequest(focusEditor)
    return <AgentPanelV4Panel flow={[]} context={{}} emptyOverride={<span />}
      slot={{ kind: 'spend', title: quote, spendConfirmationId: quote }}
      slotHandlers={{ onConfirm, onPlanToggle: vi.fn(), onCollapsePlan: vi.fn() }}
      composer={{ draft: { subscribe: () => () => {}, getSnapshot: () => '', write: () => {} } }} />
  }
  const pressEnter = () => editor.onKeyDownCapture!({
    key: 'Enter', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
  } as React.KeyboardEvent<HTMLDivElement>)
  try {
    probe = await bootProbe({ narrow: false, page: 'creation', forms: { creation: 'dock' }, agent: <Panel /> })
    pressEnter()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    probe.key('\\')
    expect(probe.shown()).toBe('collapsed')
    intersects = false
    for (const publish of notify) publish()
    setQuote('second')
    probe.settle()
    vi.advanceTimersByTime(1000)
    probe.key('j')
    expect(probe.shown()).toBe('dock')
    expect(focusEditor).toHaveBeenCalled()
    pressEnter()
    expect(onConfirm, 'immediate Enter after Mod+J').toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    pressEnter()
    expect(onConfirm, 'expanded but outside the viewport').toHaveBeenCalledTimes(1)
    intersects = true
    for (const publish of notify) publish()
    vi.advanceTimersByTime(499)
    pressEnter()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    pressEnter()
    expect(onConfirm).toHaveBeenCalledTimes(2)
  } finally {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})

describe('没钉住的三条（方向检查第 3 节）：写成期望行为', () => {
  it('预测 1a · 窄窗里创作页点开，生成页没点不跟着开', async () => {
    probe = await bootProbe({ forms: { creation: 'ball', generation: 'ball' }, narrow: true, page: 'creation' })
    expect(probe.shown()).toBe('collapsed')
    probe.clickEntry()
    expect(probe.shown()).toBe('float')
    probe.goto('generation')
    expect(probe.shown()).toBe('collapsed')
  })

  it('预测 1b · 窄窗里生成页（存浮窗）收起，创作页（存浮窗）没点不跟着收', async () => {
    probe = await bootProbe({ forms: { creation: 'float', generation: 'float' }, narrow: true, page: 'generation' })
    expect(probe.shown()).toBe('float')
    probe.key('\\')
    expect(probe.shown()).toBe('collapsed')
    probe.goto('creation')
    expect(probe.shown()).toBe('float')
  })

  for (const creation of ['dock', 'ball', 'float'] as const) {
    it(`预测 2 · 窄窗里生成页被收起、从创作页（存${creation}）去挑参考图：生成页的 Nomi 叫得出来`, async () => {
      probe = await bootProbe({ forms: { creation, generation: 'float' }, narrow: true, page: 'generation' })
      probe.key('\\')
      expect(probe.shown()).toBe('collapsed')
      probe.goto('creation')
      if (probe.shown() === 'collapsed') probe.clickEntry()
      expect(probe.shown()).not.toBe('collapsed')
      pickReferenceOnCanvas(probe)
      expect(probe.shown()).not.toBe('collapsed')
    })
  }

  it('预测 3 · 宽窗里创作页选浮窗、收起、再点开：回到浮窗', async () => {
    probe = await bootProbe({ forms: { creation: 'dock' }, narrow: false, page: 'creation' })
    expect(probe.choose('float')).toBe(true)
    expect(probe.shown()).toBe('float')
    expect(probe.choose('collapse')).toBe(true)
    expect(probe.shown()).toBe('collapsed')
    probe.clickEntry()
    expect(probe.shown()).toBe('float')
  })
})

describe('独立验收查出的三条（先钉现状）', () => {
  it('① 窄窗点开 → 指向让开 → 拉宽：那一枚跟着消失、显示存的样子（存收着 = 收起），点顶栏入口打开到上次选的摆法', async () => {
    probe = await bootProbe({ forms: { generation: 'ball' }, narrow: true, page: 'generation', alongside: withReturnDock })
    probe.clickEntry()
    expect(probe.shown()).toBe('float')
    yieldChatToCanvas({ surface: 'generation', nodeId: 'n1', label: '镜 01' })
    probe.settle()
    expect(probe.shown()).toBe('collapsed')
    expect(returnDockShown()).toBe(true)
    probe.resize(false)
    expect(probe.shown(), '拉宽：显示存的样子').toBe('collapsed')
    expect(returnDockShown(), '拉宽：让位结束，那一枚跟着消失').toBe(false)
    probe.clickEntry()
    expect(probe.shown()).toBe('float')
  })

  it('① 补格 · 让位还在时（没跨窗宽）点「回到对话」：对话回来、那一枚消失', async () => {
    probe = await bootProbe({ forms: { generation: 'ball' }, narrow: true, page: 'generation', alongside: withReturnDock })
    probe.clickEntry()
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
      probe.choose('collapse')
      expect(probe.shown()).toBe('collapsed')
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
          expect(['collapsed', 'float', 'dock'], page).toContain(probe.shown())
        }
      })
    }
  }
})

// ── 探针表：窗宽 × 页 × 旧存档三值 × 人的手势，之后切页 / 跨阈值 / 重开 ────────────────────────────────
// 期望逐格写死（不在测试里再算一遍）。'D' = 这一页的默认摆法：生成页浮窗、其余停靠（旧存档存小球的页迁成「收着 + 默认摆法」）。
// ⌘\ 是「收起 / 展开 Nomi」（concept-owners/shell.recall-entry）：开着收起，收着打开到上次选的摆法（和点顶栏入口同一个动作）。
// 点顶栏入口（clickEntry）是开 / 收一颗钮：收着点 = 打开，开着点 = 收起（和头部选「收起」同一个动作）。
// 旧小球的右键菜单（改成浮窗 / 改成停靠）随小球删掉，没搬到入口上（设计卡 ★1c：换摆法在面板头三选一里换）。

type Gesture = 'clickEntry' | 'modJ' | 'modBackslash' | 'openCollapse' | 'openChooseFloat' | 'openMoreCollapse' | 'openMoreFloat' | 'recall'
type Cell = Shown | 'D'
const GESTURES: Gesture[] = ['clickEntry', 'modJ', 'modBackslash', 'openCollapse', 'openChooseFloat', 'openMoreCollapse', 'openMoreFloat', 'recall']
/** 选了摆法的手势（窄窗档里只有它们写存档：写摆法）。 */
const PLACEMENT_GESTURES = new Set<Gesture>(['openChooseFloat', 'openMoreFloat'])

function play(p: Probe, gesture: Gesture): void {
  const openFirst = () => { if (p.shown() === 'collapsed') p.clickEntry() }
  switch (gesture) {
    case 'clickEntry': p.clickEntry(); return
    case 'modJ': p.key('j'); return
    case 'modBackslash': p.key('\\'); return
    case 'openCollapse': openFirst(); p.choose('collapse'); return
    case 'openChooseFloat': openFirst(); p.choose('float'); return
    case 'openMoreCollapse': openFirst(); p.more('collapse'); return
    case 'openMoreFloat': openFirst(); p.more('float'); return
    case 'recall': p.recall(); return
  }
}

/** 手势之后此刻显示的。 */
const AFTER: Record<'wide' | 'narrow', Record<OldForm, Record<Gesture, Cell>>> = {
  wide: {
    dock: { clickEntry: 'collapsed', modJ: 'dock', modBackslash: 'collapsed', openCollapse: 'collapsed', openChooseFloat: 'float', openMoreCollapse: 'collapsed', openMoreFloat: 'float', recall: 'dock' },
    ball: { clickEntry: 'D', modJ: 'D', modBackslash: 'D', openCollapse: 'collapsed', openChooseFloat: 'float', openMoreCollapse: 'collapsed', openMoreFloat: 'float', recall: 'D' },
    float: { clickEntry: 'collapsed', modJ: 'float', modBackslash: 'collapsed', openCollapse: 'collapsed', openChooseFloat: 'float', openMoreCollapse: 'collapsed', openMoreFloat: 'float', recall: 'float' },
  },
  narrow: {
    dock: { clickEntry: 'float', modJ: 'float', modBackslash: 'float', openCollapse: 'collapsed', openChooseFloat: 'float', openMoreCollapse: 'collapsed', openMoreFloat: 'float', recall: 'float' },
    ball: { clickEntry: 'float', modJ: 'float', modBackslash: 'float', openCollapse: 'collapsed', openChooseFloat: 'float', openMoreCollapse: 'collapsed', openMoreFloat: 'float', recall: 'float' },
    float: { clickEntry: 'collapsed', modJ: 'float', modBackslash: 'collapsed', openCollapse: 'collapsed', openChooseFloat: 'float', openMoreCollapse: 'collapsed', openMoreFloat: 'float', recall: 'float' },
  },
}

/** 窄窗里做完手势再拉宽：宽窗显示的是存下的那个（窄窗里只有选摆法写了摆法，开没开一律没写）。 */
const NARROW_THEN_WIDE: Record<OldForm, Record<Gesture, Cell>> = {
  dock: { clickEntry: 'dock', modJ: 'dock', modBackslash: 'dock', openCollapse: 'dock', openChooseFloat: 'float', openMoreCollapse: 'dock', openMoreFloat: 'float', recall: 'dock' },
  ball: { clickEntry: 'collapsed', modJ: 'collapsed', modBackslash: 'collapsed', openCollapse: 'collapsed', openChooseFloat: 'collapsed', openMoreCollapse: 'collapsed', openMoreFloat: 'collapsed', recall: 'collapsed' },
  float: { clickEntry: 'float', modJ: 'float', modBackslash: 'float', openCollapse: 'float', openChooseFloat: 'float', openMoreCollapse: 'float', openMoreFloat: 'float', recall: 'float' },
}

/** 窄窗里做完手势、关掉再开（还是窄窗）：只剩存下的那份。 */
const NARROW_RELAUNCH: Record<OldForm, Record<Gesture, Cell>> = {
  dock: { clickEntry: 'collapsed', modJ: 'collapsed', modBackslash: 'collapsed', openCollapse: 'collapsed', openChooseFloat: 'float', openMoreCollapse: 'collapsed', openMoreFloat: 'float', recall: 'collapsed' },
  ball: { clickEntry: 'collapsed', modJ: 'collapsed', modBackslash: 'collapsed', openCollapse: 'collapsed', openChooseFloat: 'collapsed', openMoreCollapse: 'collapsed', openMoreFloat: 'collapsed', recall: 'collapsed' },
  float: { clickEntry: 'float', modJ: 'float', modBackslash: 'float', openCollapse: 'float', openChooseFloat: 'float', openMoreCollapse: 'float', openMoreFloat: 'float', recall: 'float' },
}

/** 宽窗手势之后拉窄：停靠放不下 = 收起；浮窗、收起照旧。 */
const narrowOf = (shown: Shown): Shown => (shown === 'dock' ? 'collapsed' : shown)
const resolve = (cell: Cell, surface: AgentFormSurface): Shown => (cell === 'D' ? (surface === 'generation' ? 'float' : 'dock') : cell)

/** 窄窗里哪几格写存档：只有选浮窗、且存下的摆法本来不是浮窗（旧存档存小球的生成页默认摆法就是浮窗，一个字节不写）。 */
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

  it('宽窗收起再点开回到上次选的摆法：每页 × 两种摆法 × 四种收法（形态切换、「⋯」、⌘\\、点顶栏入口）× 三种开法（点顶栏入口、⌘J、⌘\\）', async () => {
    for (const surface of PROBE_SURFACES) {
      for (const placement of ['float', 'dock'] as const) {
        for (const collapse of ['switch', 'more', 'key', 'entry'] as const) {
          for (const open of ['entry', 'j', 'key'] as const) {
            probe?.close()
            probe = await bootProbe({ forms: { [surface]: 'dock' }, narrow: false, page: surface })
            probe.choose(placement)
            if (collapse === 'switch') probe.choose('collapse')
            if (collapse === 'more') probe.more('collapse')
            if (collapse === 'key') probe.key('\\')
            if (collapse === 'entry') probe.clickEntry()
            expect(probe.shown()).toBe('collapsed')
            if (open === 'entry') probe.clickEntry()
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
        expect(probe.shown()).not.toBe('collapsed')
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
// 让位期间发生的事：none 什么都没发生 · cross 跨窗宽（宽 → 窄 / 窄 → 宽）· page 切到分镜页再切回 · entry 人点顶栏入口（收着 = 打开）·
// close 人点关闭钮（面板头部收起）· relaunch 关掉重开。指向让开时对话收着、没有关闭钮（close 不适用）；
// 挑参考图时对话开着，开着点入口和点关闭钮是同一个动作（collapseAgent，见探针表 clickEntry 列），这里只量关闭钮，所以两种让位各 5 件事。

type Hold = 'pointer' | 'pickRef'
type During = 'none' | 'cross' | 'page' | 'entry' | 'close' | 'relaunch'
const DURING: Record<Hold, During[]> = { pointer: ['none', 'cross', 'page', 'entry', 'relaunch'], pickRef: ['none', 'cross', 'page', 'close', 'relaunch'] }
type HoldCell = { shown: Shown; dock: boolean; diskChanged: boolean }
const cell = (shown: Shown, dock = false, diskChanged = false): HoldCell => ({ shown, dock, diskChanged })

/** 让位期间那件事之后。键：让位 · 窗宽 · 生成页旧存档 · 那件事。 */
const HOLD_AFTER: Record<Hold, Record<'wide' | 'narrow', Record<OldForm, Partial<Record<During, HoldCell>>>>> = {
  pointer: {
    // 宽窗：旧存档存小球（收着）的先点开（人的动作，记下「开着」，之后才量存档）。
    wide: {
      dock: { none: cell('collapsed', true), cross: cell('collapsed'), page: cell('collapsed', true), entry: cell('dock'), relaunch: cell('dock') },
      ball: { none: cell('collapsed', true), cross: cell('float'), page: cell('collapsed', true), entry: cell('float'), relaunch: cell('float') },
      float: { none: cell('collapsed', true), cross: cell('float'), page: cell('collapsed', true), entry: cell('float'), relaunch: cell('float') },
    },
    // 窄窗：存停靠 / 收着的先点开（窄窗里点开只改此刻）。拉宽 = 回到存的样子（存收着的就是收着）。
    narrow: {
      dock: { none: cell('collapsed', true), cross: cell('dock'), page: cell('collapsed', true), entry: cell('float'), relaunch: cell('collapsed') },
      ball: { none: cell('collapsed', true), cross: cell('collapsed'), page: cell('collapsed', true), entry: cell('float'), relaunch: cell('collapsed') },
      float: { none: cell('collapsed', true), cross: cell('float'), page: cell('collapsed', true), entry: cell('float'), relaunch: cell('float') },
    },
  },
  pickRef: {
    // 宽窗存停靠 / 浮窗：本来就开着，机器不留覆盖；人点关闭钮就是平常的收起（宽窗记下「收着」）。
    wide: {
      dock: { none: cell('dock'), cross: cell('collapsed'), page: cell('dock'), close: cell('collapsed', false, true), relaunch: cell('dock') },
      ball: { none: cell('float'), cross: cell('collapsed'), page: cell('float'), close: cell('collapsed'), relaunch: cell('collapsed') },
      float: { none: cell('float'), cross: cell('float'), page: cell('float'), close: cell('collapsed', false, true), relaunch: cell('float') },
    },
    narrow: {
      dock: { none: cell('float'), cross: cell('dock'), page: cell('float'), close: cell('collapsed'), relaunch: cell('collapsed') },
      ball: { none: cell('float'), cross: cell('collapsed'), page: cell('float'), close: cell('collapsed'), relaunch: cell('collapsed') },
      float: { none: cell('float'), cross: cell('float'), page: cell('float'), close: cell('collapsed'), relaunch: cell('float') },
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
    if (p.shown() === 'collapsed') p.clickEntry()
    expect(p.shown(), '指向之前对话开着').not.toBe('collapsed')
    const disk = p.disk()
    yieldChatToCanvas({ surface: 'generation', nodeId: 'n1', label: '镜 01' })
    p.settle()
    expect(p.shown(), '指向让开').toBe('collapsed')
    expect(returnDockShown(), '让开时「回到对话」在').toBe(true)
    return { p, disk }
  }
  const disk = p.disk()
  pickReferenceOnCanvas(p)
  expect(p.shown(), '挑参考图：生成页的 Nomi 开着').not.toBe('collapsed')
  return { p, disk }
}

async function playDuring(p: Probe, during: During, width: 'wide' | 'narrow'): Promise<void> {
  if (during === 'cross') p.resize(width === 'wide')
  if (during === 'page') { p.goto('storyboard'); p.goto('generation') }
  if (during === 'entry') { expect(p.shown(), '点入口之前收着').toBe('collapsed'); p.clickEntry() }
  if (during === 'close') expect(p.choose('collapse')).toBe(true)
  if (during === 'relaunch') await p.relaunch()
}

// 两种让位叠起来：挑参考图把收着的对话摆出来，接着点聊天里的指向让开，再点「回到对话」。
// 回到对话是人点开（openAgent）：对话回来；宽窗里存的是收着的那页记下「开着」（和人点顶栏入口一样）。只撤让位会回到收着——按了没反应那一类。
const STACKED_RETURN: Record<'wide' | 'narrow', Record<OldForm, { shown: Shown; diskChanged: boolean }>> = {
  wide: { ball: { shown: 'float', diskChanged: true }, dock: { shown: 'dock', diskChanged: false }, float: { shown: 'float', diskChanged: false } },
  narrow: { ball: { shown: 'float', diskChanged: false }, dock: { shown: 'float', diskChanged: false }, float: { shown: 'float', diskChanged: false } },
}

describe('挑参考图摆出来 → 指向让开 → 点「回到对话」', () => {
  for (const width of ['wide', 'narrow'] as const) {
    for (const stored of STORED_CYCLE) {
      it(`${width} · 生成页存 ${stored}`, async () => {
        const { p, disk } = await bootHold('pickRef', width, stored)
        probe = p
        yieldChatToCanvas({ surface: 'generation', nodeId: 'n1', label: '镜 01' })
        p.settle()
        expect(p.shown()).toBe('collapsed')
        expect(returnDockShown()).toBe(true)
        clickReturn(p)
        expect(p.shown(), '回到对话 = 人点开').toBe(STACKED_RETURN[width][stored].shown)
        expect(returnDockShown()).toBe(false)
        expect(p.disk() !== disk, '存档变没变').toBe(STACKED_RETURN[width][stored].diskChanged)
      })
    }
  }
})

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
                // 让位已经结束：那一枚不在，没有可点的（点顶栏入口照常打开，在「entry」那一列）。
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
