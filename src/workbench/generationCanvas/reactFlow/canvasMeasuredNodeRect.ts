/**
 * 命中判定的节点矩形**只有一个真相源：React Flow 内核测量出来的那个**。
 *
 * 为什么不能自己从 Zustand 算（2026-09-07 R29 边界检查 §6.1，
 * docs/research/2026-09-07-react-flow-subflows-vs-frame.md）：
 * `getCanvasNodeVisualSize(node)` 给的是**声明**尺寸（节点类型的标称宽高），
 * 而用户看到的是浏览器**实际渲染**出来的边。两者一旦不一致——某类节点内容撑高、
 * 缩放取整、字体回退让标题多折一行——判定线和视觉边就不是同一条，
 * 表现为「明明拖进框里了却没入组」，是最难跟用户解释的一类 bug（R14.1 同一语义两份定义）。
 *
 * 内核在 `InternalNode` 上已经维护好了这两样：
 *   · `internals.positionAbsolute` —— 绝对坐标，且**拖动中逐帧更新**
 *     （XYDrag.updateNodes 先改 nodeLookup 再触发 onNodeDrag，所以拖动回调里读到的就是实时位置）；
 *   · `measured` —— ResizeObserver 量到的真实渲染尺寸。
 * 出处：@xyflow/system@0.0.81 dist/esm/types/nodes.d.ts:83-99（InternalNodeBase）。
 *
 * 没量到尺寸就返回 null，**不回退到声明尺寸**——回退等于把这份分裂又请回来。
 */
import type { InternalNode } from '@xyflow/react'
import type { GenerationFlowNode } from './generationCanvasReactFlowAdapter'

export type CanvasMeasuredRect = { x: number; y: number; width: number; height: number }

/** 从内核内部节点取出「用户真正看到的那个矩形」。量不到（尚未挂载/未测量）返回 null。 */
export function measuredRectFromInternalNode(
  internalNode: Pick<InternalNode<GenerationFlowNode>, 'internals' | 'measured'> | undefined | null,
): CanvasMeasuredRect | null {
  if (!internalNode) return null
  const { width, height } = internalNode.measured
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height) return null
  const { x, y } = internalNode.internals.positionAbsolute
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y, width, height }
}
