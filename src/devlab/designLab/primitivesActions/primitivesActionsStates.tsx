// 设计实验室 · primitive 陈列「动作」屏状态注册表（汇总口）。
//
// 真身按实现来源拆在 `states/`（原生一份、Mantine 封装一份），共用取景台在
// `../primitives/primitivesLabKit.tsx`。这里只做一件事：**按固定顺序**把两族拼成一条清单。
// 顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致——
// 走查会拿活页面的 `window.__designLabStates` 和那把源码正则的结果逐项比对，错位当场红。
import { WORKBENCH_ACTION_STATES } from './states/01-workbench'
import { MANTINE_ACTION_STATES } from './states/02-mantine'
import type { LabState } from '../labScreen'

export const PRIMITIVES_ACTIONS_STATES: readonly LabState[] = [
  ...WORKBENCH_ACTION_STATES,
  ...MANTINE_ACTION_STATES,
]
