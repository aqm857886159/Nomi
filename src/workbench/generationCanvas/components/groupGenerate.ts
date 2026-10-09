/**
 * 「生成整组 / 生成全部」的唯一执行口（owner）：把一批节点按依赖分波，交给同一张付费确认（confirmAndRunPlan）。
 * 画布的组框工具条 / 右键菜单（useCanvasFrameActions）和生成页列表的分区头「生成整组」都从这里走——
 * 列表没有自己的批量路径，也不另开确认框；每个节点用它自己已选好的模型和参数，并发交给调度器默认值。
 */
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { confirmAndRunPlan } from './batchPlanPreview'
import { eligibleGenerationNodeIds } from './canvasProductionScope'

/** 这批节点里「现在能生成」的那些（空闲 / 失败、不归制作流程占着）。按钮可用态与点击后派发的集合共用这一份。 */
export function eligibleGroupGenerateIds(nodeIds: readonly string[]): string[] {
  if (!nodeIds.length) return []
  return eligibleGenerationNodeIds(useGenerationCanvasStore.getState().nodes, { nodeIds }, useProductionCanvasLandingStore.getState().runs)
}

/** 派发这批节点；一个都不能生成 = 'empty'（调用方说一句话），否则弹确认并返回 'started'。 */
export function runGroupGenerate(nodeIds: readonly string[]): 'empty' | 'started' {
  const eligibleIds = eligibleGroupGenerateIds(nodeIds)
  if (!eligibleIds.length) return 'empty'
  const live = useGenerationCanvasStore.getState()
  void confirmAndRunPlan(buildDependencyWaves(eligibleIds, { nodes: live.nodes, edges: live.edges }), { initiator: 'user' })
  return 'started'
}
