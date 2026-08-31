import { create } from 'zustand'

/**
 * 创作 AI 助手「流式 turn 控制器」（相3 P1）。
 *
 * 病根：在途流式的生命周期（sending / cancel 句柄 / 待批写卡 / 消息 id）原来是
 * `CreationAiPanel` 的组件局部 state，与项目切换无共享中止信号 → 切项目/新对话时
 * 旧轮次的 onContent/onToolCall/resolved 回调继续往「新项目」写，串台、污染文档。
 *
 * 收口：把这些易变状态全部搬到这个单例 store，组件只读不持有。每轮发一个单调
 * `turnId` token；迟到的回调用 `isCurrent(id)` 守卫；切项目/新对话/卸载统一
 * `abandon()`（中止流 + 作废 token + 复位 sending + 拒绝并清空写卡）；用户主动
 * 「停止」走 `requestUserCancel()`（中止流但**保留**当前轮，让 resolved 分支把
 * 气泡落到独立的「已取消」态，而非误显示为完成/错误）。
 */

/** 写文档工具映射；与 CreationAiPanel 的写卡渲染共用。 */
export const WRITE_TOOL_NAMES = ['insert_at_cursor', 'replace_selection', 'append_to_end'] as const
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number]

export function isWriteTool(name: string): name is WriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name)
}

export type ToolDecision =
  | { ok: true; result?: unknown }
  | { ok: false; message?: string }

/** 一条等待用户批准的写文档卡。 */
export type PendingDocToolCall = {
  toolCallId: string
  toolName: WriteToolName
  content: string
  confirm: (decision: ToolDecision) => Promise<void>
}

/** 一次轮次的句柄：组件持有它，靠 `isCurrent()` 判断自己是否仍是活动轮。 */
export type TurnHandle = {
  id: number
  isCurrent: () => boolean
}

type CreationTurnState = {
  /** 单调轮次 token；递增即作废旧轮。0 = 从未发起。 */
  turnId: number
  /** 是否有在途轮次（驱动发送/停止按钮）。 */
  sending: boolean
  /** 当前轮次的流取消句柄。 */
  cancel: (() => void) | null
  /** 待用户批准的写文档卡。 */
  pendingToolCalls: PendingDocToolCall[]
  /** 单调消息 id 计数器（替代 Date.now()，防同毫秒碰撞）。 */
  messageSeq: number

  begin: () => TurnHandle
  attachCancel: (turnId: number, cancel: () => void) => void
  finish: (turnId: number) => void
  /** 用户点「停止」：中止流，但保留当前轮（resolved 分支负责落「已取消」气泡）。 */
  requestUserCancel: () => void
  /** 切项目/新对话/卸载：中止流 + 作废轮次 + 复位 sending + 拒绝清空写卡。 */
  abandon: () => void
  addPendingToolCall: (call: PendingDocToolCall) => void
  resolvePendingToolCall: (toolCallId: string, decision: ToolDecision) => void
  clearPendingToolCalls: (reject?: boolean) => void
  nextMessageId: (role: 'user' | 'assistant') => string
}

function safeConfirm(call: PendingDocToolCall, decision: ToolDecision): void {
  // confirm 会打 IPC；轮次正被中止时后端可能已拆毁，吞掉 reject 防 unhandled。
  void Promise.resolve(call.confirm(decision)).catch(() => {})
}

export const useCreationTurnStore = create<CreationTurnState>((set, get) => ({
  turnId: 0,
  sending: false,
  cancel: null,
  pendingToolCalls: [],
  messageSeq: 0,

  begin: () => {
    const id = get().turnId + 1
    set({ turnId: id, sending: true, cancel: null })
    return { id, isCurrent: () => get().turnId === id }
  },

  attachCancel: (turnId, cancel) => {
    if (get().turnId !== turnId) return // 过期轮：丢弃句柄
    set({ cancel })
  },

  finish: (turnId) => {
    if (get().turnId !== turnId) return // 过期轮：不动当前态
    set({ sending: false, cancel: null })
  },

  requestUserCancel: () => {
    const { cancel } = get()
    cancel?.() // 流层 cancel 会合成 result+done → resolved 分支落「已取消」气泡，finish 复位 sending
  },

  abandon: () => {
    const { cancel, pendingToolCalls, turnId } = get()
    cancel?.()
    for (const call of pendingToolCalls) safeConfirm(call, { ok: false, message: 'creation turn abandoned' })
    set({ turnId: turnId + 1, sending: false, cancel: null, pendingToolCalls: [] })
  },

  addPendingToolCall: (call) => {
    set((state) => ({ pendingToolCalls: [...state.pendingToolCalls, call] }))
  },

  resolvePendingToolCall: (toolCallId, decision) => {
    const target = get().pendingToolCalls.find((call) => call.toolCallId === toolCallId)
    if (target) safeConfirm(target, decision)
    set((state) => ({ pendingToolCalls: state.pendingToolCalls.filter((call) => call.toolCallId !== toolCallId) }))
  },

  clearPendingToolCalls: (reject) => {
    const { pendingToolCalls } = get()
    if (reject) for (const call of pendingToolCalls) safeConfirm(call, { ok: false, message: 'cleared' })
    set({ pendingToolCalls: [] })
  },

  nextMessageId: (role) => {
    const seq = get().messageSeq + 1
    set({ messageSeq: seq })
    return `creation_ai_${role}_${seq}`
  },
}))

/** 模块级中止入口：供 store/app 层（非 React）调用，切项目/卸载统一收口。 */
export function abandonCreationTurn(): void {
  useCreationTurnStore.getState().abandon()
}
