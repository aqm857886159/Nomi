// Agent 三形态（小球 / 浮窗 / 停靠）的唯一 owner（10-08 外壳重设计，设计卡格 ★2）。
//
// 每一页记住自己的形态、浮窗位置与大小、小球位置。位置 / 大小的**拖动与改大小**交给 react-rnd，
// 这里只存结果；只有一件事是自己算的：窗口缩小 / 浮窗被拖出可见区时把它夹回来（`clampRect`），
// 因为 react-rnd 的 `bounds` 只在拖动中生效、容器变小时不会重新夹（见设计卡格 ★3）。
//
// Nomi 栏开没开**记在这台机器上**，就是这里每页的形态（用户 2026-11-13 拍板「跟机器走」）；不写进项目文件。
// 显示态 `projectAgentDockCollapsed`（Agent layout.read 的 visibility.assistant）只由这里的形态单向写
// （形态 = 小球 ⇔ 收起，ShellAgentHost 那条 effect），不并存两份各说各的「Agent 现在占不占位」。
//
// 窄窗档（WindowNarrow 板，用户 2026-11-07 拍板）：窗口宽 < 1060 时，存着「停靠」的那一页**这一刻**显示成小球，
// 点开是浮窗；宽回来自动停回。窄窗档是纯显示档：点开、收起只改「这一刻怎么摆」（narrowShown），存下的形态一个字节不改，
// 不管存的是停靠、小球还是浮窗——只有人在形态切换里明确选的那一下才写（chooseForm）。
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ASSISTANT_CONTENT_FLOOR, ASSISTANT_WIDTH_MIN } from '../../../workbench/assistantWidthBounds'
import { declareStoreLifetime } from '../../../workbench/project/storeLifetime'
import type { V4DockStatus } from '../../../workbench/ai/v4/agentPanelV4DockStatus'
import type { NomiAgentPose } from '../../../design'

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

/** 窄窗档里「这一刻」的摆法覆盖；null = 按存档派生。 */
export type NarrowShown = 'ball' | 'float' | null

/** 窄窗档里没人点过时，这一页按存档该怎么摆：停靠放不下 = 小球；小球、浮窗照存档。 */
function narrowNatural(stored: AgentForm): 'ball' | 'float' {
  return stored === 'float' ? 'float' : 'ball'
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
  /**
   * 窄窗档里人点开 / 收起之后**这一刻**怎么摆：null = 按存档的样子（停靠、小球 → 小球；浮窗 → 浮窗）；
   * 'float' = 点开成临时浮窗；'ball' = 收成小球。跨阈值即复位。不持久化。
   */
  narrowShown: NarrowShown
  narrowMotion: NarrowMotion
  /** `animate: false` = 启动时的第一次对齐，不是「跨过」阈值，不播过渡。 */
  setWindowNarrow: (narrow: boolean, options?: { animate?: boolean }) => void
  clearNarrowMotion: () => void
  /**
   * 点开 / 收起（小球点开 / 右键、⌘J、Mod+\\、别处叫回、指向节点时让开）的唯一入口。
   * 宽窗照常写形态；窄窗档只改这一刻怎么摆（narrowShown），不写存档——宽回来是存下的那个样子。
   */
  requestForm: (surface: AgentFormSurface, form: AgentForm) => void
  /**
   * 人在形态切换（面板头部三选一、「⋯」菜单）里明确选的形态。宽窗 = 写；窄窗档里只有存着浮窗的页
   * （窄窗里它就是真浮窗）照写，存着停靠 / 小球的页此刻是临时浮窗，选小球 = 收起，同 requestForm 不写。
   */
  chooseForm: (surface: AgentFormSurface, form: AgentForm) => void
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
  narrowShown: null,
  narrowMotion: null,
  setDockSuppressed: (dockSuppressed) => set((state) => (state.dockSuppressed === dockSuppressed ? state : { dockSuppressed })),
  setWindowNarrow: (windowNarrow, options) => set((state) => (state.windowNarrow === windowNarrow ? state : {
    windowNarrow,
    narrowShown: null,
    narrowMotion: options?.animate === false ? null : windowNarrow ? 'collapse' : 'restore',
  })),
  clearNarrowMotion: () => set((state) => (state.narrowMotion === null ? state : { narrowMotion: null })),
  requestForm: (surface, form) => {
    const state = get()
    if (!state.windowNarrow) {
      state.setForm(surface, form)
      return
    }
    // 窄窗里停靠放不下：要停靠 = 要打开 = 此刻浮窗。
    const want = form === 'dock' ? 'float' : form
    const narrowShown = want === narrowNatural(state.bySurface[surface].form) ? null : want
    if (state.narrowShown !== narrowShown) set({ narrowShown })
  },
  chooseForm: (surface, form) => {
    const state = get()
    if (state.windowNarrow && state.bySurface[surface].form !== 'float') {
      state.requestForm(surface, form)
      return
    }
    state.setForm(surface, form)
    if (state.narrowShown !== null) set({ narrowShown: null })
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
  // 形态与位置是这台机器的界面偏好（每页一份）；「此刻有东西要整块右边」只在这个项目里有意义。
  fields: { bySurface: 'window', dockSuppressed: 'project', windowNarrow: 'window', narrowShown: 'window', narrowMotion: 'window' },
  releaseProject: () => useAgentFormStore.setState({ dockSuppressed: false }),
})

/**
 * 这一页**此刻**的形态。两条派生，都不写回形态（所以「回来」不需要记任何东西）：
 *  - 窄窗档（窗口宽 < NARROW_TIER_WIDTH）：人点开 / 收起过就按 narrowShown 摆；没点过：停靠 = 小球，小球、浮窗照存档；
 *  - 有东西要整块右边时（例如生成页列表的大详情置位 dockSuppressed）：停靠 = 小球。
 */
export function effectiveAgentForm(
  stored: AgentForm,
  view: { windowNarrow: boolean; narrowShown: NarrowShown; dockSuppressed: boolean },
): AgentForm {
  if (view.windowNarrow) return view.narrowShown ?? narrowNatural(stored)
  if (stored !== 'dock') return stored
  return view.dockSuppressed ? 'ball' : 'dock'
}

export function useEffectiveAgentForm(surface: AgentFormSurface): AgentForm {
  const stored = useAgentFormStore((state) => state.bySurface[surface].form)
  const windowNarrow = useAgentFormStore((state) => state.windowNarrow)
  const narrowShown = useAgentFormStore((state) => state.narrowShown)
  const dockSuppressed = useAgentFormStore((state) => state.dockSuppressed)
  return effectiveAgentForm(stored, { windowNarrow, narrowShown, dockSuppressed })
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
