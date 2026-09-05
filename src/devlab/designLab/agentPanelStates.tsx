// 设计实验室 · Agent 面板状态注册表（汇总口）
//
// 真身按来源拆在 `states/`（R9 分层 · R12 巨壳门岗：单文件 ≤800 行），共用件在 `agentPanelKit.tsx`。
// 这里只做一件事：**按固定顺序**把三族拼成一条清单。
// 顺序必须与 `tests/ux/design-lab/labStates.mjs` 解析 `states/` 的顺序（文件名排序）一致——
// 走查会拿活页面的 `window.__designLabStates` 和那把源码正则的结果逐项比对，错位当场红。
import { FORM_STATES } from './states/01-forms'
import { EXCEPTION_STATES } from './states/02-p0-exceptions'
import { LIVE_ONLY_STATES } from './states/03-live-only'
import type { LabState } from './agentPanelKit'

export { PANEL_WIDTH, PANEL_HEIGHT } from './agentPanelKit'
export type { LabState, LabCoverage } from './agentPanelKit'

export const AGENT_PANEL_STATES: readonly LabState[] = [
  ...FORM_STATES,
  ...EXCEPTION_STATES,
  ...LIVE_ONLY_STATES,
]

export function findAgentPanelState(id: string | null): LabState | null {
  if (!id) return null
  return AGENT_PANEL_STATES.find((state) => state.id === id) ?? null
}
