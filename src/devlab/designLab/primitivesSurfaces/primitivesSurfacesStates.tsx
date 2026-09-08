// 设计实验室 · primitive 陈列「状态 / 浮层 / 结构」屏状态注册表（汇总口）。
//
// 拼接顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致。
import { STATUS_STATES } from './states/01-status'
import { OVERLAY_STATES } from './states/02-overlays'
import { STRUCTURE_STATES } from './states/03-structure'
import type { LabState } from '../labScreen'

export const PRIMITIVES_SURFACES_STATES: readonly LabState[] = [
  ...STATUS_STATES,
  ...OVERLAY_STATES,
  ...STRUCTURE_STATES,
]
