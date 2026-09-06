// 设计实验室 · 画布「框工具」走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与另几屏共用一份）；这里只声明这一屏的取景参数。
// 产出：`tests/ux/shots/design-lab-canvas-frame/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 六格要看的是同一个问题的六面：画完还空着认不认得出是个框、装了东西之后头部那一行挤不挤、
// 拖进/拖出的那一刻能不能一眼看懂「松手会发生什么」、折叠态还是不是原来那张卡、
// ⋯ 菜单里五项的措辞读不读得通（尤其「解散」下面那句「框没了，节点和连线都留着」）。
//
// 用法：node tests/ux/design-lab-canvas-frame.walk.mjs
//      （ONLY=canvas-frame-04-drag-leave 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'canvas-frame',
  title: '画布 · 框工具',
  role: 'walk-canvas-frame',
  cellWidth: 680,
  columns: 3,
})
