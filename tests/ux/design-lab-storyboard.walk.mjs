// 设计实验室 · 分镜表 v6 走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与 Agent 面板走查共用一份）；这里只声明这一屏的取景参数。
// 产出：`tests/ux/shots/design-lab-storyboard/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 用法：node tests/ux/design-lab-storyboard.walk.mjs   （ONLY=sb-row-08-done 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'storyboard',
  title: '分镜表 v6 ',
  // 端口按 worktree + 角色派生（design-lab/labServer.mjs）：写死端口在这台常年 20+ worktree
  // 的机器上一定会撞，撞了截回来的是别人分支的 UI。
  role: 'walk-storyboard',
  // 一行是 `14 | 136 | 200 | 1fr`，舞台 900 宽；接触表里缩到 440 仍看得清底栏胶囊的排布。
  cellWidth: 440,
  columns: 3,
  // 整屏取景的那几格（槽浮层）要装得下浮层，视口给高一点。
  viewport: { width: 1440, height: 1100 },
})
