import { create } from 'zustand'
import { declareStoreLifetime } from '../../project/storeLifetime'
import type { AgentFormSurface } from '../../../ui/app-shell/shell/agentFormStore'

// 指向元素在聊天这一侧要记住的两件事（2026-10-23 D2 P1）。节点的数据一样都不存：那些只住在画布节点上。
//   · locatedNodeId：点过、画布定位过去的那一项。回到对话后它仍标着「已定位」（A3 / A4 ③）。
//   · returnTo：窄窗口里点了指向、对话临时让开之后，「回到对话」要回哪一页、落回哪一项、带哪个标签（A4 ②）。
//     它只是「回到哪」的内容，不管「那一枚在不在」：在不在只从机器让位算（useMachineGaveWay），让位一结束那一枚就没了，
//     这里剩下的旧内容画不出来；下一次让开会先改写它（yieldChatToCanvas）。不记形态：回来 = 人的打开动作。

export type NodePointerReturn = Readonly<{
  surface: AgentFormSurface
  nodeId: string
  /** 「镜 02 · 回到对话」里那一枚标签（P2 窄形态：回来时认得更快）。 */
  label: string
}>

type NodePointerState = {
  locatedNodeId: string | null
  returnTo: NodePointerReturn | null
  setLocated: (nodeId: string | null) => void
  setReturnTo: (target: NodePointerReturn | null) => void
}

export const useNodePointerStore = create<NodePointerState>((set) => ({
  locatedNodeId: null,
  returnTo: null,
  setLocated: (nodeId) => set((state) => (state.locatedNodeId === nodeId ? state : { locatedNodeId: nodeId })),
  setReturnTo: (target) => set({ returnTo: target }),
}))

/** 寿命：两样都只在这个项目里有意义（节点 id 是项目内标识）。 */
export const nodePointerStoreLifetime = declareStoreLifetime({
  store: 'useNodePointerStore',
  fields: { locatedNodeId: 'project', returnTo: 'project' },
  releaseProject: () => useNodePointerStore.setState({ locatedNodeId: null, returnTo: null }),
})
