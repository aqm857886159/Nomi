// Agent 三形态（小球 / 浮窗 / 停靠）的唯一 owner（10-08 外壳重设计，设计卡格 ★2）。
//
// 每一页记住自己的形态、浮窗位置与大小、小球位置。位置 / 大小的**拖动与改大小**交给 react-rnd，
// 这里只存结果；只有一件事是自己算的：窗口缩小 / 浮窗被拖出可见区时把它夹回来（`clampRect`），
// 因为 react-rnd 的 `bounds` 只在拖动中生效、容器变小时不会重新夹（见设计卡格 ★3）。
//
// `projectAgentDockCollapsed`（Agent 的 layout.read/write 契约里叫 visibility.assistant）只由这里的形态单向写
// （形态 = 小球 ⇔ 收起，ShellAgentHost 那条 effect），不并存两份各说各的「Agent 现在占不占位」。
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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
}

function initialSurfaces(): Record<AgentFormSurface, SurfaceForm> {
  return {
    creation: { form: AGENT_FORM_DEFAULTS.creation, float: null, ball: null },
    storyboard: { form: AGENT_FORM_DEFAULTS.storyboard, float: null, ball: null },
    generation: { form: AGENT_FORM_DEFAULTS.generation, float: null, ball: null },
    preview: { form: AGENT_FORM_DEFAULTS.preview, float: null, ball: null },
  }
}

export const useAgentFormStore = create<AgentFormState>()(persist((set) => ({
  bySurface: initialSurfaces(),
  dockSuppressed: false,
  setDockSuppressed: (dockSuppressed) => set((state) => (state.dockSuppressed === dockSuppressed ? state : { dockSuppressed })),
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
  fields: { bySurface: 'window', dockSuppressed: 'project' },
  releaseProject: () => useAgentFormStore.setState({ dockSuppressed: false }),
})

/**
 * 这一页**此刻**的形态。只有一条派生：有东西要整块右边时（例如生成页列表的大详情置位 dockSuppressed），
 * 停靠 = 小球；那东西关掉就回停靠——不写回形态，所以「回来」不需要记任何东西。
 */
export function useEffectiveAgentForm(surface: AgentFormSurface): AgentForm {
  const stored = useAgentFormStore((state) => state.bySurface[surface].form)
  const dockSuppressed = useAgentFormStore((state) => state.dockSuppressed)
  if (dockSuppressed && stored === 'dock') return 'ball'
  return stored
}

/** 小球什么时候变成「等你确认 N」胶囊（Chrome 板）：只有要你点头的事在等时。 */
export function agentBallIsPill(status: V4DockStatus | null, pendingCount: number): boolean {
  return status === 'needs-confirm' && pendingCount > 0
}
