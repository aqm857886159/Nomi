// 设计实验室 · 画布「版本卡片（宫格）」走查（R13 人眼判断的素材源）。零额度：纯本地渲染。
//
// 流程住 `design-lab/walkScreen.mjs`；这里只声明取景参数。
// 产出：`tests/ux/shots/design-lab-version-cards/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 用法：node tests/ux/design-lab-version-cards.walk.mjs（ONLY=vc-04-open-4-hover 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'version-cards',
  title: '画布 · 版本卡片（宫格）',
  role: 'walk-version-cards',
  cellWidth: 1400,
  columns: 2,
})
