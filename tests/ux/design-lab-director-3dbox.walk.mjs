// 设计实验室 · 导演视图（3D-BOX）走查（R13 人眼判断的素材源）。零额度：纯本地渲染（无头 Chromium，不起可见窗口），不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与另几屏共用一份）；这里只声明这一屏的取景参数。
// 产出：`tests/ux/shots/design-lab-director-3dbox/<state>.png` + `_contact-sheet.png`。
// 这一屏的格子要和 Claude Design 画布「3D-BOX · 正在改：镜头 N」七态逐项对账（3c，10-06 拍板）。
//
// 用法：node tests/ux/design-lab-director-3dbox.walk.mjs   （ONLY=d3-focus-3-two-zh 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'director-3dbox',
  title: '导演视图（3D-BOX）· 正在改：镜头 N',
  role: 'walk-director-3dbox',
  cellWidth: 640,
  columns: 2,
  viewport: { width: 1280, height: 933 },
})
