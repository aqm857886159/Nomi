// 设计实验室 · 画布「节点快捷动作（批次 1 样张）」走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与另几屏共用一份）；这里只声明这一屏的取景参数。
// 产出：`tests/ux/shots/design-lab-node-quick-actions/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 要看的是：浮条加了快捷动作之后还是不是一行四颗文字钮；三个下拉向上展开、不压在图上；
// 菜单里没有价格；接不上的项有没有说原因；派生出的节点状态是不是和手动生成的一样。
//
// 用法：node tests/ux/design-lab-node-quick-actions.walk.mjs（ONLY=qa-06-grid-picker 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'node-quick-actions',
  title: '画布 · 节点快捷动作（批次 1 样张）',
  role: 'walk-node-quick-actions',
  cellWidth: 900,
  columns: 2,
})
