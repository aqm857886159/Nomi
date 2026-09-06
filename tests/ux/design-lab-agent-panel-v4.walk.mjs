// 设计实验室 · Agent 面板 v4 走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`——各屏共用一份。这里只声明这一屏的取景参数。
//
// 取景宽度 = 面板宽 390 + `Piece` 取景框的左右内边距：这一屏大多数格子只渲**一个积木**
// （定稿 Vocabulary / Composer 两板画的就是单件的状态阵列），不是整块面板。
//
// 用法：node tests/ux/design-lab-agent-panel-v4.walk.mjs  （ONLY=v4-composer-idle 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'agent-panel-v4',
  title: 'Agent 面板 v4',
  // 端口由 labServer.mjs 按 worktree + 角色派生，这里只认领角色（写死端口就是全局单例）。
  role: 'walk-agent-panel-v4',
  cellWidth: 410,
  columns: 4,
})
