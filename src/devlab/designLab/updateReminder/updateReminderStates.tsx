// 设计实验室 · 屏「应用内更新提醒」的状态注册表（汇总口，D-update 样张 2026-10-08）。
// 真身按主题拆在 `states/`；顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致。
// 取代了 src/devlab/uiShellLab.tsx 里那四格旧「版本弹窗」（那四格从没挂进任何屏，已同提交删掉）。
import { UPDATE_DISCOVER_STATES } from './states/01-discover'
import { UPDATE_DIALOG_STATES } from './states/02-dialog'
import { UPDATE_AFTER_STATES } from './states/03-after'
import type { LabState } from '../labScreen'

export const UPDATE_REMINDER_STATES: readonly LabState[] = [...UPDATE_DISCOVER_STATES, ...UPDATE_DIALOG_STATES, ...UPDATE_AFTER_STATES]
