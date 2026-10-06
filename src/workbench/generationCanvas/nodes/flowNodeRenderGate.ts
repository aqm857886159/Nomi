import type { NodeProps } from '@xyflow/react'
import type { GenerationFlowNode } from '../reactFlow/generationCanvasReactFlowAdapter'

/**
 * 卡片外壳的重渲染门（React Flow 性能指南：自定义节点必须 memo，https://reactflow.dev/learn/advanced-use/performance）。
 * 拖动时 React Flow 每一帧都把被拖节点的 positionAbsoluteX / Y 当成新 props 传进来；位置早已由外层 NodeWrapper
 * 的 transform 摆好，卡片内容一个字都不用变。以前每帧整张卡（含每个 t() 文案）重算：全选 320 张拖一下，
 * 一帧就是几百次完整渲染（2026-10-05 卡 17：BaseGenerationNode 2.1 万次、拖动 249 个长任务）。
 * 这里只忽略这两个坐标；其余任何 prop 变了照常重渲。GenerationFlowNodeView 不读这两个坐标（测试钉住）。
 */
export const POSITION_ONLY_NODE_PROPS = ['positionAbsoluteX', 'positionAbsoluteY'] as const
export function sameGenerationFlowNodeRender(previous: NodeProps<GenerationFlowNode>, next: NodeProps<GenerationFlowNode>): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]) as Set<keyof NodeProps<GenerationFlowNode>>
  for (const key of keys) {
    if ((POSITION_ONLY_NODE_PROPS as readonly string[]).includes(key)) continue
    if (!Object.is(previous[key], next[key])) return false
  }
  return true
}
