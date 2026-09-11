import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'

export type GenerationFlowConnectionAffordance = 'dot' | 'magnetic'

/**
 * 连线触发面：默认 28px 小圆点，够格的才升级成磁吸带。
 *
 * 2026-09-11 拍板（迁移等价审计 §③ 行 8）：**磁吸带只给单选**，多选时全体退回小圆点。
 * 这不是 `primarySelection`（= 选中且只选中一张，见 generationCanvasReactFlowAdapter.ts:96）
 * 这个名字的副作用，是有意保留的新行为：
 *
 * - 迁移前每张选中的图片卡各自长出一条 112×min(168, h+28) 的磁吸带。多选五张 = 画面上
 *   十条半透明色带首尾相接，卡与卡之间还会互相压着，用户看不清自己到底选了哪几张。
 * - 多选这一刻用户在做的是「搬一批 / 删一批 / 批量生成」，不是「从这一张起一条线」。
 *   起线是单张卡的动作——给正在被起线的那一张留磁吸带就够了。
 *
 * 也就是说：多选时收起磁吸带比旧版更干净，代价是「多选后想从其中某一张起线」要先点回单选。
 * 这条代价可接受；要改先改这段注释。
 */
export function resolveGenerationFlowConnectionAffordance(
  node: GenerationCanvasNode,
  primarySelection: boolean,
  pendingConnectionSourceId: string,
): GenerationFlowConnectionAffordance {
  if (!primarySelection || pendingConnectionSourceId === node.id || node.kind === 'panorama') return 'dot'
  return node.kind === 'image' || node.kind === 'asset' || isImageLikeGenerationNodeKind(node.kind)
    ? 'magnetic'
    : 'dot'
}
