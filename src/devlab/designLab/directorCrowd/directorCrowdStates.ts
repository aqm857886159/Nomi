// 设计实验室 · 屏「导演台 · 群众并进加人」的状态注册表（汇总口）。
// 顺序必须与 `tests/ux/design-lab/labStates.mjs` 按文件名排序解析 `states/` 的顺序一致。
import { DIRECTOR_CROWD_STATES } from './states/01-crowd'
import type { LabState } from '../labScreen'

export const DIRECTOR_CROWD_ALL_STATES: readonly LabState[] = [...DIRECTOR_CROWD_STATES]
