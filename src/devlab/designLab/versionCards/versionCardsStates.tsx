// 设计实验室 · 屏「画布 · 版本卡片（宫格）」的状态注册表（汇总口）。
// 真身按主题拆在 `states/`；顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致。
//
// 用户 10-06 拍板宫格样张；V2 已接进节点，格子渲染的是现役 BaseGenerationNode。基线待在 darwin 上录（calibration.json 登记）。
import { VERSION_CARD_GRID_STATES } from './states/01-grid'
import { VERSION_ENTRY_STATES } from './states/02-entry-bottom'
import type { LabState } from '../labScreen'

export const VERSION_CARDS_STATES: readonly LabState[] = [...VERSION_CARD_GRID_STATES, ...VERSION_ENTRY_STATES]
