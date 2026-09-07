// 节点**活预览帧**的会话级瞬态存储。刻意独立于画布主 store：
// 预览帧是高频瞬态，绝不进 node.meta / 持久化 project.json——关掉项目/终态即弃。
// GeneratingOverlay 订阅它；写它的目前有两条链：ComfyUI 采样中间图（comfyuiProgressBridge，
// dataURL）与本地深度处理的实时深度帧（startVideoDepthDerivation，objectURL）。
//
// 2026-09-07 从 `comfyuiPreviewStore` 改名：它一直就是「某个节点此刻的活预览帧」这件事的
// 唯一 owner，只是当时只有一个写入方。深度处理接进来时另起一个同形状的 store 就是并行版（P1），
// 所以改的是名字，不是再加一份。
//
// **objectURL 的 revoke 归写入方**：dataURL 不需要 revoke，objectURL 需要。store 不知道自己
// 存的是哪一种，所以它不负责回收；写 objectURL 的那条链自己在换图/收场时 revoke。
import { create } from 'zustand'

type NodeLivePreviewState = {
  byNode: Record<string, string>
  setPreview: (nodeId: string, url: string) => void
  clearPreview: (nodeId: string) => void
}

export const useNodeLivePreviewStore = create<NodeLivePreviewState>((set) => ({
  byNode: {},
  setPreview: (nodeId, url) =>
    set((state) => ({ byNode: { ...state.byNode, [nodeId]: url } })),
  clearPreview: (nodeId) =>
    set((state) => {
      if (!(nodeId in state.byNode)) return state
      const next = { ...state.byNode }
      delete next[nodeId]
      return { byNode: next }
    }),
}))
