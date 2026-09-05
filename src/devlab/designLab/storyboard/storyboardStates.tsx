// 设计实验室 · 分镜表 v6 状态注册表（汇总口）
//
// 真身按主题拆在 `states/`（R9 分层 · R12 巨壳门岗：单文件 ≤800 行）。
// 这里只做一件事：**按固定顺序**把三族拼成一条清单。
// 顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致——
// 走查会拿活页面的 `window.__designLabStates` 和那把源码正则的结果逐项比对，错位当场红。
import { ROW_STATES } from './states/01-rows'
import { SLOT_STATES } from './states/02-slots'
import { ZONE_STATES } from './states/03-zone'
import type { LabState } from '../labScreen'

export const STORYBOARD_STATES: readonly LabState[] = [
  ...ROW_STATES,
  ...SLOT_STATES,
  ...ZONE_STATES,
]
