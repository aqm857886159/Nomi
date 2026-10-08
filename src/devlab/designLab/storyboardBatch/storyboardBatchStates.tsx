// 设计实验室 · 分镜「批量 / 选择」提案屏的状态注册表（汇总口）。
// 顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致。
import { BATCH_STATES } from './states/01-batch'
import type { LabState } from '../labScreen'

export const STORYBOARD_BATCH_STATES: readonly LabState[] = [...BATCH_STATES]
