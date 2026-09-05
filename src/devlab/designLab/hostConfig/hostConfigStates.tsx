// 设计实验室 · 屏「宿主接入配置」的状态注册表（汇总口）
//
// 真身按来源拆在 `states/`（R9 分层 · R12 巨壳门岗：单文件 ≤800 行）。
// 这里只做一件事：**按固定顺序**把各族拼成一条清单。顺序必须与
// `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致——
// 走查会拿活页面的 `window.__designLabStates` 和那把源码正则的结果逐项比对，错位当场红。
//
// 这屏的基线**还没录**：接触表要先给用户看过（calibration.json 的
// pendingApprovalScreens 里有一条显式登记，拍板录完基线就删掉它）。
import { HOST_CONFIG_STATES as REPAIRED_NOTICE_STATES } from './states/01-repaired-notice'
import type { LabState } from '../labScreen'

export const HOST_CONFIG_STATES: readonly LabState[] = [...REPAIRED_NOTICE_STATES]
