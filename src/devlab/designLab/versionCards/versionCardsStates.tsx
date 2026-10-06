// 设计实验室 · 屏「画布 · 版本卡片（宫格）」的状态注册表（汇总口）。
// 真身按主题拆在 `states/`；顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致。
//
// 这屏的基线还没录：样张等用户拍板（calibration.json 的 pendingApprovalScreens 有登记）。
import { VERSION_CARD_GRID_STATES } from './states/01-grid'
import type { LabState } from '../labScreen'

export const VERSION_CARDS_STATES: readonly LabState[] = [...VERSION_CARD_GRID_STATES]
