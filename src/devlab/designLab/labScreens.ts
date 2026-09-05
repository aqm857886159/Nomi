import { AGENT_PANEL_STATES, PANEL_HEIGHT, PANEL_WIDTH } from './agentPanelStates'
import { VENDOR_ORDER_STATES, STAGE_HEIGHT, STAGE_WIDTH } from './vendorOrder/vendorOrderStates'
import type { LabScreen, LabState } from './labScreen'

/**
 * 实验室的**屏注册表**。加一屏 = 在这里加一条 + 在 `tests/ux/design-lab/labStates.mjs` 的
 * `LAB_SCREENS` 里登记它的注册表目录与基线目录（两处必须同时改，门岗会对；
 * 只改一处 = 那一屏要么截不出图、要么留下孤儿基线）。
 */
export const LAB_SCREENS: readonly LabScreen[] = [
  {
    id: 'agent-panel',
    label: 'Agent 面板',
    states: AGENT_PANEL_STATES,
    cell: { width: PANEL_WIDTH, height: PANEL_HEIGHT + 40 },
  },
  {
    id: 'vendor-order',
    label: '供应商偏好',
    states: VENDOR_ORDER_STATES,
    cell: { width: STAGE_WIDTH, height: STAGE_HEIGHT + 40 },
    // 还没给用户看过。拍板前**一张基线都不许有**（见 labScreen.ts 上的说明）。
    pendingApproval: true,
  },
]

export function findLabScreen(id: string | null): LabScreen {
  return LAB_SCREENS.find((screen) => screen.id === id) ?? LAB_SCREENS[0]
}

export function findLabState(screen: LabScreen, id: string | null): LabState | null {
  if (!id) return null
  return screen.states.find((state) => state.id === id) ?? null
}
