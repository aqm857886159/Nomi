// 设计实验室 · Agent 面板 v4 的状态汇总口。
//
// 真身按定稿画布的**板**拆在 `states/`（单文件 ≤800 行，R12 巨壳门岗）。
// 拼接顺序 = 文件名排序，与 `tests/ux/design-lab/labStates.mjs` 那把源码正则的解析顺序一一对应；
// 走查再拿活页面的 `window.__designLabStates` 与解析结果逐项比对——三者对不上当场红。
import { V4_VOCABULARY_STATES } from './states/01-vocabulary'
import { V4_COMPOSER_STATES } from './states/02-composer'
import { V4_FLOW_STATES } from './states/03-flow'
import { V4_WIRED_STATES } from './states/04-wired'
import type { LabState } from '../labScreen'

export const AGENT_PANEL_V4_STATES: readonly LabState[] = [
  ...V4_VOCABULARY_STATES,
  ...V4_COMPOSER_STATES,
  ...V4_FLOW_STATES,
  ...V4_WIRED_STATES,
]

export { V4_CELL_HEIGHT, V4_PANEL_WIDTH } from './agentPanelV4LabKit'
