// 分镜表节点退役的迁移入口（owner）：0.23.1 及更早写过的「分镜表」（storyboard 来源）和
// 「Agent 分镜表」（production 来源）只是画布节点 / 分镜方案的另一种展示，不存任何一行。
// 打开旧项目时把这两种表节点（连带它们的边、选中、分组成员）移除，**镜头节点、分镜方案、拆解事实表一个不动**；
// 镜头从此只在生成页「列表」里按镜序看。幂等：现行 schema 不再产生它们，再迁一次什么都不动。
import { isRetiredShotTableNode } from '../../../electron/shared/canvas/shotTable'
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'

export function retireStoryboardTableViews(record: WorkbenchProjectRecordV1): { record: WorkbenchProjectRecordV1; retired: number } {
  const canvas = record.payload.generationCanvas
  const retiredIds = new Set(canvas.nodes.filter((node) => isRetiredShotTableNode(node)).map((node) => node.id))
  if (retiredIds.size === 0) return { record, retired: 0 }
  const generationCanvas = {
    ...canvas,
    nodes: canvas.nodes.filter((node) => !retiredIds.has(node.id)),
    edges: canvas.edges.filter((edge) => !retiredIds.has(edge.source) && !retiredIds.has(edge.target)),
    selectedNodeIds: (canvas.selectedNodeIds ?? []).filter((id) => !retiredIds.has(id)),
    groups: (canvas.groups ?? []).map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !retiredIds.has(id)) })),
  }
  return { record: { ...record, payload: { ...record.payload, generationCanvas } }, retired: retiredIds.size }
}
