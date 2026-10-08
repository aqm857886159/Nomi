import React from 'react'
import { create } from 'zustand'

/**
 * 「把光标放进这张卡的提示词框」的一次请求（空节点「试试」配方的最后一步）。
 *
 * 用一份小状态而不是 DOM 事件：配方跑完时生成框往往还没挂上（选中后生成框是延后挂载的，见 BaseGenerationNode
 * 的 composerMounted），事件会落空；状态留着，等那张卡的编辑器挂好时自己来取、取完清掉。
 * 消费者：NodeGenerationComposer（生成类卡的提示词）、TextDocumentNode（文本卡正文）。
 */
type NodePromptFocusState = { request: { nodeId: string; seq: number } | null }

export const useNodePromptFocusStore = create<NodePromptFocusState>(() => ({ request: null }))

let seq = 0

export function requestNodePromptFocus(nodeId: string): void {
  seq += 1
  useNodePromptFocusStore.setState({ request: { nodeId, seq } })
}

/**
 * 这张卡的编辑器就绪（`focus` 非空）且有指向它的请求 → 调一次 `focus` 并清掉请求。
 * `focus` 返回 false = 这一帧还没法聚焦（编辑器还没挂进文档），请求留着下次再试。
 */
export function useNodePromptFocusRequest(nodeId: string, focus: (() => boolean) | null): void {
  const pending = useNodePromptFocusStore((state) => (state.request?.nodeId === nodeId ? state.request.seq : null))
  React.useEffect(() => {
    if (pending === null || !focus) return undefined
    const frame = requestAnimationFrame(() => {
      if (useNodePromptFocusStore.getState().request?.seq !== pending) return
      if (focus()) useNodePromptFocusStore.setState({ request: null })
    })
    return () => cancelAnimationFrame(frame)
  }, [focus, pending])
}
