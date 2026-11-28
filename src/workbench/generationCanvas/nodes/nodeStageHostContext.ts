import React from 'react'

/**
 * 节点舞台的挂载宿主：
 * - `'canvas'`：挂在 React Flow 节点外壳里（浮条按 `useViewport()` 反向缩放并贴画布舞台夹紧）；
 * - `'list-detail'`：挂在生成列表大详情里（脱离 `<ReactFlowProvider>`，工具条与剪辑面板按 `zoom = 1` 内联流式排版）。
 */
export type NodeStageHost = 'canvas' | 'list-detail'

export const NodeStageHostContext = React.createContext<NodeStageHost>('canvas')

export function useNodeStageHost(): NodeStageHost {
  return React.useContext(NodeStageHostContext)
}
