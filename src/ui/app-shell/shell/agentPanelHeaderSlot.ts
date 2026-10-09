// 面板头部右端那组按钮的「外壳插口」（10-08 外壳重设计：Agent 三形态）。
//
// 头部长相仍归本面板（品牌 · Context 环 …… 历史 · 形态切换）；但「收起之后变成什么」是外壳的事——
// 停靠、浮窗、小球三种形态由外壳那一个 owner 管（src/ui/app-shell/shell/agentFormStore.ts）。
// 外壳给了这个插口，头部就用外壳的形态切换代替那颗「收起」；没给（设计实验室、单测）照旧。
// 面板窄（浮窗被拖小）时，历史和形态切换一起收进头部一颗「⋯」，菜单项由 menuItems 给。
import React from 'react'

export type AgentPanelHeaderSlotMenuItem = { id: string; label: string; onSelect: () => void }

export type AgentPanelHeaderSlot = {
  /** 代替「收起」钮的那组形态按钮。 */
  actions: React.ReactNode
  /** 窄头部收进「⋯」时，形态切换在菜单里的样子。 */
  menuItems?: readonly AgentPanelHeaderSlotMenuItem[]
  /** 头部可当拖动把手（浮窗形态）：加上这个类名，外壳的 react-rnd 用它当 dragHandleClassName。 */
  dragHandleClassName?: string
}

export const AgentPanelHeaderSlotContext = React.createContext<AgentPanelHeaderSlot | null>(null)

/** 头部宽度低于这个数，历史与形态切换收进「⋯」（品牌 + Context 环 + ⋯ 仍放得下）。 */
export const AGENT_HEADER_COMPACT_WIDTH = 340
