// 生成 composer 往哪里写。
//
// 默认答案是画布 store——画布上那张卡改的就是画布上那个节点，天经地义。
// 但 composer 还有第二个宿主：Agent 面板介入槽里那张**付费确认卡**（`host="panel"`）。
// 在那里答案必须不同：用户还没答应花这笔钱，画布就不该被改（2026-09-11 用户拍板
// 「改的参数只在点生成那一刻回写画布」）。而且一旦卡会回写节点，落地链那边又会按候选重画节点，
// 「节点写候选」和「候选写节点」两个方向同时开着，每改一个参数就是一场拉锯
// （实测：计划连推三版、最后弹回参数默认值）——那正是上一轮做不成实时重算价格的根因。
//
// 所以「写到哪儿」被提成一个可替换的接缝，而不是在 composer 里按 host 分叉：
// 分叉会让同一个控件长出两条写入路径（P1 的并行版），而这里两个宿主共用**同一份组件、
// 同一条写入调用**，只是接住它的那只手不同。
//
// 只有两件事经过这个接缝：**改这个节点**、**读这个节点的最新样子**（增量 patch 要在最新值上
// 合并，读渲染快照会丢写）。连边、删节点、建节点那些改的是画布结构而不是这一次生成的载荷，
// 仍然直接走 store。
import React from 'react'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { CanvasMutationOptions } from '../store/canvasGuards'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

export type NodeWriteAccess = Readonly<{
  updateNode: (nodeId: string, patch: Partial<GenerationCanvasNode>, options?: CanvasMutationOptions) => void
  /** 这个节点**此刻**的样子。增量 patch 必须基于它合并，不能基于渲染快照 prop。 */
  latestNode: (nodeId: string) => GenerationCanvasNode | undefined
}>

const NodeWriteAccessContext = React.createContext<NodeWriteAccess | null>(null)

export const NodeWriteAccessProvider = NodeWriteAccessContext.Provider

/** 默认写入面 = 画布 store。没有 Provider 时（画布宿主）走这条。 */
export function useNodeWriteAccess(): NodeWriteAccess {
  const override = React.useContext(NodeWriteAccessContext)
  const storeUpdateNode = useGenerationCanvasStore((state) => state.updateNode)
  const storeAccess = React.useMemo<NodeWriteAccess>(() => Object.freeze({
    updateNode: storeUpdateNode,
    latestNode: (nodeId: string) => useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId),
  }), [storeUpdateNode])
  return override ?? storeAccess
}
