// 设计实验室 · 屏「画布加号收束」的状态注册表（汇总口）。
//
// 真身按主题拆在 `states/`（R9 分层 · R12 巨壳门岗：单文件 ≤800 行）。
// 这里只做一件事：**按固定顺序**拼成一条清单，顺序必须与
// `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致。
//
// 这屏的基线**还没录**：接触表要先给用户看过（calibration.json 的
// pendingApprovalScreens 里有一条显式登记，拍板录完基线就删掉它）。
import { CANVAS_ADD_MENU_STATES as ADD_MENU_STATES } from './states/01-add-menu'
import type { LabState } from '../labScreen'

export const CANVAS_ADD_MENU_STATES: readonly LabState[] = [...ADD_MENU_STATES]
