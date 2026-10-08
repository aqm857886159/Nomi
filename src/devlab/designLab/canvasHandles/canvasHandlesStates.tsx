// 设计实验室 · 屏「画布 · 左右拉环与空节点『试试』（提案）」的状态注册表（汇总口）。
// 真身按主题拆在 `states/`；顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致。
import { HANDLE_STATES } from './states/01-handles'
import { TRY_STATES } from './states/02-try'
import { NOW_STATES } from './states/03-now'
import type { LabState } from '../labScreen'

export const CANVAS_HANDLES_STATES: readonly LabState[] = [...HANDLE_STATES, ...TRY_STATES, ...NOW_STATES]
