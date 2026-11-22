// Agent 三形态（收起 / 浮窗 / 停靠）的唯一 owner（10-08 外壳重设计，设计卡格 ★2；2026-11-14 换存法，
// 方向检查 docs/engineering/direction-checks/2026-11-14-agent-form-shown-vs-stored.md，设计卡 docs/plan/2026-11-14-agent-form-restructure.md）。
//
// 三种东西分开放，对外只给动作、不给形态：
//   · 人选的、要存的（这里，persist，每页一份）：开着时摆在哪（`placement`：浮窗 / 停靠）+ 收没收起（`collapsed`），
//     加浮窗的位置大小。收起后入口在顶栏最右（NomiEntryTopbar 板，2026-11-22「全部收进顶栏」，内容区里不再有小球）。收起不丢摆法：再点开回到上次选的那个（用户 2026-11-14 拍板「回到上次选的」）。
//   · 此刻怎么显示、不该存的（agentFormViewStore，不挂 persist，每页一份）：窄窗档里的点开 / 收起、机器的临时让位。
//   · 算出来的：`shownForm(页)` / `useShownForm(页)`，全仓唯一一处算「此刻显示的形态」。
// 人的动作只有三个：`openAgent` / `collapseAgent` / `chooseAgentPlacement`——宽窗写人选的那份；窄窗档里点开 / 收起只写此刻那份
// （WindowNarrow 板 D2，用户 2026-11-07：存下的形态一个字节不改），选摆法照写人选的那份。
// 机器的让位（指向节点时让开、去画布挑参考图时摆出来）只写此刻那份：`machineHold`，不改人存的（协调 2026-11-14）。
// 让位没有「机器自己撤」：结束只靠人的动作（三个动作都先清它）、跨窗宽、离开项目、关掉重开。「回到对话」也是人的打开动作。
//
// 位置 / 大小的**拖动与改大小**交给 react-rnd，这里只存结果；只有一件事是自己算的：窗口缩小 / 浮窗被拖出可见区时把它夹回来
// （`clampRect`），因为 react-rnd 的 `bounds` 只在拖动中生效、容器变小时不会重新夹（见设计卡格 ★3）。
//
// Nomi 栏开没开**记在这台机器上**（用户 2026-11-13 拍板「跟机器走」）；不写进项目文件。显示态 `projectAgentDockCollapsed`
// （Agent layout.read 的 visibility.assistant）只由 shownForm 单向写（collapsed ⇔ 收起，ShellAgentHost 那条 effect）。
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { declareStoreLifetime } from '../../../workbench/project/storeLifetime'
import {
  NARROW_TIER_QUERY,
  NARROW_TIER_WIDTH,
  clearNarrowMotionView,
  useAgentFormViewStore,
  writeMachineHold,
  writeNarrowShown,
  writeWindowNarrow,
  type MachineHold,
  type NarrowMotion,
  type NarrowShown,
} from './agentFormViewStore'

export { NARROW_TIER_QUERY, NARROW_TIER_WIDTH, type NarrowMotion }

/** 此刻显示的形态（只从 shownForm 读出来，没有任何写入口收它）。 */
export type AgentForm = 'collapsed' | 'float' | 'dock'
/** 开着时摆在哪（人选的）。 */
export type AgentPlacement = 'float' | 'dock'
export type AgentFormSurface = 'creation' | 'storyboard' | 'generation' | 'preview'
export type FloatRect = { x: number; y: number; width: number; height: number }

type Prefs = { placement: AgentPlacement; collapsed: boolean }
type SurfacePrefs = Prefs & {
  /** 浮窗：相对内容区左上角。null = 还没摆过，用默认（右下 384×500，CanvasAgent 板）。 */
  float: FloatRect | null
}

/** 默认：画布与列表 = 收起（入口在顶栏）、点开是浮窗；创作、分镜、预览 = 停靠右侧（拍板稿各页默认，同改存法前）。 */
export const AGENT_FORM_DEFAULTS: Record<AgentFormSurface, Prefs> = {
  creation: { placement: 'dock', collapsed: false },
  storyboard: { placement: 'dock', collapsed: false },
  generation: { placement: 'float', collapsed: true },
  preview: { placement: 'dock', collapsed: false },
}

export const FLOAT_MIN = { width: 320, height: 360 } as const
export const FLOAT_DEFAULT = { width: 384, height: 500 } as const
/** 浮窗离内容区边缘留多少（token 4 = 16px）。 */
export const EDGE_GAP = 16

/** 过渡标记留多久（tailwind.config.ts 里 nomi-agent-dock-in 播 260ms，略长一点再清）。 */
export const NARROW_MOTION_CLEAR_MS = 320

const SURFACES: readonly AgentFormSurface[] = ['creation', 'storyboard', 'generation', 'preview']

type AgentFormState = {
  bySurface: Record<AgentFormSurface, SurfacePrefs>
  setFloatRect: (surface: AgentFormSurface, rect: FloatRect) => void
}

function initialSurfaces(): Record<AgentFormSurface, SurfacePrefs> {
  return Object.fromEntries(SURFACES.map((surface) => [surface, { ...AGENT_FORM_DEFAULTS[surface], float: null }])) as Record<AgentFormSurface, SurfacePrefs>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function readFloatRect(value: unknown): FloatRect | null {
  if (!isRecord(value)) return null
  const { x, y, width, height } = value
  return isNumber(x) && isNumber(y) && isNumber(width) && isNumber(height) ? { x, y, width, height } : null
}

/** 一页的摆法 + 收没收起。v1（0.24.x）存一个三值 `form`；v2 起存 `placement` + `collapsed`。认不出的按这一页的默认。 */
function readPrefs(entry: Record<string, unknown>, surface: AgentFormSurface, version: number): Prefs {
  const fallback = AGENT_FORM_DEFAULTS[surface]
  if (version < 2) {
    // 老用户升级（★1c）：ball → 收起 + 这一页的默认摆法（生成页浮窗、其余停靠：旧版从小球点开就是去那里）；float / dock → 打开 + 对应摆法。
    if (entry.form === 'float' || entry.form === 'dock') return { placement: entry.form, collapsed: false }
    return entry.form === 'ball' ? { placement: fallback.placement, collapsed: true } : fallback
  }
  // 摆法只认浮窗 / 停靠、收没收起只认布尔；两样有一样认不出，这一页的摆法回到默认（不拼半个）。
  if ((entry.placement === 'float' || entry.placement === 'dock') && typeof entry.collapsed === 'boolean') {
    return { placement: entry.placement, collapsed: entry.collapsed }
  }
  return fallback
}

/**
 * 读存档的**唯一**规整：迁移（旧格式）和日常读取（persist 的 merge）都走它，读出来每页都是合法形状。
 *   · 缺页 / 这一页不是对象 → 这一页的默认；
 *   · 摆法只认浮窗 / 停靠、收没收起只认布尔，认不出 → 这一页的默认摆法；
 *   · 浮窗位置大小不是有限数字 → 丢掉，用默认（null）；
 *   · 0.24.x 存过的小球位置 `ball`（每页一个点）不再读：小球已删（NomiEntryTopbar 板，★1c），多出来的键直接忽略，下次写回时自然丢掉；
 *   · 整段读不出来（不是对象）→ 各页默认。
 * 只读不写：规整的结果只进内存，不回写存档（打开不点就关仍然零写入；人下一次动它时才按规整后的样子写）。
 */
export function normalizeStoredAgentForm(persisted: unknown, version: number): { bySurface: Record<AgentFormSurface, SurfacePrefs> } {
  const bySurface = initialSurfaces()
  const stored = isRecord(persisted) && isRecord(persisted.bySurface) ? persisted.bySurface : {}
  for (const surface of SURFACES) {
    const entry = stored[surface]
    if (!isRecord(entry)) continue
    bySurface[surface] = { ...readPrefs(entry, surface, version), float: readFloatRect(entry.float) }
  }
  return { bySurface }
}

export const AGENT_FORM_STORAGE_KEY = 'nomi:shell-agent-form:v1'
export const AGENT_FORM_STORAGE_VERSION = 2

export const useAgentFormStore = create<AgentFormState>()(persist((set) => ({
  bySurface: initialSurfaces(),
  setFloatRect: (surface, float) => set((state) => ({ bySurface: { ...state.bySurface, [surface]: { ...state.bySurface[surface], float } } })),
}), {
  name: AGENT_FORM_STORAGE_KEY,
  version: AGENT_FORM_STORAGE_VERSION,
  partialize: (state) => ({ bySurface: state.bySurface }),
  // 版本不同（旧格式升级）走 migrate、版本相同直接进 merge——两条都过同一个规整。
  // migrate 之后 persist 自己会写一次新版本（升级落盘，同改存法前）；merge 之后不写，规整不回写。
  migrate: (persisted, version) => normalizeStoredAgentForm(persisted, version) as AgentFormState,
  merge: (persisted, current) => ({ ...current, ...normalizeStoredAgentForm(persisted, AGENT_FORM_STORAGE_VERSION) }),
}))

function writePrefs(surface: AgentFormSurface, patch: Partial<Prefs>): void {
  useAgentFormStore.setState((state) => {
    const current = state.bySurface[surface]
    const same = (patch.placement === undefined || patch.placement === current.placement)
      && (patch.collapsed === undefined || patch.collapsed === current.collapsed)
    return same ? state : { bySurface: { ...state.bySurface, [surface]: { ...current, ...patch } } }
  })
}

/** 窄窗档里没人点过时，这一页按存的样子该怎么摆：收着 = 收起；开着停靠放不下 = 收起；开着浮窗 = 浮窗。 */
function narrowNatural(prefs: Prefs): 'collapsed' | 'float' {
  return !prefs.collapsed && prefs.placement === 'float' ? 'float' : 'collapsed'
}

/** 唯一的派生：人存的 × 此刻的覆盖 → 此刻显示的形态。 */
function derive(prefs: Prefs, view: { windowNarrow: boolean; narrow: NarrowShown; machine: MachineHold }): AgentForm {
  if (view.machine === 'collapsed') return 'collapsed'
  const base: AgentForm = view.windowNarrow ? (view.narrow ?? narrowNatural(prefs)) : (prefs.collapsed ? 'collapsed' : prefs.placement)
  if (view.machine === 'open' && base === 'collapsed') return view.windowNarrow ? 'float' : prefs.placement
  return base
}

/** 这一页**此刻**显示的形态。全仓唯一的读法（React 里用 useShownForm，同一条派生）。 */
export function shownForm(surface: AgentFormSurface): AgentForm {
  const view = useAgentFormViewStore.getState()
  return derive(useAgentFormStore.getState().bySurface[surface], {
    windowNarrow: view.windowNarrow,
    narrow: view.narrowBySurface[surface],
    machine: view.machineBySurface[surface],
  })
}

export function useShownForm(surface: AgentFormSurface): AgentForm {
  const placement = useAgentFormStore((state) => state.bySurface[surface].placement)
  const collapsed = useAgentFormStore((state) => state.bySurface[surface].collapsed)
  const windowNarrow = useAgentFormViewStore((state) => state.windowNarrow)
  const narrow = useAgentFormViewStore((state) => state.narrowBySurface[surface])
  const machine = useAgentFormViewStore((state) => state.machineBySurface[surface])
  return derive({ placement, collapsed }, { windowNarrow, narrow, machine })
}

/** 窄窗档：外壳那条 matchMedia 写。`animate: false` = 启动时的第一次对齐，不是「跨过」阈值，不播过渡。 */
export function setAgentWindowNarrow(narrow: boolean, options?: { animate?: boolean }): void {
  writeWindowNarrow(narrow, options?.animate !== false)
}
export function clearAgentNarrowMotion(): void {
  clearNarrowMotionView()
}
export function useAgentWindowNarrow(): boolean {
  return useAgentFormViewStore((state) => state.windowNarrow)
}
export function useAgentNarrowMotion(): NarrowMotion {
  return useAgentFormViewStore((state) => state.narrowMotion)
}

// ── 人的动作：点顶栏入口、⌘J、⌘\、关闭钮、形态切换、别处的「问 Nomi」入口 ─────────────────────────────

/** 打开这一页的 Nomi，回到上次选的摆法。宽窗记下「开着」；窄窗档只改此刻（停靠放不下，此刻是浮窗）。 */
export function openAgent(surface: AgentFormSurface): void {
  writeMachineHold(surface, null)
  if (!useAgentFormViewStore.getState().windowNarrow) {
    writePrefs(surface, { collapsed: false })
    return
  }
  writeNarrowShown(surface, narrowNatural(useAgentFormStore.getState().bySurface[surface]) === 'float' ? null : 'float')
}

/** 收起（入口在顶栏最右）。宽窗记下「收着」（摆法不动）；窄窗档只改此刻。 */
export function collapseAgent(surface: AgentFormSurface): void {
  writeMachineHold(surface, null)
  if (!useAgentFormViewStore.getState().windowNarrow) {
    writePrefs(surface, { collapsed: true })
    return
  }
  writeNarrowShown(surface, narrowNatural(useAgentFormStore.getState().bySurface[surface]) === 'collapsed' ? null : 'collapsed')
}

/**
 * 人在形态切换（面板头部、「⋯」）里明确选浮窗 / 停靠：照写人选的摆法，并打开。
 * 宽窗连「开着」一起记；窄窗档只记摆法，开着是此刻的（窄窗里点开不改存下的开没开）。
 */
export function chooseAgentPlacement(surface: AgentFormSurface, placement: AgentPlacement): void {
  writeMachineHold(surface, null)
  if (!useAgentFormViewStore.getState().windowNarrow) {
    writePrefs(surface, { placement, collapsed: false })
    return
  }
  writePrefs(surface, { placement })
  writeNarrowShown(surface, narrowNatural(useAgentFormStore.getState().bySurface[surface]) === 'float' ? null : 'float')
}

// ── 机器的让位。只写此刻那份，人存的一个字节不动 ─────────────────────────────────────────────

/**
 * 机器临时改这一页此刻怎么显示：'collapsed' = 让开（指向节点时对话挡住画布，收到顶栏入口）；'open' = 摆出来（去画布挑参考图）。
 * 已经是那个样子就不留覆盖（免得一枚没用的覆盖压着之后的样子）。
 */
export function machineHold(surface: AgentFormSurface, hold: 'collapsed' | 'open'): void {
  const before = shownForm(surface)
  if (hold === 'open' ? before !== 'collapsed' : before === 'collapsed') return
  writeMachineHold(surface, hold)
}


/**
 * 这一页此刻是不是「机器让开」收起的。给的是是 / 否，不是形态。
 * 「回到对话」那一枚只从它算出来：让位因为任何一条路结束（拉宽 / 拉窄、人点顶栏入口、⌘J、⌘\、人选摆法、离开项目、关掉重开），它就跟着没了。
 */
export function useMachineGaveWay(surface: AgentFormSurface): boolean {
  return useAgentFormViewStore((state) => state.machineBySurface[surface] === 'collapsed')
}

/** 默认浮窗：贴右下、约半屏高（LibTV「点开是一半」）。 */
export function defaultFloatRect(area: { width: number; height: number }): FloatRect {
  // CanvasAgent 板：浮窗 384×500，贴右下；内容区放不下就收到能放下的最大（clampRect 再兜底）。
  const width = Math.min(FLOAT_DEFAULT.width, Math.max(FLOAT_MIN.width, area.width - EDGE_GAP * 2))
  const height = Math.min(FLOAT_DEFAULT.height, Math.max(FLOAT_MIN.height, area.height - EDGE_GAP * 2))
  return clampRect({ x: area.width - width - EDGE_GAP, y: area.height - height - EDGE_GAP, width, height }, area)
}

/** 夹回可见区：大小不超过内容区，位置让整块都在里面（窗口缩小、旧位置在屏外时调用）。 */
export function clampRect(rect: FloatRect, area: { width: number; height: number }): FloatRect {
  const width = Math.max(Math.min(FLOAT_MIN.width, area.width), Math.min(rect.width, area.width))
  const height = Math.max(Math.min(FLOAT_MIN.height, area.height), Math.min(rect.height, area.height))
  const x = Math.min(Math.max(0, rect.x), Math.max(0, area.width - width))
  const y = Math.min(Math.max(0, rect.y), Math.max(0, area.height - height))
  return { x, y, width, height }
}

export const agentFormStoreLifetime = declareStoreLifetime({
  store: 'useAgentFormStore',
  // 摆法、收没收起、浮窗位置是这台机器的界面偏好（每页一份）。
  fields: { bySurface: 'window' },
})
