// 设计实验室 · 屏「画布 · 节点生成浮框底栏」的状态注册表（汇总口）。
// 顺序必须与 `tests/ux/design-lab/labStates.mjs` 按文件名排序解析 `states/` 的顺序一致。
import { COMPOSER_BAR_STATES } from './states/01-bar'
import type { LabState } from '../labScreen'

export const NODE_COMPOSER_BAR_STATES: readonly LabState[] = [...COMPOSER_BAR_STATES]
