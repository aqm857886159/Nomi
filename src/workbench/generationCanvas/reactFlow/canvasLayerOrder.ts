/**
 * 画布叠层的**唯一** z 值表（owner）。
 *
 * 为什么有这张表（2026-10-10，用户反馈「分组左上角的 icon 与节点的提示词框叠在一起」）：
 * 分组框头写死 `z-[4]`，节点层（`.react-flow__nodes`）写死 CSS `z-index: 2`，两者在同一个视口层里比较——
 * 框头压住了整个节点层，选中节点（z 5）也逃不出节点层的 2，于是别组的框头盖住了节点的生成框。
 * 数字散在 CSS 与 TSX 里，谁也看不见这个比较，所以各改各的就会再打架。
 *
 * 规则：
 * - 视口层（`.react-flow__viewport`）内：分组框体 < 分组框头 < 节点层 < 工具条。
 * - 节点层内部：未选中节点 < 版本堆叠 < 选中节点；生成框在节点内，随节点层整体压住分组框头。
 * - 节点层与选中节点的数字经 `CANVAS_LAYER_CSS_VARS` 注入画布根节点，CSS 只引用变量、不再写死。
 *   其余数字由 TSX / adapter 直接读 `CANVAS_LAYER`。
 */
import type { CSSProperties } from 'react'

export const CANVAS_LAYER = {
  /** 分组框体（拖动把手）。 */
  groupBody: 0,
  /** 分组框头（组名 / 计数 / 生成全部）：压框体，压在节点层之下。 */
  groupHeader: 1,
  /** 节点层（`.react-flow__nodes`）：卡面与节点内的生成框都在它里面。 */
  nodes: 2,
  /** 编组端口（只挂连线把手，不可选不可拖）：节点层内垫底。 */
  groupPort: -1,
  /** 版本堆叠打开的节点：节点层内抬一档。 */
  nodeResultStack: 4,
  /** 选中节点：节点层内最上。 */
  nodeSelected: 5,
  /** 节点内的生成框（提示词框）与文本节点编辑框：节点局部坐标，整体仍在节点层里。 */
  nodeComposer: 8,
  /** 框选浮条：视口层，压节点层。 */
  selectionToolbar: 11,
  /** 分组工具条：视口层，压节点层。 */
  groupToolbar: 12,
} as const

export const CANVAS_LAYER_CSS_VARS = {
  '--canvas-z-nodes': String(CANVAS_LAYER.nodes),
  '--canvas-z-node-selected': String(CANVAS_LAYER.nodeSelected),
} as CSSProperties
