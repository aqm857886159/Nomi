// 设计实验室 · primitive 陈列「表单与选择」屏状态注册表（汇总口）。
//
// 拼接顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致。
import { INPUT_STATES } from './states/01-inputs'
import { SELECTION_STATES } from './states/02-selection'
import type { LabState } from '../labScreen'

export const PRIMITIVES_FORMS_STATES: readonly LabState[] = [
  ...INPUT_STATES,
  ...SELECTION_STATES,
]
