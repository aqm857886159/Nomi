// Agent 三形态（小球 / 浮窗 / 停靠）的唯一 owner（10-08 外壳重设计，设计卡格 ★2）。
//
// 每一页记住自己的形态、浮窗位置与大小、小球位置。位置 / 大小的**拖动与改大小**交给 react-rnd，
// 这里只存结果；只有一件事是自己算的：窗口缩小 / 浮窗被拖出可见区时把它夹回来（`clampRect`），
// 因为 react-rnd 的 `bounds` 只在拖动中生效、容器变小时不会重新夹（见设计卡格 ★3）。
//
// `projectAgentDockCollapsed`（Agent 的 layout.read/write 契约里叫 visibility.assistant）只由这里的形态单向写
// （形态 = 小球 ⇔ 收起，ShellAgentHost 那条 effect），不并存两份各说各的「Agent 现在占不占位」。
//
// 窄窗档（WindowNarrow 板，用户 2026-11-07 拍板）：窗口宽 < 1060 时，存着「停靠」的那一页**这一刻**显示成小球，
// 点开是浮窗；宽回来自动停回。只是派生（同 dockSuppressed），存下的形态一个字节不改——只有人亲手点形态切换才写。
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ASSISTANT_CONTENT_FLOOR, ASSISTANT_WIDTH_MIN } from '../../../workbench/assistantWidthBounds'
import { declareStoreLifetime } from '../../../workbench/project/storeLifetime'
import type { V4DockStatus } from '../../../workbench/ai/v4/agentPanelV4DockStatus'

export type AgentForm = 'ball' | 'float' | 'dock'
export type AgentFormSurface = 'creation' | 'storyboard' | 'generation' | 'preview'
export type FloatRect = { x: number; y: number; width: number; height: number }
export type BallPoint = { x: number; y: number }

type SurfaceForm = {
  form: AgentForm
  /** 浮窗：相对内容区左上角。null = 还没摆过，用默认（右下 384×500，CanvasAgent 板）。 */
  float: FloatRect | null
  /** 小球：相对内容区左上角。null = 默认右下角。 */
  ball: BallPoint | null
}

/** 默认：画布与列表 = 右下角小球；创作、分镜、预览 = 停靠右侧（同今天）。 */
export const AGENT_FORM_DEFAULTS: Record<AgentFormSurface, AgentForm> = {
  creation: 'dock',
  storyboard: 'dock',
  generation: 'ball',
  preview: 'dock',
}

export const FLOAT_MIN = { width: 320, height: 360 } as const
export const FLOAT_DEFAULT = { width: 384, height: 500 } as const
export const BALL_SIZE = 44
/** 浮窗 / 小球离内容区边缘留多少（token 4 = 16px）。 */
export const EDGE_GAP = 16

/**
 * 外壳**唯一**的窄窗判断（WindowNarrow 板 D3、约束 narrow.one-threshold）：窗口宽 < 主内容底线 760 + 停靠栏下限 300。
 * 两个数都是现成的，阈值跟着它们走；各界面内部只按「放不下才收」处理，不再另写窗口宽断点。
 */
export const NARROW_TIER_WIDTH = ASSISTANT_CONTENT_FLOOR + ASSISTANT_WIDTH_MIN
export const NARROW_TIER_QUERY = `(width < ${NARROW_TIER_WIDTH}px)`

/** 跨阈值那一下要播的过渡（停靠收拢成小球 / 小球展回停靠）；拖窗过程中只在跨过阈值时置一次。 */
export type NarrowMotion = 'collapse' | 'restore' | null
/** 过渡标记留多久（tailwind.config.ts 里 nomi-agent-gather / dock-in 播 260ms，略长一点再清）。 */
export const NARROW_MOTION_CLEAR_MS = 320

function initialWindowNarrow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_TIER_QUERY).matches
}

type AgentFormState = {
  bySurface: Record<AgentFormSurface, SurfaceForm>
  setForm: (surface: AgentFormSurface, form: AgentForm) => void
  setFloatRect: (surface: AgentFormSurface, rect: FloatRect) => void
  setBallPoint: (surface: AgentFormSurface, point: BallPoint) => void
  /**
   * 「此刻有别的东西要整块右边」（例如生成页列表点开大详情）：停靠暂时显示成小球，不写回形态，
   * 关掉那块就回停靠。会话态，不持久化。
   */
  dockSuppressed: boolean
  setDockSuppressed: (suppressed: boolean) => void
  /** 窄窗档：窗口宽此刻 < NARROW_TIER_WIDTH。只由 ShellAgentHost 的 matchMedia 写，不持久化。 */
  windowNarrow: boolean
  /** 窄窗档里，被扣住的停靠此刻以浮窗摆出来（人点开了）；跨阈值即复位。不持久化。 */
  narrowOpen: boolean
  narrowMotion: NarrowMotion
  /** `animate: false` = 启动时的第一次对齐，不是「跨过」阈值，不播过渡。 */
  setWindowNarrow: (narrow: boolean, options?: { animate?: boolean }) => void
  clearNarrowMotion: () => void
  /**
   * 人亲手要某个形态（形态切换、小球点开 / 右键、⌘J、Mod+\\、别处叫回）的唯一入口。
   * 窄窗档里停靠被扣着：要小球 / 浮窗只改这一刻怎么摆（narrowOpen），不写存档，宽回来照样停回；
   * 要停靠 = 记下「停靠」、这一刻以浮窗打开。不在窄窗档就照常写形态。
   */
  requestForm: (surface: AgentFormSurface, form: AgentForm) => void
}

function initialSurfaces(): Record<AgentFormSurface, SurfaceForm> {
  return {
    creation: { form: AGENT_FORM_DEFAULTS.creation, float: null, ball: null },
    storyboard: { form: AGENT_FORM_DEFAULTS.storyboard, float: null, ball: null },
    generation: { form: AGENT_FORM_DEFAULTS.generation, float: null, ball: null },
    preview: { form: AGENT_FORM_DEFAULTS.preview, float: null, ball: null },
  }
}

export const useAgentFormStore = create<AgentFormState>()(persist((set, get) => ({
  bySurface: initialSurfaces(),
  dockSuppressed: false,
  windowNarrow: initialWindowNarrow(),
  narrowOpen: false,
  narrowMotion: null,
  setDockSuppressed: (dockSuppressed) => set((state) => (state.dockSuppressed === dockSuppressed ? state : { dockSuppressed })),
  setWindowNarrow: (windowNarrow, options) => set((state) => (state.windowNarrow === windowNarrow ? state : {
    windowNarrow,
    narrowOpen: false,
    narrowMotion: options?.animate === false ? null : windowNarrow ? 'collapse' : 'restore',
  })),
  clearNarrowMotion: () => set((state) => (state.narrowMotion === null ? state : { narrowMotion: null })),
  requestForm: (surface, form) => {
    const state = get()
    const stored = state.bySurface[surface].form
    if (!state.windowNarrow) {
      state.setForm(surface, form)
      return
    }
    if (form === 'dock') {
      if (stored !== 'dock') state.setForm(surface, 'dock')
      if (!state.narrowOpen) set({ narrowOpen: true })
      return
    }
    if (stored === 'dock') {
      const narrowOpen = form === 'float'
      if (state.narrowOpen !== narrowOpen) set({ narrowOpen })
      return
    }
    state.setForm(surface, form)
  },
  setForm: (surface, form) => set((state) => (
    state.bySurface[surface].form === form ? state : { bySurface: { ...state.bySurface, [surface]: { ...state.bySurface[surface], form } } }
  )),
  setFloatRect: (surface, float) => set((state) => ({ bySurface: { ...state.bySurface, [surface]: { ...state.bySurface[surface], float } } })),
  setBallPoint: (surface, ball) => set((state) => ({ bySurface: { ...state.bySurface, [surface]: { ...state.bySurface[surface], ball } } })),
}), { name: 'nomi:shell-agent-form:v1', version: 1, partialize: (state) => ({ bySurface: state.bySurface }) }))

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

export const agentFormStoreLifetime = declareStoreLifetime({
  store: 'useAgentFormStore',
  // 形态与位置是这台机器的界面偏好（每页一份）；「此刻有东西要整块右边」只在这个项目里有意义。
  fields: { bySurface: 'window', dockSuppressed: 'project', windowNarrow: 'window', narrowOpen: 'window', narrowMotion: 'window' },
  releaseProject: () => useAgentFormStore.setState({ dockSuppressed: false }),
})

/**
 * 这一页**此刻**的形态。两条派生，都只作用于存着「停靠」的页，都不写回形态（所以「回来」不需要记任何东西）：
 *  - 窄窗档（窗口宽 < NARROW_TIER_WIDTH）：停靠 = 小球；人点开了（narrowOpen）= 浮窗；
 *  - 有东西要整块右边时（例如生成页列表的大详情置位 dockSuppressed）：停靠 = 小球。
 */
export function effectiveAgentForm(
  stored: AgentForm,
  view: { windowNarrow: boolean; narrowOpen: boolean; dockSuppressed: boolean },
): AgentForm {
  if (stored !== 'dock') return stored
  if (view.windowNarrow) return view.narrowOpen ? 'float' : 'ball'
  return view.dockSuppressed ? 'ball' : 'dock'
}

export function useEffectiveAgentForm(surface: AgentFormSurface): AgentForm {
  const stored = useAgentFormStore((state) => state.bySurface[surface].form)
  const windowNarrow = useAgentFormStore((state) => state.windowNarrow)
  const narrowOpen = useAgentFormStore((state) => state.narrowOpen)
  const dockSuppressed = useAgentFormStore((state) => state.dockSuppressed)
  return effectiveAgentForm(stored, { windowNarrow, narrowOpen, dockSuppressed })
}

/** 非 React 处（快捷键、订阅回调）读「此刻的形态」；和 useEffectiveAgentForm 同一条派生。 */
export function readEffectiveAgentForm(surface: AgentFormSurface): AgentForm {
  const state = useAgentFormStore.getState()
  return effectiveAgentForm(state.bySurface[surface].form, state)
}

/** 小球什么时候变成「等你确认 N」胶囊（Chrome 板）：只有要你点头的事在等时。 */
export function agentBallIsPill(status: V4DockStatus | null, pendingCount: number): boolean {
  return status === 'needs-confirm' && pendingCount > 0
}
