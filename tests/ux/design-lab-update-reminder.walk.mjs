// 设计实验室 · 「应用内更新提醒」走查（R13 人眼判断的素材源，D-update 样张 2026-10-08）。零额度：纯本地渲染。
//
// 流程住 `design-lab/walkScreen.mjs`；这里只声明取景参数。视口 = 主窗口默认尺寸 1440×960（项目库 h-screen 按它排）。
// 产出：`tests/ux/shots/design-lab-update-reminder/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 用法：node tests/ux/design-lab-update-reminder.walk.mjs（ONLY=update-03-dialog-windows-zh 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'update-reminder',
  title: '应用内更新提醒（D-update 样张）',
  role: 'walk-update-reminder',
  cellWidth: 1440,
  columns: 1,
  viewport: { width: 1440, height: 960 },
})
