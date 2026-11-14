// Nomi 形态里「此刻怎么显示」那一份：只活在内存里、**不挂 persist**，按页各一份。
// 方向检查 docs/engineering/direction-checks/2026-11-14-agent-form-shown-vs-stored.md 第 6 节「换一种做法」。
//
// 三种东西分开放：
//   · 人选的、要存的（每页的摆法 + 收没收起）→ agentFormStore（persist）；
//   · 此刻怎么显示、不该存的（窄窗档、机器让位）→ 这里；
//   · 算出来的「此刻显示的形态」→ agentFormStore 的 shownForm，全仓唯一一处算。
// 这里的东西写不进磁盘（结构测试钉住：这个 store 被 persist 包住就红）；只有 agentFormStore 读写它，别的文件不直接 import。
import { create } from 'zustand'
import { ASSISTANT_CONTENT_FLOOR, ASSISTANT_WIDTH_MIN } from '../../../workbench/assistantWidthBounds'
import { declareStoreLifetime } from '../../../workbench/project/storeLifetime'
import type { AgentFormSurface } from './agentFormStore'

/**
 * 外壳**唯一**的窄窗判断（WindowNarrow 板 D3、约束 narrow.one-threshold）：窗口宽 < 主内容底线 760 + 停靠栏下限 300。
 * 两个数都是现成的，阈值跟着它们走；各界面内部只按「放不下才收」处理，不再另写窗口宽断点。
 */
export const NARROW_TIER_WIDTH = ASSISTANT_CONTENT_FLOOR + ASSISTANT_WIDTH_MIN
export const NARROW_TIER_QUERY = `(width < ${NARROW_TIER_WIDTH}px)`

/** 跨阈值那一下要播的过渡（停靠收拢成小球 / 小球展回停靠）；拖窗过程中只在跨过阈值时置一次。 */
export type NarrowMotion = 'collapse' | 'restore' | null

/** 窄窗档里人点开 / 收起之后这一页此刻怎么摆；null = 按存的样子（停靠放不下 = 小球）。 */
export type NarrowShown = 'ball' | 'float' | null
/** 机器的临时让位：'ball' = 让开（指向节点时对话挡住画布）；'open' = 摆出来（去画布挑参考图）；null = 没有。 */
export type MachineHold = 'ball' | 'open' | null

function initialWindowNarrow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_TIER_QUERY).matches
}

const SURFACES: readonly AgentFormSurface[] = ['creation', 'storyboard', 'generation', 'preview']
function perSurface<T>(value: T): Record<AgentFormSurface, T> {
  return Object.fromEntries(SURFACES.map((surface) => [surface, value])) as Record<AgentFormSurface, T>
}

export type AgentFormViewState = {
  /** 窗口宽此刻 < NARROW_TIER_WIDTH。只由 ShellAgentHost 的 matchMedia 写。 */
  windowNarrow: boolean
  narrowMotion: NarrowMotion
  /** 窄窗档里每页此刻的摆法覆盖（人点开 / 收起）。跨阈值全部复位。 */
  narrowBySurface: Record<AgentFormSurface, NarrowShown>
  /** 每页的机器让位。人在这一页做任何动作、跨阈值、离开项目都清掉。 */
  machineBySurface: Record<AgentFormSurface, MachineHold>
}

export const useAgentFormViewStore = create<AgentFormViewState>()(() => ({
  windowNarrow: initialWindowNarrow(),
  narrowMotion: null,
  narrowBySurface: perSurface<NarrowShown>(null),
  machineBySurface: perSurface<MachineHold>(null),
}))

/** 跨阈值（或启动对齐）：窗宽变了，各页此刻的覆盖全部作废——宽回来各页是自己存的样子。 */
export function writeWindowNarrow(windowNarrow: boolean, animate: boolean): void {
  useAgentFormViewStore.setState((state) => (state.windowNarrow === windowNarrow ? state : {
    windowNarrow,
    narrowMotion: animate ? (windowNarrow ? 'collapse' : 'restore') : null,
    narrowBySurface: perSurface<NarrowShown>(null),
    machineBySurface: perSurface<MachineHold>(null),
  }))
}

export function writeNarrowShown(surface: AgentFormSurface, shown: NarrowShown): void {
  useAgentFormViewStore.setState((state) => (state.narrowBySurface[surface] === shown ? state : {
    narrowBySurface: { ...state.narrowBySurface, [surface]: shown },
  }))
}

export function writeMachineHold(surface: AgentFormSurface, hold: MachineHold): void {
  useAgentFormViewStore.setState((state) => (state.machineBySurface[surface] === hold ? state : {
    machineBySurface: { ...state.machineBySurface, [surface]: hold },
  }))
}

export function clearNarrowMotionView(): void {
  useAgentFormViewStore.setState((state) => (state.narrowMotion === null ? state : { narrowMotion: null }))
}

export const agentFormViewStoreLifetime = declareStoreLifetime({
  store: 'useAgentFormViewStore',
  // 窗宽和窄窗档里的点开 / 收起跟着这个窗口；机器让位只在这个项目里有意义（「回到对话」指着这个项目的节点）。
  fields: { windowNarrow: 'window', narrowMotion: 'window', narrowBySurface: 'window', machineBySurface: 'project' },
  releaseProject: () => useAgentFormViewStore.setState({ machineBySurface: perSurface<MachineHold>(null) }),
})
