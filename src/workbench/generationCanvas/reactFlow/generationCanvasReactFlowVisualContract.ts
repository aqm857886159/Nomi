import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeConnectionSides } from '../model/generationNodeKinds'
import { readGroupPort } from '../model/groupPort'

export type GenerationFlowConnectionAffordance = 'dot' | 'magnetic' | 'hidden'

/**
 * 连线触发面的**唯一 owner**：画布上每一个能起线的东西（节点卡、收起的编组卡）长什么把手，只在这里决定。
 *
 * 三档：
 * - `magnetic`：两侧 112×min(168, h+28) 命中带 + 29px「+」圈，**常驻可见**、跟手（2026-09-21 拍板：
 *   去掉「还得悬停在卡上才露出」这一条）。
 * - `dot`：28px 命中 + 14px 可见圆点（逐字同迁移前 `BaseGenerationNode.tsx` 的 w-7 h-7 按钮 + 14px 点）。
 * - `hidden`：不渲染起线把手（没被选中的编组端口节点；这一类卡用不上的那一侧）。
 *
 * **编组也是「谁选中谁出圈」**（2026-09-24 用户拍板，反馈「打组后左右两边也出现 +」）：编组的把手挂在
 * 它的端口节点上（model/groupPort.ts），选中这个编组（model/selectedGroup.ts）才出磁吸「+」圈，
 * 没选中就什么都不画——折叠编组卡以前常驻两颗旧按钮，按下去亮、拖出去什么都不发生，已删。
 *
 * **拉环只出现在用得上的一侧**（2026-10-08 用户拍板，替换 09-21「所有种类都有」）：左「+」= 给它加输入，
 * 右「+」= 用它的产出生成。哪一侧存在只读种类定义的 `connects`（getGenerationNodeConnectionSides）——
 * 上传素材 / 文本不收输入 → 没有左环；剪辑卡没有可引用的产出 → 没有右环。用不上的那一侧是 `hidden`：
 * 把手元素仍挂着（老项目里已有的边要靠它画出来），只是不画、不接指针。「选中出 + 圈、未选中出小圆点」不变。
 * 连线落下后合不合法（例如音频接不进图片参考槽）仍由完成连线那一侧判（completeNodeConnection → validateReferenceEdge）。
 *
 * **只给唯一主选中**（2026-09-11 拍板，迁移等价审计 §③ 行 8）：多选时全体退回小圆点。
 * - 迁移前每张选中的图片卡各自长出一条磁吸带。多选五张 = 十条半透明色带首尾相接，看不清选了哪几张。
 * - 多选这一刻用户在做的是「搬一批 / 删一批 / 批量生成」，不是「从这一张起一条线」。
 * 代价：「多选后想从其中某一张起线」要先点回单选。可接受；要改先改这段注释。
 *
 * **磁吸带只在这一张卡上**：未选中的卡永远是小圆点，所以穿过它们旁边的连线照旧点得到——
 * 「每张卡常驻带子、把连线吞掉」正是 #656 被否掉的那版（走查 canvas-handles-alt-drag 有断言）。
 * 起线进行中，起点那张卡退回小圆点（带子会和目标热区叠在同一条边上抢落点）。
 */
export function resolveGenerationFlowConnectionAffordance(
  node: Pick<GenerationCanvasNode, 'id' | 'kind' | 'meta'>,
  side: 'left' | 'right',
  primarySelection: boolean,
  pendingConnectionSourceId: string,
): GenerationFlowConnectionAffordance {
  const groupPort = readGroupPort(node)
  // 起线进行中的起点编组与卡片同理退回小圆点（带子别和目标热区抢落点）；把手本身不能卸载，否则正在拖的线没了起点。
  if (groupPort) return !groupPort.selected ? 'hidden' : pendingConnectionSourceId === node.id ? 'dot' : 'magnetic'
  if (!getGenerationNodeConnectionSides(node.kind)[side]) return 'hidden'
  if (!primarySelection || pendingConnectionSourceId === node.id) return 'dot'
  return 'magnetic'
}

