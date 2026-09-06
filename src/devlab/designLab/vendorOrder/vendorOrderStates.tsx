// 设计实验室 · 供应商偏好屏状态注册表（汇总口）
//
// 真身按主题拆在 `states/`（R9 分层 · R12 巨壳门岗：单文件 ≤800 行），共用件在 `vendorOrderLabKit.tsx`。
// 这里只做一件事：**按固定顺序**把两族拼成一条清单。
// 顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致——
// 走查会拿活页面的 `window.__designLabStates` 和那把源码正则的结果逐项比对，错位当场红。
import { PICKER_STATES } from './states/01-picker'
import { SETTINGS_STATES } from './states/02-settings'
import type { LabState } from '../labScreen'

export { STAGE_WIDTH, STAGE_HEIGHT } from './vendorOrderLabKit'

export const VENDOR_ORDER_STATES: readonly LabState[] = [
  ...PICKER_STATES,
  ...SETTINGS_STATES,
]
