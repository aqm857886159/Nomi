import { CANVAS_ADD_MENU_STATES } from './canvasAddMenu/canvasAddMenuStates'
import { CANVAS_ADD_CELL_HEIGHT, CANVAS_ADD_CELL_WIDTH } from './canvasAddMenu/canvasAddMenuLabKit'
import { EDITING_STATES } from './editing/editingStates'
import { STORYBOARD_STATES } from './storyboard/storyboardStates'
import { STAGE_HEIGHT, STAGE_WIDTH } from './storyboard/storyboardLabKit'
import { EDITING_CELL_HEIGHT, EDITING_CELL_WIDTH } from './editing/editingLabKit'
import { HOST_CONFIG_STATES } from './hostConfig/hostConfigStates'
import { SETTINGS_STATES } from './settings/settingsStates'
import { SETTINGS_CELL_HEIGHT, SETTINGS_CELL_WIDTH } from './settings/settingsLabKit'
import { AGENT_PANEL_V4_STATES, V4_CELL_HEIGHT, V4_PANEL_WIDTH } from './v4/agentPanelV4States'
import { VENDOR_ORDER_STATES } from './vendorOrder/vendorOrderStates'
import { STAGE_HEIGHT as VENDOR_ORDER_STAGE_HEIGHT, STAGE_WIDTH as VENDOR_ORDER_STAGE_WIDTH } from './vendorOrder/vendorOrderLabKit'
import type { LabScreen, LabState } from './labScreen'

/**
 * 实验室的**屏注册表**。加一屏 = 在这里加一条 + 在 `tests/ux/design-lab/labStates.mjs` 的
 * `LAB_SCREENS` 里登记它的注册表目录与基线目录（两处必须同时改，门岗会对；
 * 只改一处 = 那一屏要么截不出图、要么孤儿基线）。
 */
export const LAB_SCREENS: readonly LabScreen[] = [
  {
    id: 'agent-panel-v4',
    label: 'Agent 面板 v4',
    states: AGENT_PANEL_V4_STATES,
    // 这屏大多数格子是**单个积木**（Vocabulary / Composer 两组），只有 Flow 那几张渲整块面板。
    // 取景框按面板宽 390 开列，整块面板那几格用 span:2 占两列。
    cell: { width: V4_PANEL_WIDTH, height: V4_CELL_HEIGHT },
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
  {
    id: 'host-config',
    label: '宿主接入配置',
    // 这一族是 toast：走 Mantine 单容器 Portal 到 body、fixed 贴在视口右上角，
    // 所以每个状态都声明 capture: 'viewport'，取景格按整个视口开列。
    cell: { width: 720, height: 420 },
    states: HOST_CONFIG_STATES,
  },
  {
    id: 'canvas-add-menu',
    label: '画布 · 加号收束',
    states: CANVAS_ADD_MENU_STATES,
    // 三格取景一样大：左缘工具条 + 它右侧展开的菜单要同框，右键菜单也按同一格开列，
    // 免得「常驻」与「展开」两格宽度不同、看不出是同一条工具条。
    cell: { width: CANVAS_ADD_CELL_WIDTH, height: CANVAS_ADD_CELL_HEIGHT },
  },
  {
    id: 'settings',
    label: '设置 · 隐私与诊断',
    states: SETTINGS_STATES,
    // 这屏各状态取景框一样大（设置内容区实际可用宽），尺寸从取景台取，不另抄一个数。
    cell: { width: SETTINGS_CELL_WIDTH, height: SETTINGS_CELL_HEIGHT },
  },
  {
    id: 'vendor-order',
    label: '供应商偏好',
    states: VENDOR_ORDER_STATES,
    cell: { width: VENDOR_ORDER_STAGE_WIDTH, height: VENDOR_ORDER_STAGE_HEIGHT + 40 },
  },
]

export function findLabScreen(id: string | null): LabScreen {
  return LAB_SCREENS.find((screen) => screen.id === id) ?? LAB_SCREENS[0]
}

export function findLabState(screen: LabScreen, id: string | null): LabState | null {
  if (!id) return null
  return screen.states.find((state) => state.id === id) ?? null
}
