// 设计实验室 · 导演台精修「选中才出」（方向 A）· 样张格。
//
// 2026-10-04 用户拍板精修走方向 A：3D 视口满宽，点谁谁的属性卡才出来；大纲 / 资产 / 场景设置各一次点击可达；旧导演台一起变。
// 每一格都是现役 DirectorEditor + 现役 Agent 面板（取景台与夹具复用 director3dbox 屏的那一份），数据是 S1 oracle 计划
// courtyard-standoff 经现役编译器编出的庭院对峙工程；格子要的状态全是**点界面上的真按钮**点出来的（drive / steps），
// 不往 store 塞状态。2026-10-04 用户拍板后这就是真实精修 / 旧导演台本身（样张期接缝已删），coverage 是 shell。
// 设计卡：docs/plan/2026-10-04-director-refine-select-to-show.md。
import React from 'react'
import type { LabState } from '../../labScreen'
import type { LabStep } from '../../director3dbox/director3dboxCell'
import { Director3dBoxLazyStage } from '../../director3dbox/director3dboxLazyStage'

const SOURCE = 'docs/plan/2026-10-04-director-refine-select-to-show.md · 精修方向 A「选中才出」（2026-10-04 用户拍板）'

// 庭院对峙里的名字是工程数据（编译器从计划里带出来的），不随界面语言变
const GUARD = '黑衣侍卫'
const CAMERA = 'medium'
const OPEN_SCENE_MENU: LabStep = { click: '[data-testid="director-scene-menu"]' }
const PICK_GUARD: readonly LabStep[] = [
  OPEN_SCENE_MENU,
  { clickText: { selector: '[data-testid="director-outliner-row"]', text: GUARD } },
  OPEN_SCENE_MENU,
]
const PICK_CAMERA: readonly LabStep[] = [
  OPEN_SCENE_MENU,
  { clickText: { selector: '[data-testid="director-outliner-row"]', text: CAMERA } },
  OPEN_SCENE_MENU,
]
const tab = (label: string): LabStep => ({ clickText: { selector: '[data-testid="director-context-card"] [role="radio"]', text: label } })
const menuItem = (label: string): LabStep => ({ clickText: { selector: '[data-nomi-escape-layer="director-popover"] button', text: label } })
const OPEN_ADD_MENU: LabStep = { click: '[data-testid="director-add-menu"]' }
const OPEN_ASSETS: readonly LabStep[] = [OPEN_ADD_MENU, { click: '[data-testid="director-open-assets"]' }]
const ENTER_REFINE: LabStep = { click: '[data-testid="director-view-header"] button[aria-pressed="false"]' }
/** 时间轴「＋ 添加轨道」把侍卫放上时间轴（AI 编出的工程没有轨道，S1 线在修），再按下他的走路片段 */
const PICK_GUARD_CLIP: readonly LabStep[] = [
  { clickText: { selector: '[data-testid="director-timeline-tracks-header"] button', text: '添加轨道' } },
  menuItem(GUARD),
  { pointer: { selector: '[data-testid="director-timeline-lanes"] [data-clip-id]', text: 'standard_walk' } },
]
/** 窄格：Agent 面板 520 → 壳 728（真机最小窗 1100 × 默认 Agent 时的壳宽） */
const NARROW_AGENT = 520
// 每格的步骤都是模块级常量：取景台按引用比较步骤，渲染里现拼数组会让它每帧重新驱动一遍
const GUARD_POSE: readonly LabStep[] = [...PICK_GUARD, tab('姿态')]
const GUARD_SKELETON: readonly LabStep[] = [...PICK_GUARD, tab('骨骼')]
const CAMERA_POV_ZH: readonly LabStep[] = [...PICK_CAMERA, { clickText: { selector: 'button', text: '进入视角' } }]
const CAMERA_POV_EN: readonly LabStep[] = [...PICK_CAMERA, { clickText: { selector: 'button', text: 'Enter POV' } }]
const SCENE_MENU_ONLY: readonly LabStep[] = [OPEN_SCENE_MENU]
const SCENE_SETTINGS_ZH: readonly LabStep[] = [OPEN_SCENE_MENU, menuItem('场景设置')]
const SCENE_SETTINGS_EN: readonly LabStep[] = [OPEN_SCENE_MENU, menuItem('Scene settings')]
const ADD_MENU_ONLY: readonly LabStep[] = [OPEN_ADD_MENU]
const VIEW_MENU_ONLY: readonly LabStep[] = [{ click: '[data-testid="director-view-menu"]' }]
const OUTPUTS_MENU_ONLY: readonly LabStep[] = [{ click: '[data-testid="director-outputs"]' }]
const EMPTY_REFINE: readonly LabStep[] = [ENTER_REFINE]

export const REFINE_SELECT_TO_SHOW_STATES: readonly LabState[] = [
  {
    id: 'd3a-idle-zh',
    name: '精修 · 空闲（什么都没选）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" />,
  },
  {
    id: 'd3a-idle-en',
    name: '精修 · 空闲（什么都没选）· 英文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="courtyard" drive="shot-2-refine" />,
  },
  {
    id: 'd3a-guard-zh',
    name: '精修 · 选中黑衣侍卫（基础页）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={PICK_GUARD} />,
  },
  {
    id: 'd3a-guard-en',
    name: '精修 · 选中黑衣侍卫（基础页）· 英文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="courtyard" drive="shot-2-refine" steps={PICK_GUARD} />,
  },
  {
    id: 'd3a-guard-pose-zh',
    name: '精修 · 选中黑衣侍卫（姿态页）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={GUARD_POSE} />,
  },
  {
    id: 'd3a-guard-skeleton-zh',
    name: '精修 · 选中黑衣侍卫（骨骼页，内容最高）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={GUARD_SKELETON} />,
  },
  {
    id: 'd3a-camera-follow-zh',
    name: '精修 · 选中机位 medium（左下小窗自动切到 medium）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={PICK_CAMERA} />,
  },
  {
    id: 'd3a-camera-follow-en',
    name: '精修 · 选中机位 medium（左下小窗自动切到 medium）· 英文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="courtyard" drive="shot-2-refine" steps={PICK_CAMERA} />,
  },
  {
    id: 'd3a-camera-pov-zh',
    name: '精修 · 选中机位 medium 并进入视角（取景框）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={CAMERA_POV_ZH} />,
  },
  {
    id: 'd3a-camera-pov-en',
    name: '精修 · 选中机位 medium 并进入视角（取景框）· 英文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="courtyard" drive="shot-2-refine" steps={CAMERA_POV_EN} />,
  },
  {
    id: 'd3a-clip-zh',
    name: '精修 · 加轨道后选中侍卫的片段 · 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={PICK_GUARD_CLIP} />,
  },
  {
    id: 'd3a-scene-menu-zh',
    name: '精修 · 「场景 ▾」展开（大纲 + 场景设置）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={SCENE_MENU_ONLY} />,
  },
  {
    id: 'd3a-scene-menu-en',
    name: '精修 · 「场景 ▾」展开（大纲 + 场景设置）· 英文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="courtyard" drive="shot-2-refine" steps={SCENE_MENU_ONLY} />,
  },
  {
    id: 'd3a-scene-settings-zh',
    name: '精修 · 场景设置卡（环境 / 网格 / 全局变换）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={SCENE_SETTINGS_ZH} />,
  },
  {
    id: 'd3a-scene-settings-en',
    name: '精修 · 场景设置卡（环境 / 网格 / 全局变换）· 英文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="courtyard" drive="shot-2-refine" steps={SCENE_SETTINGS_EN} />,
  },
  {
    id: 'd3a-add-menu-zh',
    name: '精修 · 「＋」展开（底部有资产库）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={ADD_MENU_ONLY} />,
  },
  {
    id: 'd3a-assets-zh',
    name: '精修 · 资产库抽屉（左）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={OPEN_ASSETS} />,
  },
  {
    id: 'd3a-assets-en',
    name: '精修 · 资产库抽屉（左）· 英文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="courtyard" drive="shot-2-refine" steps={OPEN_ASSETS} />,
  },
  {
    id: 'd3a-view-menu-zh',
    name: '精修 · 「视图 ▾」展开（首项重置视角）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={VIEW_MENU_ONLY} />,
  },
  {
    id: 'd3a-outputs-menu-zh',
    name: '精修 · 「产出」展开（首行录制 MP4）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={OUTPUTS_MENU_ONLY} />,
  },
  {
    id: 'd3a-outputs-menu-en',
    name: '精修 · 「产出」展开（首行录制 MP4）· 英文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="courtyard" drive="shot-2-refine" steps={OUTPUTS_MENU_ONLY} />,
  },
  {
    id: 'd3a-narrow-idle-zh',
    name: '窄窗（壳 728）· 精修空闲（图层名只留图标）· 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" agentWidth={NARROW_AGENT} />,
  },
  {
    id: 'd3a-narrow-guard-zh',
    name: '窄窗（壳 728）· 选中黑衣侍卫 · 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" agentWidth={NARROW_AGENT} steps={PICK_GUARD} />,
  },
  {
    id: 'd3a-narrow-idle-en',
    name: '窄窗（壳 728）· 精修空闲（图层名只留图标）· 英文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="courtyard" drive="shot-2-refine" agentWidth={NARROW_AGENT} />,
  },
  {
    id: 'd3a-empty-zh',
    name: '空工程 · 精修 · 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="empty" steps={EMPTY_REFINE} />,
  },
  {
    id: 'd3a-legacy-guard-zh',
    name: '旧导演台（3D-BOX 开关关）· 同一布局 · 选中黑衣侍卫 · 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" flag="off" steps={PICK_GUARD} />,
  },
  {
    id: 'd3a-light-guard-zh',
    name: '浅色模式下打开精修（导演台永远暗，2026-09-09 拍板）· 选中黑衣侍卫 · 中文',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'light',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2-refine" steps={PICK_GUARD} />,
  },
]
