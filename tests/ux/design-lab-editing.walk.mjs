// 设计实验室 · 剪辑面走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与 Agent 面板走查共用一份）；这里只声明这一屏的取景参数。
// 产出：`tests/ux/shots/design-lab-editing/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 用法：node tests/ux/design-lab-editing.walk.mjs   （ONLY=transition-picker-01-closed 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'editing',
  title: '剪辑面 ',
  // 与 agent-panel 走查错开端口：两屏可能被并行跑，撞端口时 --strictPort 会直接失败。
  role: 'walk-editing',
  // 取景框最宽的那一格（转场选择器 420）；接触表按它开列。
  cellWidth: 420,
  columns: 3,
})
