// 助手（创作/画布 agent）用哪个 text 模型的偏好——单一真相源（localStorage）。
// 根因（2026-06-06）：chooseTextModel 盲选第一个 text 模型，撞到不响应的就全卡。让用户指定。
// 存 localStorage（轻、跨面板共享、不重启即失）；runWorkbenchAgent 读它加进 payload，两个面板自动生效。

import { isLaneThinkingLevel } from '../../../electron/shared/agentLane/modelReasoning'
import type { LaneThinkingLevel } from '../../../electron/shared/agentLane/laneContracts'
const KEY = 'nomi.assistantModel'

export type AssistantModelPref = { vendorKey: string; modelKey: string; thinkingLevel?: LaneThinkingLevel } | null

export function getAssistantModelPref(): AssistantModelPref {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { vendorKey?: unknown; modelKey?: unknown; thinkingLevel?: unknown }
    const vendorKey = typeof parsed.vendorKey === 'string' ? parsed.vendorKey : ''
    const modelKey = typeof parsed.modelKey === 'string' ? parsed.modelKey : ''
    return modelKey ? { vendorKey, modelKey, ...(isLaneThinkingLevel(parsed.thinkingLevel) ? { thinkingLevel: parsed.thinkingLevel } : {}) } : null
  } catch {
    return null
  }
}

export function setAssistantModelPref(pref: AssistantModelPref): void {
  try {
    if (pref && pref.modelKey) localStorage.setItem(KEY, JSON.stringify(pref))
    else localStorage.removeItem(KEY)
    // 通知同页其它订阅者（picker 在两个面板里）即时刷新。
    window.dispatchEvent(new CustomEvent('nomi:assistant-model-changed'))
  } catch {
    /* localStorage 不可用时静默——回退到 chooseTextModel 的「第一个」行为 */
  }
}
