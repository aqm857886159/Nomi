import { create } from 'zustand'
import { declareStoreLifetime } from '../../project/storeLifetime'
import type { AgentFormSurface } from '../../../ui/app-shell/shell/agentFormStore'

// 指向元素在聊天这一侧要记住的两件事（2026-10-23 D2 P1）。节点的数据一样都不存：那些只住在画布节点上。
//   · locatedNodeId：点过、画布定位过去的那一项。回到对话后它仍标着「已定位」（A3 / A4 ③）。
//   · returnTo：窄窗口里点了指向、对话临时让开之后，「回到对话」要回哪一页、落回哪一项（A4 ②）。
//     不记形态：让开是机器的临时覆盖，回来 = 撤掉覆盖，人存的和窄窗档里人点出来的样子本来就都还在。

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
