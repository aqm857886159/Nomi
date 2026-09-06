// 设计实验室 · 宿主接入配置走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与另两屏共用一份）；这里只声明这一屏的取景参数。
// 产出：`tests/ux/shots/design-lab-host-config/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 用法：node tests/ux/design-lab-host-config.walk.mjs   （ONLY=host-config-01-repaired-one 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'host-config',
  title: '宿主接入配置',
  // 与另两屏（5198 / 5200）错开：三屏可能被并行跑，撞端口时 --strictPort 会直接失败。
  port: 5202,
  // 这一族是 toast，贴在视口右上角、按整屏取景，所以格子按视口宽开列。
  cellWidth: 720,
  columns: 2,
})
