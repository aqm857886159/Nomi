// 设计实验室 · 分镜表「复用画布底栏」提案屏的状态注册表（汇总口）。
// 顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致。
import { REUSE_STATES } from './states/01-reuse'
import type { LabState } from '../labScreen'

export const STORYBOARD_REUSE_STATES: readonly LabState[] = [...REUSE_STATES]
