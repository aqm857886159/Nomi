import React from 'react'
import { create } from 'zustand'
import { declareStoreLifetime } from '../../project/storeLifetime'

/**
 * 「把光标放进这张卡的提示词框」的一次请求（空节点「试试」配方的最后一步）。
 *
 * 用一份小状态而不是 DOM 事件：配方跑完时生成框往往还没挂上（选中后生成框是延后挂载的，见 BaseGenerationNode
 * 的 composerMounted），事件会落空；状态留着，等那张卡的编辑器挂好时自己来取、取完清掉。
 * 消费者：NodeGenerationComposer（生成类卡的提示词）、TextDocumentNode（文本卡正文）。
 */
type NodePromptFocusState = { request: { nodeId: string; seq: number } | null }

export const useNodePromptFocusStore = create<NodePromptFocusState>(() => ({ request: null }))

/**
 * 寿命（切项目要不要清它）：`request` 是 project——它里面是**某张卡的节点 id**，切到别的项目后那个 id 指向的是上一个项目的卡，
 * 留着只会在新项目里落空（或误聚焦同 id 的卡）；一次请求本来就该在编辑器挂好时被取走，没取走的不该跨项目留。
 * 切项目 / 关项目时清回 null。（`seq` 是模块内计数器，不是 store 字段。）
 */
export const nodePromptFocusStoreLifetime = declareStoreLifetime({
  store: 'useNodePromptFocusStore',
  fields: { request: 'project' },
  releaseProject: () => useNodePromptFocusStore.setState({ request: null }),
})

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
