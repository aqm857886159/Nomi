// 设计实验室 · 画布「分组框头（对齐拍板样张）」走查（R13 人眼判断的素材源）。零额度：纯本地渲染。
//
// 产出：`tests/ux/shots/design-lab-canvas-group-header/<state>.png` + `_contact-sheet.png`。
// 十格对照拍板样张 V-1136 Main-1280.png（亮）/ Main-dark-1280.png（暗），差异清单见 docs/plan/2026-10-10-group-header-board-parity.md。
//
// 用法：node tests/ux/design-lab-canvas-group-header.walk.mjs
//      （ONLY=hdr-01-default-storyboard 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'canvas-group-header',
  title: '画布 · 分组框头（对齐拍板样张）',
  role: 'walk-canvas-group-header',
  cellWidth: 920,
  columns: 2,
})
