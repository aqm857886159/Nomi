// 设计实验室 · 屏「剪辑面」的状态注册表（汇总口）
//
// 真身按来源拆在 `states/`（R9 分层 · R12 巨壳门岗：单文件 ≤800 行），
// 取景台在 `editingLabKit.tsx`、夹具在 `editingFixtures.ts`。
// 这里只做一件事：**按固定顺序**把四族拼成一条清单。
// 顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致——
// 走查会拿活页面的 `window.__designLabStates` 和那把源码正则的结果逐项比对，错位当场红。
//
// 这屏的基线**还没录**：接触表要先给用户看过（calibration.json 的
// pendingApprovalScreens 里有一条显式登记，拍板录完基线就删掉它）。
import { TRANSITION_PICKER_STATES } from './states/01-transition-picker'
import { INSPECTOR_STATES } from './states/02-inspector'
import { CONTEXT_MENU_STATES } from './states/03-context-menu'
import { SHORTCUTS_STATES } from './states/04-shortcuts'
import type { LabState } from '../labScreen'

export const EDITING_STATES: readonly LabState[] = [
  ...TRANSITION_PICKER_STATES,
  ...INSPECTOR_STATES,
  ...CONTEXT_MENU_STATES,
  ...SHORTCUTS_STATES,
]
