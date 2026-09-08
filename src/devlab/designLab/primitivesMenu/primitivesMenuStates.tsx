// 设计实验室 · primitive 陈列「菜单」屏状态注册表（汇总口）。
//
// 真身在 `states/`，共用取景台在 `../primitives/primitivesLabKit.tsx`。这里只做一件事：
// **按固定顺序**把各族拼成一条清单。顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析
// `states/` 的顺序（文件名排序）一致——走查会拿活页面的 `window.__designLabStates` 和
// 那把源码正则的结果逐项比对，错位当场红。
import { PRIMITIVES_MENU_STATES as MENU_STATES } from './states/01-menu'
import type { LabState } from '../labScreen'

export const PRIMITIVES_MENU_STATES: readonly LabState[] = [...MENU_STATES]
