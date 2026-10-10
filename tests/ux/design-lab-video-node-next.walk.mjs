// 设计实验室 · 「视频节点的下一步」走查（R13 人眼判断的素材源，D-videonode 样张 2026-10-09）。零额度：纯本地渲染。
//
// 流程住 `design-lab/walkScreen.mjs`；这里只声明取景参数。
// 产出：`tests/ux/shots/design-lab-video-node-next/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 用法：node tests/ux/design-lab-video-node-next.walk.mjs（ONLY=vn-01-frame-menu-zh 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'video-node-next',
  title: '视频节点的下一步（截帧 / 剪辑 / 拆成视频片段）',
  role: 'walk-video-node-next',
  cellWidth: 980,
  columns: 2,
  viewport: { width: 1200, height: 1100 },
})
