// Agent 三形态（小球 / 浮窗 / 停靠）的唯一 owner（10-08 外壳重设计，设计卡格 ★2；2026-11-14 换存法，
// 方向检查 docs/engineering/direction-checks/2026-11-14-agent-form-shown-vs-stored.md，设计卡 docs/plan/2026-11-14-agent-form-restructure.md）。
//
// 三种东西分开放，对外只给动作、不给形态：
//   · 人选的、要存的（这里，persist，每页一份）：开着时摆在哪（`placement`：浮窗 / 停靠）+ 收没收成小球（`collapsed`），
//     加浮窗的位置大小、小球的位置。收起不丢摆法：再点开回到上次选的那个（用户 2026-11-14 拍板「回到上次选的」）。
//   · 此刻怎么显示、不该存的（agentFormViewStore，不挂 persist，每页一份）：窄窗档里的点开 / 收起、机器的临时让位。
//   · 算出来的：`shownForm(页)` / `useShownForm(页)`，全仓唯一一处算「此刻显示的形态」。
// 人的动作只有三个：`openAgent` / `collapseAgent` / `chooseAgentPlacement`——宽窗写人选的那份；窄窗档里点开 / 收起只写此刻那份
// （WindowNarrow 板 D2，用户 2026-11-07：存下的形态一个字节不改），选摆法照写人选的那份。
// 机器的让位（指向节点时让开、去画布挑参考图时摆出来）只写此刻那份：`machineHold` / `machineRelease`，不改人存的（协调 2026-11-14）。
//
// 位置 / 大小的**拖动与改大小**交给 react-rnd，这里只存结果；只有一件事是自己算的：窗口缩小 / 浮窗被拖出可见区时把它夹回来
// （`clampRect`），因为 react-rnd 的 `bounds` 只在拖动中生效、容器变小时不会重新夹（见设计卡格 ★3）。
//
// Nomi 栏开没开**记在这台机器上**（用户 2026-11-13 拍板「跟机器走」）；不写进项目文件。显示态 `projectAgentDockCollapsed`
// （Agent layout.read 的 visibility.assistant）只由 shownForm 单向写（小球 ⇔ 收起，ShellAgentHost 那条 effect）。
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { declareStoreLifetime } from '../../../workbench/project/storeLifetime'
import type { V4DockStatus } from '../../../workbench/ai/v4/agentPanelV4DockStatus'
import type { NomiAgentPose } from '../../../design'
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
export type AgentForm = 'ball' | 'float' | 'dock'
/** 开着时摆在哪（人选的）。 */
export type AgentPlacement = 'float' | 'dock'
export type AgentFormSurface = 'creation' | 'storyboard' | 'generation' | 'preview'
export type FloatRect = { x: number; y: number; width: number; height: number }
export type BallPoint = { x: number; y: number }

type Prefs = { placement: AgentPlacement; collapsed: boolean }
type SurfacePrefs = Prefs & {
  /** 浮窗：相对内容区左上角。null = 还没摆过，用默认（右下 384×500，CanvasAgent 板）。 */
  float: FloatRect | null
  /** 小球：相对内容区左上角。null = 默认右下角。 */
  ball: BallPoint | null
}

/** 默认：画布与列表 = 收成右下角小球、点开是浮窗；创作、分镜、预览 = 停靠右侧（拍板稿各页默认，同改存法前）。 */
export const AGENT_FORM_DEFAULTS: Record<AgentFormSurface, Prefs> = {
  creation: { placement: 'dock', collapsed: false },
  storyboard: { placement: 'dock', collapsed: false },
  generation: { placement: 'float', collapsed: true },
  preview: { placement: 'dock', collapsed: false },
}

export const FLOAT_MIN = { width: 320, height: 360 } as const
export const FLOAT_DEFAULT = { width: 384, height: 500 } as const
export const BALL_SIZE = 44
/** 浮窗 / 小球离内容区边缘留多少（token 4 = 16px）。 */
export const EDGE_GAP = 16

/** 过渡标记留多久（tailwind.config.ts 里 nomi-agent-gather / dock-in 播 260ms，略长一点再清）。 */
export const NARROW_MOTION_CLEAR_MS = 320

const SURFACES: readonly AgentFormSurface[] = ['creation', 'storyboard', 'generation', 'preview']

type AgentFormState = {
  bySurface: Record<AgentFormSurface, SurfacePrefs>
  setFloatRect: (surface: AgentFormSurface, rect: FloatRect) => void
  setBallPoint: (surface: AgentFormSurface, point: BallPoint) => void
}

function initialSurfaces(): Record<AgentFormSurface, SurfacePrefs> {
  return Object.fromEntries(SURFACES.map((surface) => [surface, { ...AGENT_FORM_DEFAULTS[surface], float: null, ball: null }])) as Record<AgentFormSurface, SurfacePrefs>
}

/** 改存法之前（0.24.x 起，persist version 1）每页存一个三值 form。 */
type StoredV1 = { bySurface?: Partial<Record<AgentFormSurface, { form?: unknown; float?: FloatRect | null; ball?: BallPoint | null }>> }

/**
 * 老用户升级（★1c）：旧 `form` 三值 → 摆法 + 收没收起；位置和大小原样保留。
 *   ball → 收起 + 这一页的默认摆法（生成页浮窗、其余停靠：旧版从小球点开就是去那里）；float / dock → 打开 + 对应摆法。
 * 缺页、认不出的值按这一页的默认。
 */
export function migrateAgentFormV1(persisted: unknown): { bySurface: Record<AgentFormSurface, SurfacePrefs> } {
  const old = (persisted && typeof persisted === 'object' ? persisted : {}) as StoredV1
  const bySurface = initialSurfaces()
  for (const surface of SURFACES) {
    const entry = old.bySurface?.[surface]
    if (!entry || typeof entry !== 'object') continue
    const prefs: Prefs = entry.form === 'float' || entry.form === 'dock'
      ? { placement: entry.form, collapsed: false }
      : entry.form === 'ball' ? { placement: AGENT_FORM_DEFAULTS[surface].placement, collapsed: true } : AGENT_FORM_DEFAULTS[surface]
    bySurface[surface] = { ...prefs, float: entry.float ?? null, ball: entry.ball ?? null }
  }
  return { bySurface }
}

export const AGENT_FORM_STORAGE_KEY = 'nomi:shell-agent-form:v1'
export const AGENT_FORM_STORAGE_VERSION = 2

export const useAgentFormStore = create<AgentFormState>()(persist((set) => ({
  bySurface: initialSurfaces(),
  setFloatRect: (surface, float) => set((state) => ({ bySurface: { ...state.bySurface, [surface]: { ...state.bySurface[surface], float } } })),
  setBallPoint: (surface, ball) => set((state) => ({ bySurface: { ...state.bySurface, [surface]: { ...state.bySurface[surface], ball } } })),
}), {
  name: AGENT_FORM_STORAGE_KEY,
  version: AGENT_FORM_STORAGE_VERSION,
  partialize: (state) => ({ bySurface: state.bySurface }),
  migrate: (persisted, version) => (version < 2 ? migrateAgentFormV1(persisted) : persisted) as AgentFormState,
}))

function writePrefs(surface: AgentFormSurface, patch: Partial<Prefs>): void {
  useAgentFormStore.setState((state) => {
    const current = state.bySurface[surface]
    const same = (patch.placement === undefined || patch.placement === current.placement)
      && (patch.collapsed === undefined || patch.collapsed === current.collapsed)
    return same ? state : { bySurface: { ...state.bySurface, [surface]: { ...current, ...patch } } }
  })
}

/** 窄窗档里没人点过时，这一页按存的样子该怎么摆：收着 = 小球；开着停靠放不下 = 小球；开着浮窗 = 浮窗。 */
function narrowNatural(prefs: Prefs): 'ball' | 'float' {
  return !prefs.collapsed && prefs.placement === 'float' ? 'float' : 'ball'
}

/** 唯一的派生：人存的 × 此刻的覆盖 → 此刻显示的形态。 */
function derive(prefs: Prefs, view: { windowNarrow: boolean; narrow: NarrowShown; machine: MachineHold }): AgentForm {
  if (view.machine === 'ball') return 'ball'
  const base: AgentForm = view.windowNarrow ? (view.narrow ?? narrowNatural(prefs)) : (prefs.collapsed ? 'ball' : prefs.placement)
  if (view.machine === 'open' && base === 'ball') return view.windowNarrow ? 'float' : prefs.placement
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

/**
 * 这颗小球是不是「窄窗把开着的停靠临时收起来」的那颗：悬停提示换成「窗口变宽自动停回」，跨阈值那一下播收拢。
 * 给的是一个是 / 否，不是形态。
 */
export function useNarrowHeldBall(surface: AgentFormSurface): boolean {
  const heldDock = useAgentFormStore((state) => !state.bySurface[surface].collapsed && state.bySurface[surface].placement === 'dock')
  const windowNarrow = useAgentFormViewStore((state) => state.windowNarrow)
  return windowNarrow && heldDock
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

// ── 人的动作：小球点击、⌘J、⌘\、关闭钮、形态切换、别处的「问 Nomi」入口 ─────────────────────────────

/** 打开这一页的 Nomi，回到上次选的摆法。宽窗记下「开着」；窄窗档只改此刻（停靠放不下，此刻是浮窗）。 */
export function openAgent(surface: AgentFormSurface): void {
  writeMachineHold(surface, null)
  if (!useAgentFormViewStore.getState().windowNarrow) {
    writePrefs(surface, { collapsed: false })
    return
  }
  writeNarrowShown(surface, narrowNatural(useAgentFormStore.getState().bySurface[surface]) === 'float' ? null : 'float')
}

/** 收成小球。宽窗记下「收着」（摆法不动）；窄窗档只改此刻。 */
export function collapseAgent(surface: AgentFormSurface): void {
  writeMachineHold(surface, null)
  if (!useAgentFormViewStore.getState().windowNarrow) {
    writePrefs(surface, { collapsed: true })
    return
  }
  writeNarrowShown(surface, narrowNatural(useAgentFormStore.getState().bySurface[surface]) === 'ball' ? null : 'ball')
}

/**
 * 人在形态切换（面板头部、「⋯」、小球右键）里明确选浮窗 / 停靠：照写人选的摆法，并打开。
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

// ── 机器的让位（成对：machineHold ↔ machineRelease）。只写此刻那份，人存的一个字节不动 ─────────────────

/**
 * 机器临时改这一页此刻怎么显示：'ball' = 让开（指向节点时对话挡住画布）；'open' = 摆出来（去画布挑参考图）。
 * 已经是那个样子就不留覆盖（免得一枚没用的覆盖压着之后的样子）。
 */
export function machineHold(surface: AgentFormSurface, hold: 'ball' | 'open'): void {
  const before = shownForm(surface)
  if (hold === 'open' ? before !== 'ball' : before === 'ball') return
  writeMachineHold(surface, hold)
}

/** 机器的让位结束：回到人存的（或窄窗档里人点出来的）那个样子。 */
export function machineRelease(surface: AgentFormSurface): void {
  writeMachineHold(surface, null)
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

export function defaultBallPoint(area: { width: number; height: number }): BallPoint {
  return { x: area.width - BALL_SIZE - EDGE_GAP, y: area.height - BALL_SIZE - EDGE_GAP }
}

export function clampBall(point: BallPoint, area: { width: number; height: number }, size = { width: BALL_SIZE, height: BALL_SIZE }): BallPoint {
  return {
    x: Math.min(Math.max(0, point.x), Math.max(0, area.width - size.width)),
    y: Math.min(Math.max(0, point.y), Math.max(0, area.height - size.height)),
  }
}

/** 拖小球「几乎没动」的界（px，起点到落点的横纵距离之和）：不到算点击，到了算拖动。全仓只此一个数。 */
export const BALL_CLICK_SLOP_PX = 4

/**
 * 拖完小球松手，浏览器照样补发一次 click（react-rnd 不拦；老 bug，见设计卡 2026-10-27-agent-persona「实现时的取舍」第 16 条）。
 * 拖过界：吞掉紧跟着的那一次 click，位置照存；没过界：click 照常开面板。吞的标记只活到这次松手的输入任务结束
 * （click 和 mouseup 在同一个任务里派发）——松手时指针不在按钮上、没有补发 click，下一次真点击也不会被吞。
 */
export function createBallDragClickGuard(schedule: (reset: () => void) => void = (reset) => { setTimeout(reset, 0) }) {
  let start: BallPoint | null = null
  let swallow = false
  return {
    dragStart(point: BallPoint): void {
      start = point
      swallow = false
    },
    /** true = 真拖动了（该存位置）；false = 几乎没动，这是一次点击。 */
    dragStop(point: BallPoint): boolean {
      const from = start
      start = null
      const dragged = from !== null && Math.abs(from.x - point.x) + Math.abs(from.y - point.y) >= BALL_CLICK_SLOP_PX
      swallow = dragged
      if (dragged) schedule(() => { swallow = false })
      return dragged
    },
    /** 这次 click 该不该开面板。 */
    takeClick(): boolean {
      if (!swallow) return true
      swallow = false
      return false
    },
  }
}

export const agentFormStoreLifetime = declareStoreLifetime({
  store: 'useAgentFormStore',
  // 摆法、收没收起、位置是这台机器的界面偏好（每页一份）。
  fields: { bySurface: 'window' },
})

/** 小球什么时候变成「等你确认 N」胶囊（Chrome 板）：只有要你点头的事在等时。 */
export function agentBallIsPill(status: V4DockStatus | null, pendingCount: number): boolean {
  return status === 'needs-confirm' && pendingCount > 0
}

export type AgentBallLook = { pose: NomiAgentPose; dot: 'unread' | 'failed' | null }

/**
 * 小球状态 → 形象长相（2026-10-27 形象拍板；和胶囊判定放在一起，同一件事一处判）。
 * 优先级照 10-08 现状：等你确认 > 出错 > 在跑 / 刚做完 > 空闲；未读是叠加的点，在跑、刚做完照样挂，
 * 出错点占同一个角、出错时不叠未读点。
 */
export function agentBallLook(status: V4DockStatus | null, pendingCount: number, unreadCount: number): AgentBallLook {
  if (agentBallIsPill(status, pendingCount)) return { pose: 'confirm', dot: null }
  if (status === 'failed') return { pose: 'failed', dot: 'failed' }
  const dot = unreadCount > 0 ? 'unread' : null
  if (status === 'running') return { pose: 'running', dot }
  if (status === 'done') return { pose: 'done', dot }
  return { pose: dot ? 'unread' : 'idle', dot }
}
