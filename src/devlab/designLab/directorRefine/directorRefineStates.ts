// 设计实验室 · 屏「导演台精修 · 选中才出」的状态注册表（汇总口）。
// 顺序必须与 `tests/ux/design-lab/labStates.mjs` 按文件名排序解析 `states/` 的顺序一致。
import { REFINE_SELECT_TO_SHOW_STATES } from './states/01-refine-select-to-show'
import type { LabState } from '../labScreen'

export const DIRECTOR_REFINE_STATES: readonly LabState[] = [...REFINE_SELECT_TO_SHOW_STATES]
