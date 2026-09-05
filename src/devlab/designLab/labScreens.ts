import { AGENT_PANEL_STATES, PANEL_HEIGHT, PANEL_WIDTH } from './agentPanelStates'
import { EDITING_STATES } from './editing/editingStates'
import { STORYBOARD_STATES } from './storyboard/storyboardStates'
import { STAGE_HEIGHT, STAGE_WIDTH } from './storyboard/storyboardLabKit'
import { EDITING_CELL_HEIGHT, EDITING_CELL_WIDTH } from './editing/editingLabKit'
import type { LabScreen, LabState } from './labScreen'

/**
 * 实验室的**屏注册表**。加一屏 = 在这里加一条 + 在 `tests/ux/design-lab/labStates.mjs` 的
 * `LAB_SCREENS` 里登记它的注册表目录与基线目录（两处必须同时改，门岗会对；
 * 只改一处 = 那一屏要么截不出图、要么孤儿基线）。
 */
export const LAB_SCREENS: readonly LabScreen[] = [
  {
    id: 'agent-panel',
    label: 'Agent 面板',
    states: AGENT_PANEL_STATES,
    cell: { width: PANEL_WIDTH, height: PANEL_HEIGHT + 40 },
  },
  {
    id: 'editing',
    label: '剪辑面',
    states: EDITING_STATES,
    // 这屏各状态取景框大小不一（浮层 300–420 宽、属性面板一条窄柱），
    // 接触表按最宽的那一格开列，免得宽件被挤成两行。
    cell: { width: EDITING_CELL_WIDTH, height: EDITING_CELL_HEIGHT },
  },
  {
    id: 'storyboard',
    label: '分镜表 v6',
    states: STORYBOARD_STATES,
    cell: { width: STAGE_WIDTH, height: STAGE_HEIGHT + 120 },
  },
]

export function findLabScreen(id: string | null): LabScreen {
  return LAB_SCREENS.find((screen) => screen.id === id) ?? LAB_SCREENS[0]
}

export function findLabState(screen: LabScreen, id: string | null): LabState | null {
  if (!id) return null
  return screen.states.find((state) => state.id === id) ?? null
}
