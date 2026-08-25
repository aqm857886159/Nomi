import { adoptGenerationNode } from '../adoption/adoptGenerationNode'
import { reportAdoptionOutcome } from '../adoption/adoptionReceipt'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

/**
 * 节点素材「点击加入时间轴」的整动作：贴尾追加（免思考串片）+ 展开时间轴让结果立刻可见 + 回执。
 *
 * P5 E1 起这里**不再自己写轴**——落轴统一走采纳桥（`adoption/adoptGenerationNode`），
 * 由它管幂等/新鲜度/原子写/一步撤销。本文件只剩「贴尾语义 + 回执」这一层意图。
 * 拖拽路径（自选位置）走同一座桥的 `placement: 'frame'`，见 useNodeDragResize。
 */
export async function addGenerationNodeToTimelineEnd(node: GenerationCanvasNode): Promise<void> {
  const outcome = await adoptGenerationNode(node, { placement: { kind: 'append' } })
  reportAdoptionOutcome(outcome)
}
