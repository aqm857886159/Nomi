// 设计实验室 · 画布「加号收束」走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与另几屏共用一份）；这里只声明这一屏的取景参数。
// 产出：`tests/ux/shots/design-lab-canvas-add-menu/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 三格要看的是同一个问题的三面：常驻条收到 5 个还认得出来吗、「更多」展开后两段的名字读不读得通、
// 右键菜单列全时三段的边界是不是比原来那条看不见的 `w-px` 分隔线清楚。
//
// 用法：node tests/ux/design-lab-canvas-add-menu.walk.mjs
//      （ONLY=canvas-add-02-rail-more-open 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'canvas-add-menu',
  title: '画布 · 加号收束',
  role: 'walk-canvas-add-menu',
  cellWidth: 420,
  columns: 3,
})
