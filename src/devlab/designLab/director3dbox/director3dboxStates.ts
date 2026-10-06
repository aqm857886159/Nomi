// 设计实验室 · 屏「导演视图（3D-BOX）」的状态注册表（汇总口）。
// 顺序必须与 `tests/ux/design-lab/labStates.mjs` 按文件名排序解析 `states/` 的顺序一致。
import { DIRECTOR_VIEW_STATES } from './states/01-director-view'
import { SHOT_FOCUS_STATES } from './states/02-shot-focus'
import type { LabState } from '../labScreen'

export const DIRECTOR_3DBOX_STATES: readonly LabState[] = [...DIRECTOR_VIEW_STATES, ...SHOT_FOCUS_STATES]
