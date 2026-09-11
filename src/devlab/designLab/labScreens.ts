import { FIND_REFERENCE_STATES } from './findReference/states/01-find-reference'
import { CREATION_COLUMNS_STATES } from './creationColumns/states/01-columns'
import { SHOT_TABLE_STATES } from './shotTable/states/01-table'
import { PROCESS_FEEDBACK_STATES } from './processFeedback/states/01-process-feedback'
import { SETTINGS_SOUND_STATES } from './settingsSound/states/01-sound'
import { CATALOG_LIVENESS_STATES } from './catalogLiveness/states/01-listing'
import { CANVAS_ADD_MENU_STATES } from './canvasAddMenu/canvasAddMenuStates'
import { CANVAS_FRAME_STATES } from './canvasFrame/canvasFrameStates'
import { NODE_COMPOSER_BAR_STATES } from './nodeComposerBar/nodeComposerBarStates'
import { NODE_COMPOSER_BAR_CELL_HEIGHT, NODE_COMPOSER_BAR_CELL_WIDTH } from './nodeComposerBar/nodeComposerBarLabKit'
import { CANVAS_FRAME_CELL_HEIGHT, CANVAS_FRAME_CELL_WIDTH } from './canvasFrame/canvasFrameLabKit'
import { CANVAS_ADD_CELL_HEIGHT, CANVAS_ADD_CELL_WIDTH } from './canvasAddMenu/canvasAddMenuLabKit'
import { EDITING_STATES } from './editing/editingStates'
import { STORYBOARD_STATES } from './storyboard/storyboardStates'
import { STAGE_HEIGHT, STAGE_WIDTH } from './storyboard/storyboardLabKit'
import { EDITING_CELL_HEIGHT, EDITING_CELL_WIDTH } from './editing/editingLabKit'
import { HOST_CONFIG_STATES } from './hostConfig/hostConfigStates'
import { PRIMITIVE_CELL_HEIGHT, PRIMITIVE_STAGE_WIDTH } from './primitives/primitivesLabKit'
import { PRIMITIVES_ACTIONS_STATES } from './primitivesActions/primitivesActionsStates'
import { PRIMITIVES_FORMS_STATES } from './primitivesForms/primitivesFormsStates'
import { PRIMITIVES_MENU_STATES } from './primitivesMenu/primitivesMenuStates'
import { PRIMITIVES_SURFACES_STATES } from './primitivesSurfaces/primitivesSurfacesStates'
import { SETTINGS_STATES } from './settings/settingsStates'
import { SETTINGS_CELL_HEIGHT, SETTINGS_CELL_WIDTH } from './settings/settingsLabKit'
import { AGENT_PANEL_V4_STATES, V4_CELL_HEIGHT, V4_PANEL_WIDTH } from './v4/agentPanelV4States'
import { VENDOR_ORDER_STATES } from './vendorOrder/vendorOrderStates'
import { VIDEO_DEPTH_STATES } from './videoDepth/videoDepthStates'
import { DEPTH_ACTION_CELL_HEIGHT, DEPTH_ACTION_CELL_WIDTH } from './videoDepth/videoDepthLabKit'
import { STAGE_HEIGHT as VENDOR_ORDER_STAGE_HEIGHT, STAGE_WIDTH as VENDOR_ORDER_STAGE_WIDTH } from './vendorOrder/vendorOrderLabKit'
import type { LabScreen, LabState } from './labScreen'

/**
 * 实验室的**屏注册表**。加一屏 = 在这里加一条 + 在 `tests/ux/design-lab/labStates.mjs` 的
 * `LAB_SCREENS` 里登记它的注册表目录与基线目录（两处必须同时改，门岗会对；
 * 只改一处 = 那一屏要么截不出图、要么孤儿基线）。
 */
export const LAB_SCREENS: readonly LabScreen[] = [
  { id: 'find-reference', label: '找参考', states: FIND_REFERENCE_STATES, cell: { width: 1260, height: 650 } },
  { id: 'shot-table', label: '画布 · 分镜表', states: SHOT_TABLE_STATES, cell: { width: 992, height: 452 } },
  { id: 'process-feedback', label: '生成过程反馈 C1', states: PROCESS_FEEDBACK_STATES, cell: { width: 800, height: 560 } },
  { id: 'settings-sound', label: '提醒与声音', states: SETTINGS_SOUND_STATES, cell: { width: 564, height: 550 } },
  { id: 'catalog-liveness', label: '模型目录活性', states: CATALOG_LIVENESS_STATES, cell: { width: 960, height: 760 } },
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
    id: 'canvas-frame',
    label: '画布 · 框工具',
    states: CANVAS_FRAME_STATES,
    // 六格取景一样大：框的几何是这一屏要看的东西，格子不同宽就没法一眼比出
    // 「空框 / 有内容 / 拖入 / 拖出」四态里框的边界有没有变。
    cell: { width: CANVAS_FRAME_CELL_WIDTH, height: CANVAS_FRAME_CELL_HEIGHT },
  },
  {
    id: 'node-composer-bar',
    label: '画布 · 节点生成浮框底栏',
    states: NODE_COMPOSER_BAR_STATES,
    // 八格取景一样大：这一屏要人比的是「同一个浮框，改前 vs 改后底栏里有什么」。
    // 格子不同宽，「挤没挤」就无从比起。
    cell: { width: NODE_COMPOSER_BAR_CELL_WIDTH, height: NODE_COMPOSER_BAR_CELL_HEIGHT },
  },
  {
    id: 'settings',
    label: '设置 · 隐私与诊断',
    states: SETTINGS_STATES,
    // 这屏各状态取景框一样宽（设置内容区实际可用宽），尺寸从取景台取，不另抄一个数。
    // 高度按最高的那一格给：「用 AI 帮我接入」展开三步图后比隐私那一格高。
    cell: { width: SETTINGS_CELL_WIDTH, height: SETTINGS_CELL_HEIGHT },
  },
  // ── primitive 陈列三屏 ────────────────────────────────────────────────────
  //
  // 上面每一屏画的都是**某个功能界面**；这三屏画的是 `src/design/` 那套共用积木本身。
  // 为什么拆三屏而不是一屏：接触表是按屏平铺的一张图，34 个格子挤在一屏里读不动；
  // 而且取景框是**按屏**给的一个尺寸——动作族一格 480 宽就够，浮层族要整屏、结构族要
  // 装得下一张表，硬塞进同一个 cell 会让一半格子留大片空白、另一半被截。按族分屏，
  // 每族拿自己合适的取景框，接触表也各自读得完。
  {
    id: 'primitives-actions',
    label: '积木 · 动作',
    states: PRIMITIVES_ACTIONS_STATES,
    cell: { width: PRIMITIVE_STAGE_WIDTH, height: PRIMITIVE_CELL_HEIGHT },
  },
  {
    id: 'primitives-forms',
    label: '积木 · 表单与选择',
    states: PRIMITIVES_FORMS_STATES,
    // 表单格比动作格高一档（四态竖排 + 展开的下拉都在这一屏）。
    cell: { width: PRIMITIVE_STAGE_WIDTH, height: PRIMITIVE_CELL_HEIGHT + 120 },
  },
  {
    id: 'primitives-menu',
    label: '积木 · 菜单',
    states: PRIMITIVES_MENU_STATES,
    // 这一屏每一格都是整屏取景：菜单走 Radix Portal 到 body + fixed 贴视口点位，
    // 按元素截只会截出「菜单没打开」。取景框按走查用的那个视口开列。
    cell: { width: 520, height: 420 },
  },
  {
    id: 'primitives-surfaces',
    label: '积木 · 状态 / 浮层 / 结构',
    states: PRIMITIVES_SURFACES_STATES,
    // 这屏混着元素格与整屏格（浮层族 Portal 到 body，只能截整屏），取景框按整屏那一族开列。
    cell: { width: 900, height: 560 },
  },
  {
    id: 'depth-action',
    label: '画布 · 提取深度',
    states: VIDEO_DEPTH_STATES,
    // 十格取景一样大：这一屏要人比的是「这几件东西是不是一家的」，格子不同宽就没法比。
    cell: { width: DEPTH_ACTION_CELL_WIDTH, height: DEPTH_ACTION_CELL_HEIGHT },
  },
  {
    id: 'vendor-order',
    label: '供应商偏好',
    states: VENDOR_ORDER_STATES,
    cell: { width: VENDOR_ORDER_STAGE_WIDTH, height: VENDOR_ORDER_STAGE_HEIGHT + 40 },
  },
  { id: 'creation-columns', label: '创作三栏 · 外框样张', states: CREATION_COLUMNS_STATES, cell: { width: 1440, height: 900 } },
]

export function findLabScreen(id: string | null): LabScreen {
  return LAB_SCREENS.find((screen) => screen.id === id) ?? LAB_SCREENS[0]
}

export function findLabState(screen: LabScreen, id: string | null): LabState | null {
  if (!id) return null
  return screen.states.find((state) => state.id === id) ?? null
}
