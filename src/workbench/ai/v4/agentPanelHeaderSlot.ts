// 面板头部右端那组按钮的「外壳插口」（样张 design/shell-space：Agent 三形态）。
//
// 头部长相仍归本面板（品牌 · Context 环 …… 历史 · 形态按钮）；但「收起之后变成什么」是外壳的事——
// 停靠、浮窗、小球三种形态由外壳那一个 owner 管（src/ui/app-shell/shellSpace/agentFormStore.ts）。
// 外壳给了这个插口，头部就用外壳的形态按钮代替那颗「收起」；没给（生产、设计实验室、单测）照旧。
import React from 'react'

export type AgentPanelHeaderSlot = {
  /** 代替「收起」钮的那组形态按钮。 */
  actions: React.ReactNode
  /** 头部可当拖动把手（浮窗形态）：加上这个类名，外壳的 react-rnd 用它当 dragHandleClassName。 */
  dragHandleClassName?: string
}

export const AgentPanelHeaderSlotContext = React.createContext<AgentPanelHeaderSlot | null>(null)
